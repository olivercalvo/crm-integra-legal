import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FINANCIAL_DEPENDENCIES,
  buildFinancialBlockMessage,
  isForeignKeyViolation,
  GENERIC_FK_BLOCK_MESSAGE,
  type FinancialCounts,
} from "@/lib/clients/delete-guards";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: profile } = await admin
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    // Only admin and abogada can delete
    if (profile.role !== "admin" && profile.role !== "abogada") {
      return NextResponse.json({ error: "No tienes permisos para eliminar clientes" }, { status: 403 });
    }

    const clientId = params.id;

    // Verify client exists and belongs to tenant
    const { data: existingClient } = await admin
      .from("clients")
      .select("id, name, client_number")
      .eq("id", clientId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!existingClient) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Check if client has associated cases
    const { count } = await admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("tenant_id", profile.tenant_id);

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Este cliente tiene ${count} caso(s) asociado(s). Elimina los casos primero.` },
        { status: 400 }
      );
    }

    // Check finance FKs (invoices/quotes/credit_notes/payments reference
    // clients(id) with RESTRICT). This MUST run before any deletion: otherwise
    // the documents get wiped and the client survives the FK violation.
    const financialCounts: FinancialCounts = {};
    await Promise.all(
      FINANCIAL_DEPENDENCIES.map(async ({ table }) => {
        const { count: rows, error } = await admin
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId)
          .eq("tenant_id", profile.tenant_id);

        if (error) throw error;
        financialCounts[table] = rows ?? 0;
      })
    );

    const financialBlock = buildFinancialBlockMessage(financialCounts);
    if (financialBlock) {
      return NextResponse.json({ error: financialBlock }, { status: 400 });
    }

    // ---- No blocking check remains: from here on we delete. ----

    // 1. Delete documents from storage + DB
    const { data: docs } = await admin
      .from("documents")
      .select("id, storage_key")
      .eq("entity_type", "client")
      .eq("entity_id", clientId);

    if (docs && docs.length > 0) {
      const storageKeys = docs
        .map((d) => d.storage_key)
        .filter(Boolean) as string[];

      if (storageKeys.length > 0) {
        await admin.storage.from("documents").remove(storageKeys);
      }

      await admin
        .from("documents")
        .delete()
        .eq("entity_type", "client")
        .eq("entity_id", clientId);
    }

    // 2. Delete the client
    const { error: deleteError } = await admin
      .from("clients")
      .delete()
      .eq("id", clientId)
      .eq("tenant_id", profile.tenant_id);

    if (deleteError) {
      console.error("Error deleting client:", deleteError);

      // Defense in depth: a FK we don't check above (today
      // prospects.converted_client_id) must not leak the raw Postgres error.
      if (isForeignKeyViolation(deleteError)) {
        return NextResponse.json({ error: GENERIC_FK_BLOCK_MESSAGE }, { status: 400 });
      }

      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // 3. Audit log
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "clients",
      entity_id: clientId,
      action: "delete",
      field: null,
      old_value: JSON.stringify({
        client_number: existingClient.client_number,
        name: existingClient.name,
      }),
      new_value: null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected error deleting client:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

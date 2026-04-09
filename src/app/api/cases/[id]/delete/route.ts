import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
      return NextResponse.json({ error: "No tienes permisos para eliminar casos" }, { status: 403 });
    }

    const caseId = params.id;

    // Verify case exists and belongs to tenant
    const { data: existingCase } = await admin
      .from("cases")
      .select("id, case_code, client_id, description")
      .eq("id", caseId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!existingCase) {
      return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
    }

    // 1. Delete documents from storage + DB
    const { data: docs } = await admin
      .from("documents")
      .select("id, storage_key")
      .eq("entity_type", "case")
      .eq("entity_id", caseId);

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
        .eq("entity_type", "case")
        .eq("entity_id", caseId);
    }

    // 2. Delete comments
    await admin.from("comments").delete().eq("case_id", caseId);

    // 3. Delete tasks
    await admin.from("tasks").delete().eq("case_id", caseId);

    // 4. Delete expenses
    await admin.from("expenses").delete().eq("case_id", caseId);

    // 5. Delete payments
    await admin.from("client_payments").delete().eq("case_id", caseId);

    // 6. Delete the case
    const { error: deleteError } = await admin
      .from("cases")
      .delete()
      .eq("id", caseId)
      .eq("tenant_id", profile.tenant_id);

    if (deleteError) {
      console.error("Error deleting case:", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // 7. Audit log
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "cases",
      entity_id: caseId,
      action: "delete",
      field: null,
      old_value: JSON.stringify({
        case_code: existingCase.case_code,
        client_id: existingCase.client_id,
        description: existingCase.description,
      }),
      new_value: null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected error deleting case:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

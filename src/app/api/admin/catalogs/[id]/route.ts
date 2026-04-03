import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_TABLES = [
  "cat_classifications",
  "cat_statuses",
  "cat_institutions",
  "cat_team",
] as const;

type AllowedTable = (typeof ALLOWED_TABLES)[number];

function isAllowedTable(table: string | null): table is AllowedTable {
  return ALLOWED_TABLES.includes(table as AllowedTable);
}

// Tables that reference catalog items — used for soft-delete safety check
const REFERENCE_MAP: Partial<Record<AllowedTable, { table: string; column: string }[]>> = {
  cat_classifications: [{ table: "cases", column: "classification_id" }],
  cat_statuses: [{ table: "cases", column: "status_id" }],
  cat_institutions: [{ table: "cases", column: "institution_id" }],
  cat_team: [],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
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

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table");

    if (!isAllowedTable(table)) {
      return NextResponse.json(
        { error: `Tabla inválida. Use: ${ALLOWED_TABLES.join(", ")}` },
        { status: 400 }
      );
    }

    const itemId = params.id;

    // Verify item belongs to this tenant
    const { data: existing, error: fetchError } = await admin
      .from(table)
      .select("*")
      .eq("id", itemId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Elemento no encontrado" }, { status: 404 });
    }

    const body = await request.json();

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.active !== undefined) updates.active = body.active;

    if (table === "cat_classifications") {
      if (body.prefix !== undefined) updates.prefix = body.prefix.trim().toUpperCase();
      if (body.description !== undefined) updates.description = body.description?.trim() || null;
    }

    if (table === "cat_team") {
      if (body.user_id !== undefined) updates.user_id = body.user_id || null;
      if (body.role !== undefined) updates.role = body.role?.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    const { data: updated, error: updateError } = await admin
      .from(table)
      .update(updates)
      .eq("id", itemId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error(`Error updating ${table}:`, updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: table,
      entity_id: itemId,
      action: "update",
      field: Object.keys(updates).join(", "),
      old_value: JSON.stringify(
        Object.fromEntries(Object.keys(updates).map((k) => [k, existing[k]]))
      ),
      new_value: JSON.stringify(updates),
    });

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in PATCH /api/admin/catalogs/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
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

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table");

    if (!isAllowedTable(table)) {
      return NextResponse.json(
        { error: `Tabla inválida. Use: ${ALLOWED_TABLES.join(", ")}` },
        { status: 400 }
      );
    }

    const itemId = params.id;

    // Verify item belongs to this tenant
    const { data: existing, error: fetchError } = await admin
      .from(table)
      .select("*")
      .eq("id", itemId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Elemento no encontrado" }, { status: 404 });
    }

    // Check references to prevent deactivating items in use
    const refs = REFERENCE_MAP[table] ?? [];
    for (const ref of refs) {
      const { count } = await admin
        .from(ref.table)
        .select("id", { count: "exact", head: true })
        .eq(ref.column, itemId)
        .eq("tenant_id", profile.tenant_id);

      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error: `No se puede desactivar: hay ${count} caso(s) usando este elemento.`,
          },
          { status: 409 }
        );
      }
    }

    // Soft delete
    const { data: deactivated, error: updateError } = await admin
      .from(table)
      .update({ active: false })
      .eq("id", itemId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error(`Error deactivating ${table}:`, updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: table,
      entity_id: itemId,
      action: "delete",
      field: "active",
      old_value: "true",
      new_value: "false",
    });

    return NextResponse.json({ data: deactivated }, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in DELETE /api/admin/catalogs/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

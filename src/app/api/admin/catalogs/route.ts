import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: profile } = await supabase
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

    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      return NextResponse.json({ error: "Error al obtener datos" }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in GET /api/admin/catalogs:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: profile } = await supabase
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

    const body = await request.json();

    // Validate required fields per table
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    if (table === "cat_classifications" && !body.prefix?.trim()) {
      return NextResponse.json({ error: "El prefijo es requerido para clasificaciones" }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      tenant_id: profile.tenant_id,
      name: body.name.trim(),
      active: true,
    };

    if (table === "cat_classifications") {
      payload.prefix = body.prefix.trim().toUpperCase();
      payload.description = body.description?.trim() || null;
    }

    if (table === "cat_team") {
      payload.user_id = body.user_id || null;
      payload.role = body.role?.trim() || null;
    }

    const { data: newItem, error } = await supabase
      .from(table)
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error(`Error creating ${table} item:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: table,
      entity_id: newItem.id,
      action: "create",
      field: null,
      old_value: null,
      new_value: JSON.stringify(payload),
    });

    return NextResponse.json({ data: newItem }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/admin/catalogs:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

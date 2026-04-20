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

const REFERENCE_MAP: Partial<Record<AllowedTable, { table: string; column: string }[]>> = {
  cat_classifications: [{ table: "cases", column: "classification_id" }],
  cat_statuses: [{ table: "cases", column: "status_id" }],
  cat_institutions: [{ table: "cases", column: "institution_id" }],
  cat_team: [],
};

function isAllowedTable(table: string | null): table is AllowedTable {
  return ALLOWED_TABLES.includes(table as AllowedTable);
}

const ABOGADA_READABLE_TABLES: AllowedTable[] = ["cat_institutions"];

function canRead(role: string, table: AllowedTable): boolean {
  if (role === "admin") return true;
  if (role === "abogada" && ABOGADA_READABLE_TABLES.includes(table)) return true;
  return false;
}

export async function GET(
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

    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table");

    if (!isAllowedTable(table)) {
      return NextResponse.json(
        { error: `Tabla inválida. Use: ${ALLOWED_TABLES.join(", ")}` },
        { status: 400 }
      );
    }

    if (!canRead(profile.role, table)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const itemId = params.id;
    const refs = REFERENCE_MAP[table] ?? [];

    let total = 0;
    for (const ref of refs) {
      const { count } = await admin
        .from(ref.table)
        .select("id", { count: "exact", head: true })
        .eq(ref.column, itemId)
        .eq("tenant_id", profile.tenant_id);
      total += count ?? 0;
    }

    return NextResponse.json({ count: total }, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in GET /api/admin/catalogs/[id]/usage:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

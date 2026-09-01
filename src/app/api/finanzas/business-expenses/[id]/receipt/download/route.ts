/**
 * GET /api/finanzas/business-expenses/[id]/receipt/download
 *
 * El comprobante de un gasto DEL BUFETE (compras), servido por el dominio de la
 * app. Ver `src/lib/storage/serve-file.ts` para el porqué.
 *
 * Este caso era distinto de los otros: la URL firmada NO se generaba en una ruta
 * de API sino en el propio server component de la pantalla de detalle, y viajaba
 * al navegador como una prop. El síntoma para el usuario era el mismo.
 *
 * PERMISOS: los tres roles de finanzas. El contador SÍ entra — los gastos del
 * bufete son suyos, tiene CRUD completo sobre ellos.
 */
import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serveStorageFile } from "@/lib/storage/serve-file";

export const runtime = "nodejs";

const ALLOWED_ROLES = ["admin", "abogada", "contador"];

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    if (!ALLOWED_ROLES.includes(profile.role as string)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const { data: gasto } = await admin
      .from("business_expenses")
      .select("receipt_url, receipt_filename, supplier_name")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!gasto?.receipt_url) {
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
    }

    return await serveStorageFile({
      admin,
      bucket: "documents",
      storageKey: gasto.receipt_url as string,
      fileName:
        (gasto.receipt_filename as string | null) ??
        `comprobante-${(gasto.supplier_name as string | null) ?? "gasto"}`,
    });
  } catch (err) {
    console.error("[business-expenses/receipt/download] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

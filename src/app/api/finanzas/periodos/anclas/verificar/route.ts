import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { anclasDesdeArchivo } from "@/lib/finanzas/contabilidad/anclas";

export const runtime = "nodejs";

const ROLES = ["admin", "contador"];

/**
 * POST /api/finanzas/periodos/anclas/verificar
 *
 * Compara anclas traídas de AFUERA contra la cadena del libro (075, R-1b).
 * Body: { archivo: <el JSON de la tabla en el respaldo, o una lista a mano> }
 * o { archivo: null } para comparar contra las anclas guardadas en la base.
 *
 * 🔑 SOP-014: el RPC va con el cliente de servicio; el tenant sale del perfil y
 * del archivo sólo se toman las filas de ESE bufete.
 */
export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const archivo = (body as { archivo?: unknown } | null)?.archivo ?? null;

  let anclas: { entry_number: number; hash: string }[] | null = null;
  let ignoradas = 0;
  if (archivo !== null) {
    const r = anclasDesdeArchivo(archivo, ctx.tenantId);
    if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 400 });
    anclas = r.anclas;
    ignoradas = r.ignoradas;
  }

  const { data, error } = await createAdminClient().rpc("verify_chain_anchors", {
    p_tenant_id: ctx.tenantId,
    p_anclas: anclas,
  });
  if (error) {
    console.error("[finanzas/anclas] verify_chain_anchors failed", error);
    return NextResponse.json({ error: "No se pudo verificar la cadena." }, { status: 500 });
  }
  const problemas = (data ?? []) as { nro_asiento: number; problema: string }[];
  return NextResponse.json({
    comparadas: anclas ? anclas.length : null,
    ignoradas,
    problemas,
    coincide: problemas.length === 0,
  });
}

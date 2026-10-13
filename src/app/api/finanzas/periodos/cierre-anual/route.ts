import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { MutationError } from "@/lib/finanzas/api/errors";
import { cerrarEjercicio, prepararCierre } from "@/lib/finanzas/api/cierre-anual";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

export const runtime = "nodejs";

// Los mismos que cierran y reabren períodos (/finanzas/periodos): admin y
// contador. La abogada no entra a esa pantalla (ADMIN_CONTADOR_ONLY_PREFIXES).
const ROLES = ["admin", "contador"] as const;

function anioDe(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * GET /api/finanzas/periodos/cierre-anual?anio=2026
 * La vista previa del asiento de cierre (o el cierre vigente, si ya existe).
 * 🔑 El tenant sale del perfil; los RPC van con el cliente de servicio.
 */
export const GET = conManejoDeAuditoria(async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  const anio = anioDe(new URL(request.url).searchParams.get("anio"));
  try {
    const prep = await prepararCierre(ctx.db, createAdminClient(ctx.userId), ctx.tenantId, anio);
    return NextResponse.json(prep, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[finanzas] GET cierre-anual unexpected error", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

/**
 * POST /api/finanzas/periodos/cierre-anual  { anio: 2026 }
 * Postea el asiento de cierre. Las líneas NO vienen del body: se vuelven a
 * armar acá con los saldos de la base, y el RPC las verifica.
 */
export const POST = conManejoDeAuditoria(async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const anio = anioDe((body as { anio?: unknown } | null)?.anio);
  try {
    const r = await cerrarEjercicio(ctx.db, createAdminClient(ctx.userId), ctx.tenantId, ctx.userId, anio);
    return NextResponse.json(r, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[finanzas] POST cierre-anual unexpected error", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

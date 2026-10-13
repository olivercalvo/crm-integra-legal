import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { MutationError } from "@/lib/finanzas/api/errors";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";
import { asignarBancoACobros } from "@/lib/finanzas/api/asignaciones-documentos";

/**
 * POST /api/finanzas/asientos/documentos-existentes/bancos
 *
 * Asigna en lote el banco a cobros SIN asiento.
 * Para contabilizar los documentos existentes (097). Un documento con asiento
 * no se toca: si uno del lote no se puede, no se escribe ninguno (409).
 *
 * Admin y contador (Oliver, 07/10/2026), los mismos que contabilizan el mes.
 * El tenant sale del perfil; `ctx.db` lleva al usuario a la bitácora contable.
 */
const ROLES = ["admin", "contador"] as const;

export const POST = conManejoDeAuditoria(async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json(await asignarBancoACobros(ctx.db, ctx.tenantId, body));
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
});

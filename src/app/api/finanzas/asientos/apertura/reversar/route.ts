import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rechazoSiPosteoHistoricoApagado } from "@/lib/finanzas/posteo-historico";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { MutationError } from "@/lib/finanzas/api/errors";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";
import { reversarApertura } from "@/lib/finanzas/api/apertura";

/**
 * POST /api/finanzas/asientos/apertura/reversar { motivo }
 * Reversa la apertura vigente con su MISMA fecha y sólo con su mes abierto
 * (101). Admin y contador. El tenant sale del perfil.
 */
const ROLES = ["admin", "contador"] as const;

export const POST = conManejoDeAuditoria(async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  // Interruptor (07/10): apagado, la apertura no se reversa (403).
  const apagado = rechazoSiPosteoHistoricoApagado();
  if (apagado) return apagado;
  let body: { motivo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json(await reversarApertura(ctx.db, createAdminClient(ctx.userId), ctx.tenantId, ctx.userId, body?.motivo));
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
});

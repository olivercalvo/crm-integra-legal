import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { MutationError } from "@/lib/finanzas/api/errors";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";
import { contabilizarPlan, planearPosteo, rangoDelMes } from "@/lib/finanzas/contabilidad/posteo-retroactivo";
import { excelDelPlan } from "@/lib/finanzas/contabilidad/posteo-retroactivo-excel";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";

/**
 * Posteo de documentos existentes, por mes (097). Admin y contador: los mismos
 * que cargan asientos de diario y cierran períodos (ADMIN_CONTADOR_ONLY_PREFIXES
 * cubre la pantalla, /finanzas/asientos/documentos-existentes).
 *
 *   GET  ?mes=AAAA-MM  → el Excel EN SECO (no escribe nada).
 *   POST { mes }       → contabiliza el mes, todo o nada (409 si hay bloqueos).
 *
 * El `tenant_id` sale del perfil, nunca del request (SOP-014). El lote va con el
 * cliente de servicio y el usuario en `x-actor-id` (bitácora).
 */
const ROLES = ["admin", "contador"] as const;

function mesDe(v: unknown): { desde: string; hasta: string } | null {
  try {
    return typeof v === "string" ? rangoDelMes(v) : null;
  } catch {
    return null;
  }
}

export const GET = conManejoDeAuditoria(async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  const rango = mesDe(request.nextUrl.searchParams.get("mes"));
  if (!rango) return NextResponse.json({ error: "Indica el mes (AAAA-MM)." }, { status: 400 });

  const plan = await planearPosteo(ctx.db, ctx.tenantId, rango.desde, rango.hasta);
  const buffer = excelDelPlan(plan, `${hoyEnPanama()}`);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="en-seco-${plan.desde}_${plan.hasta}.xlsx"`,
    },
  });
});

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
  const rango = mesDe((body as { mes?: unknown } | null)?.mes);
  if (!rango) return NextResponse.json({ error: "Indica el mes (AAAA-MM)." }, { status: 400 });

  try {
    const plan = await planearPosteo(ctx.db, ctx.tenantId, rango.desde, rango.hasta);
    const r = await contabilizarPlan(ctx.db, createAdminClient(ctx.userId), plan, ctx.userId);
    return NextResponse.json(r, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
});

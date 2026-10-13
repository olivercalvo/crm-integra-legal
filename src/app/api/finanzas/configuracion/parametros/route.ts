import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { getTasaIsr } from "@/lib/finanzas/queries/parametros";
import { validarParametros } from "@/lib/finanzas/validators/parametros";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

// Leer: el mismo set que el resto de /finanzas (la abogada ve la tasa con la
// que sale su Estado de Resultado).
const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;

// 🔴 Escribir: admin y contador, el MISMO criterio que las tasas de impuesto
// (`tax-codes/route.ts`). La RLS de la 078 lo vuelve a exigir.
const ROLES_ESCRITURA = ["admin", "contador"] as const;

/** GET /api/finanzas/configuracion/parametros → { isr_rate } (fracción). */
export const GET = conManejoDeAuditoria(async function GET() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;
  const isr_rate = await getTasaIsr(ctx.db, ctx.tenantId);
  return NextResponse.json({ isr_rate }, { status: 200 });
});

/**
 * PUT /api/finanzas/configuracion/parametros  { isr_rate: 0.25 }
 *
 * El `tenant_id` sale del perfil autenticado, nunca del body. Upsert: un bufete
 * sin fila la gana al guardar.
 */
export const PUT = conManejoDeAuditoria(async function PUT(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ESCRITURA);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const v = validarParametros(body);
  if (!v.ok) return NextResponse.json({ errors: v.errors }, { status: 400 });

  const { error } = await ctx.db.from("finanzas_parametros").upsert(
    {
      tenant_id: ctx.tenantId,
      isr_rate: v.data.isr_rate,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: "tenant_id" }
  );
  if (error) {
    console.error("[finanzas] PUT parametros failed", error);
    return NextResponse.json({ error: "No se pudo guardar la tasa." }, { status: 500 });
  }
  return NextResponse.json({ isr_rate: v.data.isr_rate }, { status: 200 });
});

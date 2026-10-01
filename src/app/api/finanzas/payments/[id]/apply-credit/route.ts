import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { aplicarSaldoAFavor } from "@/lib/finanzas/api/saldo-a-favor";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/payments/[id]/apply-credit
 *
 * Aplica el SALDO A FAVOR de un cobro (lo que quedó sin aplicar) a facturas del
 * mismo cliente. Sin asiento: el dinero ya está en 100004 (migración `074`).
 *
 * Permisos: admin + abogada + CONTADOR (Oliver, 01/10/2026). El contador no
 * registra cobros, pero aplicar un saldo a favor no mete dinero nuevo: dice qué
 * factura cancela un cobro que ya está en el libro. Si se cambia esta lista se
 * mueven juntos la tabla de CLAUDE.md, este guard y `canApplyCredit` en
 * `facturas/[id]/page.tsx`.
 *
 * Body: { applications: [{ invoice_id, amount }] }. El tenant sale del perfil,
 * nunca del body (SOP-014).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const crudas = (body as { applications?: unknown } | null)?.applications;
  if (!Array.isArray(crudas)) {
    return NextResponse.json({ error: "Faltan las facturas a las que aplicar el saldo." }, { status: 400 });
  }
  const aplicaciones = crudas.map((a) => ({
    invoice_id: String((a as { invoice_id?: unknown })?.invoice_id ?? ""),
    amount: Number((a as { amount?: unknown })?.amount),
  }));

  try {
    const r = await aplicarSaldoAFavor(ctx.db, createAdminClient(), ctx.tenantId, ctx.userId, params.id, aplicaciones);
    return NextResponse.json(r, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] apply-credit unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

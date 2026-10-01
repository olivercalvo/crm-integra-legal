import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { applyCreditNote } from "@/lib/finanzas/api/credit-notes";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/finanzas/credit-notes/[id]/apply
 *
 * Aplica el SALDO A FAVOR de una nota de crédito sin factura (E8, `076`) a una
 * factura del mismo cliente. Sin asiento: el crédito ya está en 100004.
 *
 * Permisos: admin, abogada y contador, el mismo criterio que «Aplicar saldo a
 * favor» de un cobro (074): no mete dinero nuevo, dice qué factura cancela un
 * crédito que ya está en el libro.
 *
 * Body: { invoice_id, amount }. El tenant sale del perfil, nunca del body.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: { invoice_id?: unknown; amount?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const invoiceId = String(body?.invoice_id ?? "");
  const amount = Number(body?.amount);
  if (!UUID_RE.test(params.id) || !UUID_RE.test(invoiceId)) {
    return NextResponse.json({ error: "Elige la factura." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "El monto a aplicar tiene que ser mayor que cero." }, { status: 400 });
  }

  try {
    const r = await applyCreditNote(createAdminClient(), ctx.tenantId, ctx.userId, params.id, invoiceId, amount);
    return NextResponse.json(r, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] applyCreditNote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

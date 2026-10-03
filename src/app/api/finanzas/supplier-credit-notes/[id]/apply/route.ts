import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { applySupplierCreditNote } from "@/lib/finanzas/api/supplier-credit-notes";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/finanzas/supplier-credit-notes/[id]/apply
 *
 * Aplica el SALDO A FAVOR de una nota de crédito de proveedor registrada sin
 * compra (E8, `076`) a una compra del mismo proveedor. Sin asiento: el crédito
 * ya está en 200001 a nombre del proveedor.
 *
 * Permisos: admin, abogada y contador (los que registran la NC de compra).
 * Body: { business_expense_id, amount }. El tenant sale del perfil.
 */
const MUTATING_ROLES = ["admin", "abogada", "contador"] as const;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: { business_expense_id?: unknown; amount?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const compraId = String(body?.business_expense_id ?? "");
  const amount = Number(body?.amount);
  if (!UUID_RE.test(params.id) || !UUID_RE.test(compraId)) {
    return NextResponse.json({ error: "Elige la compra." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "El monto a aplicar tiene que ser mayor que cero." }, { status: 400 });
  }

  try {
    const r = await applySupplierCreditNote(createAdminClient(ctx.userId), ctx.tenantId, ctx.userId, params.id, compraId, amount);
    return NextResponse.json(r, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] applySupplierCreditNote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

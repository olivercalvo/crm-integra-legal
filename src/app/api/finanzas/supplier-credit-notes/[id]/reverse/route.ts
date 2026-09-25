import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { reverseSupplierCreditNote } from "@/lib/finanzas/api/supplier-credit-notes";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/supplier-credit-notes/[id]/reverse
 *
 * Anula una NC de compra con su reversión fechada HOY (RPC
 * `reverse_supplier_credit_note`, `066`): espejo verificado + `anulada` en una
 * transacción, y el trigger devuelve el saldo a la compra.
 *
 * Permisos: admin, abogada y contador, los mismos que registrarla.
 */
const MUTATING_ROLES = ["admin", "abogada", "contador"] as const;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const reason = String((body as { reason?: unknown } | null)?.reason ?? "");
  try {
    const r = await reverseSupplierCreditNote(ctx.db, createAdminClient(), ctx.tenantId, ctx.userId, params.id, reason);
    return NextResponse.json(r, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      const cuerpo: Record<string, unknown> = { error: err.message };
      if (err.status === 400) cuerpo.fieldErrors = { reason: err.message };
      return NextResponse.json(cuerpo, { status: err.status });
    }
    console.error("[finanzas] reverseSupplierCreditNote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { deletePayment } from "@/lib/finanzas/api/payments";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

/**
 * DELETE /api/finanzas/payments/[id]
 *
 * Elimina un pago. T6 (no_delete trigger) rechaza si status != 'registrado'.
 * CASCADE limpia la payment_application asociada y T7a recalcula
 * invoice.amount_paid + status automáticamente (puede revertir 'pagada' o
 * 'parc_pagada' → 'emitida').
 *
 * Permisos: admin + abogada (D4). Asistente y contador → 403.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    await deletePayment(ctx.db, ctx.tenantId, params.id);
    return NextResponse.json({ id: params.id }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] deletePayment failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] deletePayment unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { deleteSupplierPayment } from "@/lib/finanzas/api/supplier-payments";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

/**
 * DELETE /api/finanzas/supplier-payments/[id] — elimina un pago SIN asiento
 * (incluidos los saldos heredados de la 048). Con asiento → 409, reversar.
 * Permisos: los de mutar compras (admin, abogada, contador).
 */
const MUTATING_ROLES = ["admin", "abogada", "contador"] as const;

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    await deleteSupplierPayment(ctx.db, ctx.tenantId, params.id);
    return NextResponse.json({ id: params.id }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] deleteSupplierPayment failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] deleteSupplierPayment unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

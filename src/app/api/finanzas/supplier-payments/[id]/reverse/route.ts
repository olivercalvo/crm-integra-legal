import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { reverseSupplierPayment } from "@/lib/finanzas/api/supplier-payments";
import { MutationError } from "@/lib/finanzas/api/errors";
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/finanzas/contabilidad/reversion";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/supplier-payments/[id]/reverse — reversa un pago a
 * proveedor contabilizado (RPC `reverse_supplier_payment`, 048): espejo con la
 * fecha de hoy + pago anulado, una transacción; el trigger devuelve la compra.
 * Body: { reason }. Permisos: los de mutar compras (admin, abogada, contador).
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

  const raw = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < MOTIVO_MIN || reason.length > MOTIVO_MAX) {
    return NextResponse.json(
      {
        error: "Validación fallida",
        fieldErrors: {
          reason: `El motivo de la reversión debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`,
        },
      },
      { status: 400 }
    );
  }

  try {
    const result = await reverseSupplierPayment(
      ctx.db,
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      params.id,
      reason
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] reverseSupplierPayment failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] reverseSupplierPayment unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

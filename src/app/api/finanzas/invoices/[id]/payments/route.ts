import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateCreatePayment } from "@/lib/finanzas/validators/payment";
import { createPayment } from "@/lib/finanzas/api/payments";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/invoices/[id]/payments
 *
 * Registra un pago aplicado al 100% contra la factura indicada. Crea el
 * payment + la payment_application en la misma operación lógica
 * (compensating delete si la application falla).
 *
 * Permisos: admin + abogada (D4). Asistente y contador → 403.
 *
 * Body esperado: { payment_date, amount, method, reference?, notes? }
 *   (invoice_id se inyecta desde el path param)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // Inyectar invoice_id del path al payload antes de validar
  const payload = {
    ...(body as Record<string, unknown>),
    invoice_id: params.id,
  };

  const validation = validateCreatePayment(payload);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await createPayment(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      validation.data
    );
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createPayment failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createPayment unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

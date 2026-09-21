import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateCreatePayment } from "@/lib/finanzas/validators/payment";
import { createPayment } from "@/lib/finanzas/api/payments";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

/**
 * POST /api/finanzas/payments — registrar un recibo de caja aplicado a UNA O
 * VARIAS facturas del mismo cliente (Parte B del Bloque 2, 21/09/2026).
 *
 * Body: { payment_date, amount, method, payment_account_code, reference?, notes?,
 *         applications: [{ invoice_id, amount }, …] }
 *
 * `amount` == suma de `applications`; el validador rechaza el excedente con un
 * mensaje que dice qué hacer. Es la MISMA `createPayment` que usa
 * `POST /api/finanzas/invoices/[id]/payments` (el atajo de una factura del
 * diálogo del detalle): un solo helper, un solo correlativo, un solo asiento.
 *
 * Permisos: admin + abogada. Contador y asistente → 403 (el contador ve el
 * listado de cobros pero no registra). El tenant sale del contexto
 * autenticado, nunca del body.
 */
export async function POST(request: NextRequest) {
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

  const validation = validateCreatePayment(body as Record<string, unknown>);
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
      validation.data,
      // 🔑 SOP-014: el posteo va con el cliente de SERVICIO; el tenant sale del
      //    contexto autenticado, nunca del body.
      createAdminClient()
    );
    return NextResponse.json(
      { id: result.id, payment_number: result.payment_number },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createPayment (multi) failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createPayment (multi) unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

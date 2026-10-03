import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
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
 * Body esperado: { payment_date, amount, method, payment_account_code, reference?, notes? }
 *
 * Desde la Parte B (21/09/2026) es el ATAJO de una sola aplicación: envuelve
 * el body en `applications: [{ invoice_id: <path>, amount }]` y llama a la
 * MISMA `createPayment` que `POST /api/finanzas/payments`. Es lo que usa el
 * diálogo "Registrar pago" del detalle de la factura, que no cambió.
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

  // La factura del path = la única aplicación. 074: lo APLICADO es el menor
  // entre el monto y el saldo de la factura; el resto queda como saldo a favor
  // del cliente (amount_unapplied). El saldo se lee acá, con la sesión (RLS).
  const b = (body ?? {}) as Record<string, unknown>;
  const { data: fac } = await ctx.db
    .from("invoices")
    .select("balance_due")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", params.id)
    .maybeSingle();
  const monto = Number(b.amount);
  const saldo = fac ? Number((fac as { balance_due: number | string }).balance_due) : NaN;
  const aplicado =
    isFinite(monto) && isFinite(saldo) && saldo > 0 ? Math.min(monto, Math.round(saldo * 100) / 100) : monto;
  const payload = {
    ...b,
    applications: [{ invoice_id: params.id, amount: aplicado }],
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
      validation.data,
      // 🔑 SOP-014: el posteo va con el cliente de SERVICIO; el tenant sale del
      //    contexto autenticado, nunca del body.
      createAdminClient(ctx.userId)
    );
    // El número de recibo viaja en la respuesta para el toast ("Recibo REC-000012
    // registrado") y para el enlace al PDF.
    return NextResponse.json(
      { id: result.id, payment_number: result.payment_number },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createPayment failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createPayment unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

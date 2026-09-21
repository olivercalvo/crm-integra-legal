/**
 * POST /api/expenses/[id]/payments — registrar el PAGO de un gasto de trámite
 * (Bloque 4, 049). Es la segunda transacción de Josuarth: el gasto ya acreditó
 * 200001 al registrarse; el pago la debita contra el banco. Mismo motor que el
 * pago de una compra (`createSupplierPayment`, serie `CE-`, comprobante de
 * egreso, reversión por `reverse_supplier_payment`), con `expense_id` en vez
 * de `business_expense_id` (arco exclusivo).
 *
 * Body: { payment_date, amount, method, payment_account_code, reference?, notes? }
 *
 * Roles: admin, abogada y contador. Son la UNIÓN de las dos entradas que
 * decidió Oliver (21/09): (a) "ya se pagó" en el formulario del caso — admin y
 * abogada — y (b) "Registrar pago" en /finanzas/gastos-tramite/{id} — admin y
 * contador. Cada pantalla ofrece el botón a su rol; el servidor admite a los
 * tres porque los tres tienen una puerta legítima. El asistente no.
 *
 * El tenant sale del contexto autenticado, nunca del request.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateCreateSupplierPayment } from "@/lib/finanzas/validators/supplier-payment";
import { createSupplierPayment } from "@/lib/finanzas/api/supplier-payments";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

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

  // El destino sale del PATH: un body con `business_expense_id` no puede
  // convertir esto en un pago de compra.
  const validation = validateCreateSupplierPayment({
    ...((body ?? {}) as Record<string, unknown>),
    business_expense_id: null,
    expense_id: params.id,
  });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await createSupplierPayment(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      validation.data,
      // 🔑 SOP-014: el posteo va con el cliente de SERVICIO.
      createAdminClient()
    );
    return NextResponse.json(
      { id: result.id, payment_number: result.payment_number },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createSupplierPayment (trámite) failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createSupplierPayment (trámite) unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

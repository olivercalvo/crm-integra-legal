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

/**
 * POST /api/finanzas/business-expenses/[id]/payments — registrar un pago a
 * proveedor contra la compra del path (Bloque 3, 048). Reemplaza a
 * `/mark-paid` (FND-009). Pago parcial permitido; un pago = una compra.
 *
 * Body: { payment_date, amount, method, payment_account_code, reference?, notes? }
 *
 * Permisos: los MISMOS que mutar compras (admin, abogada, contador — el
 * contador tiene CRUD en Gastos del Bufete desde el 24/08). El tenant sale del
 * contexto autenticado, nunca del body.
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

  const validation = validateCreateSupplierPayment({
    ...((body ?? {}) as Record<string, unknown>),
    business_expense_id: params.id,
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
      console.error("[finanzas] createSupplierPayment failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createSupplierPayment unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

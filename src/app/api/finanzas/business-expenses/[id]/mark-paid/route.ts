import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateMarkAsPaid } from "@/lib/finanzas/validators/business-expense";
import { markBusinessExpenseAsPaid } from "@/lib/finanzas/api/business-expenses";
import { MutationError } from "@/lib/finanzas/api/errors";

const MUTATING_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * POST /api/finanzas/business-expenses/[id]/mark-paid
 *
 * Atajo para cambiar un gasto pendiente_pago → pagado, con fecha de pago y
 * método. Equivalente a un PATCH con esos 3 campos, pero más explícito
 * desde la UI (botón "Marcar como pagado").
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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

  const validation = validateMarkAsPaid(body as { payment_date?: unknown; payment_method?: unknown });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    await markBusinessExpenseAsPaid(
      ctx.db,
      ctx.tenantId,
      params.id,
      ctx.userId,
      validation.data.payment_date,
      validation.data.payment_method
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] markBusinessExpenseAsPaid failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] markBusinessExpenseAsPaid unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

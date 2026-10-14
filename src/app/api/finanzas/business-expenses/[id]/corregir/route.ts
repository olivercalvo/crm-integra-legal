import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateUpdateBusinessExpense } from "@/lib/finanzas/validators/business-expense";
import { corregirBusinessExpense } from "@/lib/finanzas/api/business-expenses";
import { MutationError } from "@/lib/finanzas/api/errors";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

/**
 * POST /api/finanzas/business-expenses/[id]/corregir
 *   { ...los campos de la compra, motivo, entry_esperado }
 *
 * Corrige una compra CONTABILIZADA (103): reversa el asiento vigente y registra
 * el corregido en una sola transacción, con motivo. Los mismos roles que editan
 * compras (admin, abogada y contador). El tenant sale del perfil; el libro se
 * escribe con el cliente de servicio y el usuario en x-actor-id (bitácora).
 */
const MUTATING_ROLES = ["admin", "abogada", "contador"] as const;

export const POST = conManejoDeAuditoria(async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateUpdateBusinessExpense(
    body as Parameters<typeof validateUpdateBusinessExpense>[0]
  );
  if (!validation.ok) {
    return NextResponse.json({ error: "Validación fallida", fieldErrors: validation.errors }, { status: 400 });
  }

  try {
    const r = await corregirBusinessExpense(
      ctx.db,
      createAdminClient(ctx.userId),
      ctx.tenantId,
      ctx.userId,
      params.id,
      validation.data,
      body.motivo,
      body.entry_esperado
    );
    return NextResponse.json(r, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message, fieldErrors: err.fieldErrors }, { status: err.status });
    }
    throw err;
  }
});

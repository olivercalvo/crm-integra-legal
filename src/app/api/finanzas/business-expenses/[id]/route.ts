import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateUpdateBusinessExpense } from "@/lib/finanzas/validators/business-expense";
import {
  updateBusinessExpense,
  deleteBusinessExpense,
} from "@/lib/finanzas/api/business-expenses";
import { getBusinessExpenseById } from "@/lib/finanzas/queries/business-expenses";
import { MutationError } from "@/lib/finanzas/api/errors";

const MUTATING_ROLES = ["admin", "contador"] as const;
const READING_ROLES = ["admin", "abogada", "contador"] as const;

/** GET — detalle. Admin/abogada/contador. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!READING_ROLES.includes(ctx.userRole as (typeof READING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const row = await getBusinessExpenseById(ctx.db, ctx.tenantId, params.id);
  if (!row) {
    return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ data: row }, { status: 200 });
}

/** PATCH — actualizar campos. Admin + contador. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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

  const validation = validateUpdateBusinessExpense(
    body as Parameters<typeof validateUpdateBusinessExpense>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await updateBusinessExpense(
      ctx.db,
      ctx.tenantId,
      params.id,
      ctx.userId,
      validation.data
    );
    return NextResponse.json({ id: result.id }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] updateBusinessExpense failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateBusinessExpense unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/** DELETE — hard delete + cleanup de receipt. Admin + contador. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    await deleteBusinessExpense(ctx.db, ctx.tenantId, params.id, ctx.userId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] deleteBusinessExpense failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] deleteBusinessExpense unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

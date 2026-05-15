import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateCreateBusinessExpense } from "@/lib/finanzas/validators/business-expense";
import { createBusinessExpense } from "@/lib/finanzas/api/business-expenses";
import { listBusinessExpenses } from "@/lib/finanzas/queries/business-expenses";
import { MutationError } from "@/lib/finanzas/api/errors";
import type { BusinessExpenseStatus } from "@/lib/finanzas/types/business-expense";

const ALLOWED_STATUSES = new Set<BusinessExpenseStatus>([
  "pendiente_pago",
  "pagado",
]);

const MUTATING_ROLES = ["admin", "contador"] as const;
const READING_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * GET /api/finanzas/business-expenses
 *
 * Lista paginada de gastos del bufete con filtros. Solo lectura para admin,
 * abogada y contador. Los asistentes ya quedan fuera de /finanzas por
 * middleware; igual rechazamos acá por defensa en profundidad.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!READING_ROLES.includes(ctx.userRole as (typeof READING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const url = new URL(request.url);
  const sp = url.searchParams;

  const statusRaw = sp.get("status");
  const status = statusRaw && ALLOWED_STATUSES.has(statusRaw as BusinessExpenseStatus)
    ? (statusRaw as BusinessExpenseStatus)
    : null;

  const hasItbmsRaw = sp.get("has_itbms");
  const hasItbms =
    hasItbmsRaw === "true" ? true
      : hasItbmsRaw === "false" ? false
      : null;

  const result = await listBusinessExpenses(ctx.db, ctx.tenantId, {
    status,
    accountCode: sp.get("account") || null,
    fromDate: sp.get("from") || null,
    toDate: sp.get("to") || null,
    hasItbms,
    search: sp.get("q") || null,
    page: Math.max(1, parseInt(sp.get("page") ?? "1", 10)),
  });

  return NextResponse.json(result, { status: 200 });
}

/**
 * POST /api/finanzas/business-expenses
 *
 * Crea un gasto del bufete. Solo admin + contador (las abogadas tienen
 * acceso de lectura pero no escritura — la RLS también lo enforza).
 */
export async function POST(request: NextRequest) {
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

  const validation = validateCreateBusinessExpense(
    body as Parameters<typeof validateCreateBusinessExpense>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await createBusinessExpense(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      validation.data
    );
    return NextResponse.json({ id: result.id, total: result.total }, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createBusinessExpense failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createBusinessExpense unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

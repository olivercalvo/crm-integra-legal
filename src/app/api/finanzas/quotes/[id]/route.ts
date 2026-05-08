import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { getQuoteById } from "@/lib/finanzas/queries/quotes";
import { updateQuote, deleteQuote, validateUpdateQuote } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

/** GET /api/finanzas/quotes/[id] — detalle con líneas + cliente + caso. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const quote = await getQuoteById(ctx.db, ctx.tenantId, params.id);
  if (!quote) {
    return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
  }
  return NextResponse.json(quote);
}

/** PATCH /api/finanzas/quotes/[id] — actualiza header + líneas (solo borradores). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateUpdateQuote(
    body as Parameters<typeof validateUpdateQuote>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await updateQuote(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id,
      validation.data
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] updateQuote failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateQuote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/** DELETE /api/finanzas/quotes/[id] — solo borradores o canceladas pre-envío. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await deleteQuote(ctx.db, ctx.tenantId, params.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] deleteQuote failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] deleteQuote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

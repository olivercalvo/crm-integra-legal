import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { cancelQuote, validateCancelQuote } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * POST /api/finanzas/quotes/[id]/cancel
 * Cancela un borrador (status='borrador' → 'cancelada_pre_envio').
 *
 * Body opcional: { reason?: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Body opcional — si no viene, seguimos con reason=null.
    body = null;
  }

  const validation = validateCancelQuote(
    body as Parameters<typeof validateCancelQuote>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await cancelQuote(
      ctx.db,
      ctx.tenantId,
      params.id,
      validation.data.reason ?? null
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] cancelQuote failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] cancelQuote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

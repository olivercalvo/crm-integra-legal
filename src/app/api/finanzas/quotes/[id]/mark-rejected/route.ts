import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { markRejectedManual, validateMarkRejected } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * POST /api/finanzas/quotes/[id]/mark-rejected
 * Escape hatch (D5): marca la cotización como rechazada manualmente.
 * Status: 'enviada' → 'rechazada'. Razón opcional.
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
    body = null;
  }

  const validation = validateMarkRejected(
    body as Parameters<typeof validateMarkRejected>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await markRejectedManual(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id,
      validation.data.reason ?? null
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] markRejectedManual failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] markRejectedManual unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

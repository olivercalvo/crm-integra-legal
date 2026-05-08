import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { markAcceptedManual } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * POST /api/finanzas/quotes/[id]/mark-accepted
 * Escape hatch (D1): marca la cotización como aceptada manualmente cuando
 * el cliente confirma offline (email, llamada, presencial). Status:
 * 'enviada' → 'aceptada'. approved_by_ip/user_agent quedan NULL para
 * distinguir de aceptaciones via portal.
 *
 * Sin body. La identidad del operador queda en sent_by/created_by trail.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await markAcceptedManual(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] markAcceptedManual failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] markAcceptedManual unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

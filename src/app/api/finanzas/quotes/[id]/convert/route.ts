import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { convertToInvoices } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * POST /api/finanzas/quotes/[id]/convert
 * Convierte una cotización aceptada en 1 o 2 facturas (D2: una por
 * invoice_kind presente). Status: 'aceptada' → 'convertida'.
 *
 * Validaciones:
 *   - status='aceptada'
 *   - cliente.client_status='active' (sino el gate de createInvoice rebota
 *     y convertToInvoices throws con mensaje claro)
 *   - hay >= 1 línea
 *
 * Sin body.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await convertToInvoices(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] convertToInvoices failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] convertToInvoices unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

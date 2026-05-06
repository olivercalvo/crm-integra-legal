import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { emitInvoice, InvoiceMutationError } from "@/lib/finanzas/api/invoices";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/invoices/[id]/emit
 * Emite la factura: genera número con get_next_sequence_number y transiciona
 * a status='emitida'. T2 valida la transición.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await emitInvoice(ctx.db, ctx.tenantId, params.id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof InvoiceMutationError) {
      console.error("[finanzas] emitInvoice failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] emitInvoice unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

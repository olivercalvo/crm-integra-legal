import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitInvoice, InvoiceMutationError } from "@/lib/finanzas/api/invoices";

interface RouteParams {
  params: { id: string };
}

export const runtime = "nodejs";

/**
 * POST /api/finanzas/invoices/[id]/emit
 * Emite la factura: genera número con get_next_sequence_number, **registra el
 * asiento contable** y transiciona a status='emitida'. T2 valida la transición.
 *
 * 🔑 SOP-014: el posteo necesita el cliente de SERVICIO —desde la `030` el RPC
 * tiene `EXECUTE` solo para `service_role`— y el `tenant_id` sale del contexto
 * autenticado (`ctx.tenantId`), NUNCA del cuerpo del request. Esta ruta no lee
 * el body en absoluto.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await emitInvoice(
      ctx.db,
      ctx.tenantId,
      params.id,
      createAdminClient(),
      ctx.userId
    );
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

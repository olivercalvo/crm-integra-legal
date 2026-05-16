import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  cancelInvoice,
  validateCancelInput,
  InvoiceMutationError,
} from "@/lib/finanzas/api/invoices";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/invoices/[id]/cancel
 *
 * Anula una factura emitida sin pagos. Genera una nota de crédito mirror
 * automáticamente. Si la factura tiene pagos aplicados, rechaza con
 * mensaje claro pidiendo eliminar los pagos primero.
 *
 * Permisos: admin + abogada (Sprint 2C, D4 + D5). Anteriormente contador
 * podía anular; este sprint lo deja solo en lectura del módulo.
 *
 * Validación:
 *   - reason trimeado, longitud >= 3 (validador en api/invoices.ts).
 *
 * Body esperado: { reason: string }
 *
 * Respuesta exitosa: { id, credit_note_id, credit_note_number }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateCancelInput(
    body as Parameters<typeof validateCancelInput>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await cancelInvoice(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id,
      validation.data.reason,
      validation.data.observations ?? null
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof InvoiceMutationError) {
      console.error(
        "[finanzas] cancelInvoice failed:",
        err.message,
        err.detail
      );
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] cancelInvoice unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

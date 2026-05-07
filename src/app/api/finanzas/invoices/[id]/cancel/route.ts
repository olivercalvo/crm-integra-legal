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
 * Anula una factura emitida (o parcialmente_pagada). Persiste razón en
 * cancellation_reason y timestamp en cancelled_at.
 *
 * Permisos: admin, abogada y contador. Asistente queda fuera (solo registra
 * pagos / actualiza estado de tareas, no toma decisiones de anulación).
 *
 * Validación:
 *   - reason trimeado, longitud >= 3 (validador en api/invoices.ts).
 *
 * Body esperado: { reason: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(ctx.userRole)) {
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
    await cancelInvoice(ctx.db, ctx.tenantId, params.id, validation.data.reason);
    return NextResponse.json({ id: params.id }, { status: 200 });
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

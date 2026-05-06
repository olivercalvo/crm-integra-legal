import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateUpdateInvoice } from "@/lib/finanzas/validators/invoice";
import { updateInvoice, deleteInvoice, InvoiceMutationError } from "@/lib/finanzas/api/invoices";

interface RouteParams {
  params: { id: string };
}

/**
 * PATCH /api/finanzas/invoices/[id]
 * Actualiza una factura en estado borrador (T4 enforza el guard server-side).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const validation = validateUpdateInvoice(body as Parameters<typeof validateUpdateInvoice>[0]);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    await updateInvoice(ctx.db, ctx.tenantId, ctx.userId, params.id, validation.data);
    return NextResponse.json({ id: params.id }, { status: 200 });
  } catch (err) {
    if (err instanceof InvoiceMutationError) {
      console.error("[finanzas] updateInvoice failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateInvoice unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/**
 * DELETE /api/finanzas/invoices/[id]
 * Elimina una factura. T6 rechaza si no es borrador.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    await deleteInvoice(ctx.db, ctx.tenantId, params.id);
    return NextResponse.json({ id: params.id }, { status: 200 });
  } catch (err) {
    if (err instanceof InvoiceMutationError) {
      console.error("[finanzas] deleteInvoice failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] deleteInvoice unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateCreateInvoice } from "@/lib/finanzas/validators/invoice";
import { createInvoice, InvoiceMutationError } from "@/lib/finanzas/api/invoices";

/**
 * POST /api/finanzas/invoices
 * Crea una factura en estado borrador con sus líneas.
 *
 * Auth: admin + abogada (asistentes ya quedan fuera de /finanzas por
 * middleware; igual rechazamos acá por defensa en profundidad).
 */
export async function POST(request: NextRequest) {
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

  const validation = validateCreateInvoice(body as Parameters<typeof validateCreateInvoice>[0]);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await createInvoice(ctx.db, ctx.tenantId, ctx.userId, validation.data);
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    if (err instanceof InvoiceMutationError) {
      console.error("[finanzas] createInvoice failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createInvoice unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

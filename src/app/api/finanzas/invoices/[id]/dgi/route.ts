import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  updateInvoiceDgiData,
  validateDgiInput,
  InvoiceMutationError,
} from "@/lib/finanzas/api/invoices";

interface RouteParams {
  params: { id: string };
}

/**
 * PATCH /api/finanzas/invoices/[id]/dgi
 *
 * Registra/actualiza los 4 datos oficiales que devuelve eFactura DGI tras
 * replicar la factura interna. Las columnas dgi_* no están en la whitelist
 * del trigger de inmutabilidad (T4), así que se pueden actualizar incluso
 * en facturas emitidas / pagadas / anuladas — eso es por diseño (sprint
 * pre-integración eFactura, decisión D5).
 *
 * Permisos: admin y abogada únicamente. Asistente y contador no pueden
 * modificar esta info.
 *
 * Validación: server-side via validateDgiInput() en api/invoices.ts.
 *   - numero_documento exactamente 10 dígitos (formato '0000001234')
 *   - URL del CAFE debe ser parseable por `new URL()` si se provee
 *   - fecha_autorizacion debe ser una fecha válida si se provee
 *
 * El handler NO valida que la factura esté emitida — eso lo hace
 * updateInvoiceDgiData() server-side, que devuelve 400 si está en borrador
 * o cancelada_pre_emision.
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

  const validation = validateDgiInput(
    body as Parameters<typeof validateDgiInput>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    await updateInvoiceDgiData(ctx.db, ctx.tenantId, params.id, validation.data);
    return NextResponse.json({ id: params.id }, { status: 200 });
  } catch (err) {
    if (err instanceof InvoiceMutationError) {
      console.error(
        "[finanzas] updateInvoiceDgiData failed:",
        err.message,
        err.detail
      );
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateInvoiceDgiData unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

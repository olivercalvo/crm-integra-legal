import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { MutationError } from "@/lib/finanzas/api/errors";
import { emitInvoiceToEfactura } from "@/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/invoices/[id]/emit-efactura
 *
 * Disparador del flujo de emisión al PAC eFactura PTY. La orquestación vive
 * en `src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura.ts`.
 *
 * Respuestas:
 *   - 200 OK con `EmitToEfacturaResult`. La factura quedó en uno de tres
 *     estados terminales del intento (`authorized` | `pending` | `error`).
 *     El caller decide qué mostrar según `feEstado` + `errorKind`.
 *   - 400 si la factura no está emitida internamente o el cliente no tiene
 *     los datos fiscales mínimos.
 *   - 409 si la factura ya fue enviada al PAC (authorized o pending) o si
 *     otro proceso se adelantó (race).
 *   - 403 sin permiso. 404 si la factura no existe. 500 catch-all.
 *
 * Permisos: admin y abogada (mismo gate que /emit y /dgi).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await emitInvoiceToEfactura(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error(
        "[finanzas/efactura] emitInvoiceToEfactura failed:",
        err.message,
        err.detail
      );
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(
      "[finanzas/efactura] emitInvoiceToEfactura unexpected error:",
      err
    );
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

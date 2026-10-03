import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitInvoice, InvoiceMutationError } from "@/lib/finanzas/api/invoices";
import { MutationError } from "@/lib/finanzas/api/errors";
import { aplicarEnvioAlEmitir, leerModoDeEnvio, type ResultadoDelEnvio } from "@/lib/finanzas/efactura/orchestration/envio-al-emitir";

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
 * autenticado (`ctx.tenantId`), NUNCA del cuerpo del request. Del body sólo se
 * lee `envio` (03/10/2026): «dgi» o «interna», y sólo para una NOTA DE DÉBITO.
 * Sin `envio`, la emisión es la de siempre.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let envio: ReturnType<typeof leerModoDeEnvio> = null;
  try {
    const body = await request.json().catch(() => ({}));
    envio = leerModoDeEnvio((body as { envio?: unknown })?.envio);
    if (envio) {
      // Sólo la ND elige al emitir; una factura sigue con «Enviar a la DGI» aparte.
      const { data: k } = await ctx.db
        .from("invoices")
        .select("invoice_kind")
        .eq("tenant_id", ctx.tenantId)
        .eq("id", params.id)
        .maybeSingle();
      if (k?.invoice_kind !== "NOTA_DEBITO") {
        return NextResponse.json({ error: "Sólo una nota de débito elige el envío al emitirse." }, { status: 400 });
      }
    }
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  try {
    const result = await emitInvoice(
      ctx.db,
      ctx.tenantId,
      params.id,
      createAdminClient(),
      ctx.userId
    );
    // La emisión ya ocurrió (número y asiento). El envío no la deshace.
    let envioResultado: ResultadoDelEnvio | null = null;
    if (envio) {
      envioResultado = await aplicarEnvioAlEmitir(ctx.db, ctx.tenantId, ctx.userId, { tabla: "invoices", id: params.id }, envio).catch(
        (e: unknown) => ({ envio: envio!, fe: { ok: false, feEstado: "no_emitida", mensaje: e instanceof Error ? e.message : String(e) } })
      );
    }
    return NextResponse.json({ ...result, envio: envioResultado }, { status: 200 });
  } catch (err) {
    if (err instanceof InvoiceMutationError) {
      console.error("[finanzas] emitInvoice failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] emitInvoice unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

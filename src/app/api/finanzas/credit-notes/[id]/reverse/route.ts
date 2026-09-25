import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { reversarNotaDeCredito } from "@/lib/finanzas/efactura/orchestration/anular-nota-de-credito-ante-dgi";
import { MutationError } from "@/lib/finanzas/api/errors";
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/finanzas/contabilidad/reversion";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/credit-notes/[id]/reverse
 *
 * Reversa una nota de crédito contabilizada: asiento espejo con la fecha de
 * hoy y la NC marcada `anulada`, las dos en UNA transacción dentro del RPC
 * `reverse_credit_note` (migración `060`).
 *
 * 🔴 El saldo de la factura NO se toca acá ni en el RPC: `credited_total` es
 * derivada desde la `051`, y `balance_due` y el `status` cuelgan de ella. Al
 * marcar la NC `anulada`, el trigger recalcula los tres solo.
 *
 * Permisos: admin + abogada + **contador**, la MISMA lista que reversar un
 * cobro, un pago a proveedor o un gasto de trámite. El criterio es el de la
 * guía de RM: corregir el libro es trabajo del contador. ⚠️ EMITIR una nota de
 * crédito sigue siendo admin + abogada — el contador reversa, no emite, igual
 * que con los cobros. Asistente → 403.
 *
 * 🔴 DESDE EL 25/09/2026 UNA NC AUTORIZADA SE ANULA ANTE LA DGI PRIMERO.
 * La ruta ya no llama a `reverseCreditNote` directo: pasa por
 * `reversarNotaDeCredito`, que le pregunta a la matriz. Si la NC está viva ante
 * la DGI (dentro de las 182 h), la anula ahí primero y recién después reversa
 * el libro, con el orden y los tres caminos de falla de la factura (D3). Antes,
 * «Reversar» dejaba la NC anulada en el libro y viva ante la DGI.
 *
 * Códigos: 200 reversada · 409 anulada en la DGI y falta el libro · 422 la DGI
 * rechazó · 502 no sabemos si llegó. Los mismos de `…/invoices/[id]/cancel`.
 *
 * Body esperado: { reason }
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

  const raw = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < MOTIVO_MIN || reason.length > MOTIVO_MAX) {
    return NextResponse.json(
      {
        error: "Validación fallida",
        fieldErrors: {
          reason: `El motivo de la reversión debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`,
        },
      },
      { status: 400 }
    );
  }

  try {
    const r = await reversarNotaDeCredito(
      ctx.db,
      // 🔑 SOP-014: el RPC va con el cliente de SERVICIO; el tenant sale del
      //    contexto autenticado, nunca del body.
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      params.id,
      reason,
      new Date()
    );
    switch (r.estado) {
      case "reversada":
        return NextResponse.json(r, { status: 200 });
      case "anulada_en_dgi_falta_el_libro":
        console.error("[api] NC anulada en la DGI, falta el libro:", params.id, r.detalle);
        return NextResponse.json({ error: r.mensaje, ...r }, { status: 409 });
      case "rechazada_por_la_dgi":
        return NextResponse.json({ error: r.mensaje, ...r }, { status: 422 });
      case "no_sabemos":
        console.error("[api] anulación de NC sin confirmar:", params.id, `intento #${r.intento}`);
        return NextResponse.json({ error: r.mensaje, ...r }, { status: 502 });
    }
  } catch (err) {
    if (err instanceof MutationError) {
      const cuerpo: Record<string, unknown> = { error: err.message };
      // El 400 del motivo (15 caracteres si viaja a la DGI) va al campo.
      if (err.status === 400) cuerpo.fieldErrors = { reason: err.message };
      return NextResponse.json(cuerpo, { status: err.status });
    }
    console.error("[api] POST credit-notes/[id]/reverse failed", err);
    return NextResponse.json(
      { error: "No se pudo reversar la nota de crédito" },
      { status: 500 }
    );
  }
}

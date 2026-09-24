import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { reverseCreditNote } from "@/lib/finanzas/api/credit-notes";
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
    const result = await reverseCreditNote(
      ctx.db,
      // 🔑 SOP-014: el RPC va con el cliente de SERVICIO; el tenant sale del
      //    contexto autenticado, nunca del body.
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      params.id,
      reason
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api] POST credit-notes/[id]/reverse failed", err);
    return NextResponse.json(
      { error: "No se pudo reversar la nota de crédito" },
      { status: 500 }
    );
  }
}

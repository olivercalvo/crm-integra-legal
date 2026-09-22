/**
 * POST /api/finanzas/credit-notes — emitir una NOTA DE CRÉDITO manual, por
 * líneas de la factura con cantidad (Bloque 5, 22/09/2026).
 *
 * Body: { invoice_id, reason, observations?, lineas: [{ invoice_line_id, quantity }] }
 *
 * Es el camino cuando la factura NO se puede anular (mes cerrado) o cuando la
 * corrección es parcial (Josuarth: factura de mil, NC de doscientos). Crea la
 * NC con `createCreditNote` (la MISMA función que la NC total de la anulación)
 * y postea su asiento PROPIO (`nota_credito`, D5). Fecha de hoy. Si el asiento
 * no puede postearse, la NC se deshace (válvula de la 052).
 *
 * 🔴 Es un documento INTERNO hasta el bloque fiscal: `fe_estado = no_emitida`,
 * y la pantalla y el PDF lo marcan. No se le entrega a una clienta como fiscal.
 *
 * Roles: los que facturan — admin y abogada. El contador no emite documentos
 * de venta (ve la NC en el detalle de la factura, que ya abre en solo lectura).
 * El tenant sale del contexto autenticado, nunca del request.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateCreateCreditNoteInput } from "@/lib/finanzas/validators/credit-note";
import { emitCreditNote } from "@/lib/finanzas/api/credit-notes";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

const MUTATING_ROLES = ["admin", "abogada"] as const;

export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateCreateCreditNoteInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: "Validación fallida", fieldErrors: validation.errors }, { status: 400 });
  }

  try {
    const result = await emitCreditNote(
      ctx.db,
      // 🔑 SOP-014: el posteo (y la compensación) van con el cliente de SERVICIO.
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      validation.data
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] emitCreditNote failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message, fieldErrors: err.fieldErrors ?? undefined }, { status: err.status });
    }
    console.error("[finanzas] emitCreditNote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

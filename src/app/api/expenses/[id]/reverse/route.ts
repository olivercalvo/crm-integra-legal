/**
 * POST /api/expenses/[id]/reverse — reversa un GASTO DE TRÁMITE contabilizado.
 *
 * Bloque 4 (21/09/2026). Body: `{ reason }`. Delega en `reverseExpenseTramite`
 * → RPC `reverse_expense_tramite` (050): espejo con la fecha de hoy + gasto
 * `anulado`, una transacción. Esta ruta no arma líneas.
 *
 * Roles: los MISMOS que reversar un cobro o un pago a proveedor — admin,
 * abogada y contador. El contador NO postea un gasto de trámite (es del módulo
 * Legal) pero SÍ lo reversa: corregir el libro es su trabajo (criterio de RM
 * que ya le dio los asientos manuales y el Reversar de cobros). La pantalla que
 * ofrece el botón es `/finanzas/gastos-tramite/[id]`, que los tres ven.
 *
 * El tenant sale del contexto autenticado, nunca del request.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { reverseExpenseTramite } from "@/lib/finanzas/api/expense-tramite";
import { MutationError } from "@/lib/finanzas/api/errors";
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/finanzas/contabilidad/reversion";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

const MUTATING_ROLES = ["admin", "abogada", "contador"] as const;

export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const result = await reverseExpenseTramite(
      ctx.db,
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      params.id,
      reason
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] reverseExpenseTramite failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] reverseExpenseTramite unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

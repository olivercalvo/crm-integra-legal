/**
 * Mutaciones contables del GASTO DE TRÁMITE (módulo Legal, tabla `expenses`).
 * Bloque 4, 21/09/2026.
 *
 *   reverseExpenseTramite → RPC `reverse_expense_tramite` (050): espejo del
 *   asiento `gasto_tramite` con la fecha de hoy + `expenses.status = 'anulado'`,
 *   en UNA transacción. Es la salida de la inmutabilidad de la 038: desde el
 *   posteo automático (commit 3 de este bloque) un gasto nace en el libro, y
 *   sin esto la única corrección sería un asiento manual.
 *
 * Las líneas del espejo las arma `construirAsientoDeReversion`, la MISMA
 * función que dibuja la vista previa del diálogo; el RPC las verifica, no las
 * recalcula (`reversion-una-sola-implementacion.test.ts` lo vigila).
 *
 * El `tenant_id` llega de la ruta, que lo saca del perfil autenticado (SOP-014).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError } from "@/lib/finanzas/api/errors";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { getAsientoDeGastoTramite } from "@/lib/finanzas/queries/expense-tramite";

type DB = SupabaseClient;

export interface ReverseExpenseTramiteResult {
  entry_id: string;
  entry_number: number;
  reversed_entry_number: number;
  transaction_date: string;
  expense: { id: string; status: string };
}

export async function reverseExpenseTramite(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  expenseId: string,
  reason: string
): Promise<ReverseExpenseTramiteResult> {
  const { data: gasto, error: errGasto } = await db
    .from("expenses")
    .select("id, status, amount_paid")
    .eq("tenant_id", tenantId)
    .eq("id", expenseId)
    .maybeSingle();
  if (errGasto) {
    throw new MutationError("No se pudo leer el gasto", 500, errGasto);
  }
  if (!gasto) {
    throw new MutationError("Gasto no encontrado", 404);
  }
  if (gasto.status === "anulado") {
    throw new MutationError("Este gasto ya está anulado.", 409);
  }
  if (Number(gasto.amount_paid ?? 0) > 0) {
    throw new MutationError(
      "Este gasto tiene pagos registrados. Primero elimine (sin asiento) o reverse (con asiento) " +
        "los pagos; después se reversa el gasto.",
      409
    );
  }

  const original = await getAsientoDeGastoTramite(db, tenantId, expenseId);
  if (!original) {
    throw new MutationError(
      "Este gasto no está en el libro contable, así que no hay nada que reversar. " +
        "Un gasto sin asiento se edita o se elimina desde el caso.",
      409
    );
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const armado = construirAsientoDeReversion(original, { hoy, motivo: reason, source_id: expenseId });
  if (!armado.ok) {
    throw new MutationError(armado.mensaje, 422);
  }

  const { data, error } = await ledgerDb.rpc("reverse_expense_tramite", {
    p_tenant_id: tenantId,
    p_expense_id: expenseId,
    p_reason: armado.asiento.reversal_reason,
    p_transaction_date: armado.asiento.transaction_date,
    p_description: armado.asiento.description,
    p_lines: armado.asiento.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
    })),
    p_created_by: userId,
  });
  if (error) {
    console.error("[finanzas/api] reverse_expense_tramite failed", error);
    throw new MutationError(error.message || "No se pudo reversar el gasto", 422, error);
  }

  const r = data as {
    entry_id: string;
    entry_number: number;
    reversed_entry_number: number;
    transaction_date: string;
    expense: { id: string; status: string };
  } | null;
  if (!r || !r.entry_id) {
    throw new MutationError("El gasto se reversó pero no se pudo leer el asiento resultante", 500);
  }
  return {
    entry_id: r.entry_id,
    entry_number: Number(r.entry_number),
    reversed_entry_number: Number(r.reversed_entry_number),
    transaction_date: r.transaction_date,
    expense: r.expense,
  };
}

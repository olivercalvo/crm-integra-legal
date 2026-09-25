/**
 * REVERSAR UN ASIENTO MANUAL (Bloque 7, migración `055`).
 *
 * Mismo patrón que `reversePayment` (046), `reverseSupplierPayment` (048) y
 * `reverseExpenseTramite` (050), y con la misma división de trabajo:
 *
 *   · el espejo lo arma `construirAsientoDeReversion` —la ÚNICA
 *     implementación, la misma que dibuja la vista previa del diálogo—;
 *   · el RPC no lo recalcula: lo VERIFICA con `EXCEPT ALL` y rechaza lo que no
 *     sea el reflejo exacto;
 *   · la fecha es la de HOY, exigida por el RPC (acta del 09/09).
 *
 * Lo único distinto es lo que NO hay: un asiento manual no tiene documento, así
 * que no hay estado que actualizar después. Empieza y termina en el libro.
 *
 * 🔒 El filtro a `source_type = 'manual'` vive en el RPC, que es el permiso.
 * Acá se comprueba primero solo para dar un mensaje mejor y no gastar un
 * viaje: si alguien saltea esta función, el RPC lo rechaza igual.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { MutationError } from "@/lib/finanzas/api/errors";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { getAsientoDelLibro } from "@/lib/finanzas/queries/asiento-manual";

type DB = SupabaseClient;

export interface ReverseJournalEntryResult {
  entry_id: string;
  entry_number: number;
  reversed_entry_number: number;
  transaction_date: string;
}

export async function reverseJournalEntry(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  entryId: string,
  reason: string
): Promise<ReverseJournalEntryResult> {
  const original = await getAsientoDelLibro(db, tenantId, entryId);
  if (!original) {
    throw new MutationError("Asiento no encontrado", 404);
  }
  if (original.source_type !== "manual") {
    throw new MutationError(
      `El asiento ${original.entry_number} salió de un documento, no de una carga manual: ` +
        "desde acá no se reversa. Se corrige por su documento (anulando la factura, reversando " +
        "el cobro o el gasto), que además actualiza el estado de ese documento.",
      409
    );
  }
  if (original.reversadoPor) {
    throw new MutationError(
      `El asiento ${original.entry_number} ya fue reversado por el asiento ` +
        `${original.reversadoPor.entry_number}.`,
      409
    );
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const armado = construirAsientoDeReversion(
    {
      id: original.id,
      entry_number: original.entry_number,
      transaction_date: original.transaction_date,
      description: original.description,
      reference: original.reference,
      lines: original.lineas.map((l) => ({
        account_code: l.account_code,
        account_name: l.account_name,
        debit: l.debit,
        credit: l.credit,
        description: l.descripcion,
      })),
    },
    // `source_id` null: el vínculo con el original es `reverses_entry_id`, y
    // poner ahí el id del asiento haría que el Mayor lo tratara como documento.
    { hoy, motivo: reason, source_id: null }
  );
  if (!armado.ok) {
    throw new MutationError(armado.mensaje, 422);
  }

  const { data, error } = await ledgerDb.rpc("reverse_journal_entry", {
    p_tenant_id: tenantId,
    p_entry_id: entryId,
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
    console.error("[finanzas/asientos] reverse_journal_entry failed", error);
    // El RPC habla en castellano y sus mensajes son para la persona que aprieta
    // el botón: se pasan tal cual en vez de esconderlos detrás de uno genérico.
    throw new MutationError(error.message ?? "No se pudo reversar el asiento.", 409, error);
  }

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    entry_id: String(r.entry_id),
    entry_number: Number(r.entry_number),
    reversed_entry_number: Number(r.reversed_entry_number),
    transaction_date: String(r.transaction_date),
  };
}

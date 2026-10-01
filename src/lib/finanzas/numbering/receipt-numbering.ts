/**
 * Numeración del RECIBO DE CAJA: `payments.payment_number` = CO-000001.
 *
 * 🔁 Desde E3 (Bloque 1, 01/10/2026) el prefijo es `CO-` (módulo Cobros, P-2c
 * de Josuarth). La secuencia `payment` NO se reinicia: los `REC-` ya emitidos
 * (staging, y los 8 de producción que numera la 047) se quedan como están —no
 * se renumera un documento entregado— y el siguiente sale `CO-` con el número
 * que sigue. Así `REC-000007` y `CO-000007` no conviven nunca.
 *
 * Un cobro es un recibo de caja desde el Bloque 2 (21/09/2026). No es
 * documento fiscal en Panamá —no pasa por la DGI ni lleva CUFE—, así que el
 * correlativo es interno del bufete y sale de la MISMA RPC
 * `get_next_sequence_number` que facturas, cotizaciones, clientes y
 * proveedores (`SELECT ... FOR UPDATE` server-side, nunca un `MAX + 1`).
 *
 * Pre-requisito: `sql/pending/047_recibo_de_caja.sql` aplicada (suma 'payment'
 * al CHECK de `numbering_sequences`, siembra la fila por bufete y numera los
 * cobros anteriores).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EL NÚMERO SE TOMA ANTES DEL INSERT, Y SI EL ALTA FALLA QUEDA UN HUECO
 * ═════════════════════════════════════════════════════════════════════════════
 * `createPayment` consume el correlativo y lo escribe en el mismo INSERT del
 * cobro. Si después falla la aplicación o el asiento, el DELETE compensatorio
 * deshace el cobro, pero el número ya se consumió: la secuencia no tiene
 * rollback (dos altas concurrentes no pueden compartir un número).
 *
 * Es el criterio de `emitInvoice`, decidido a conciencia el 21/09/2026 (SOP-031):
 * un hueco en la numeración se explica; la alternativa —numerar DESPUÉS del
 * asiento— dejaría, si el UPDATE final falla, un cobro contabilizado sin
 * recibo, y ese estado no se puede compensar porque el asiento es inmutable.
 * Un recibo de caja no es documento fiscal, así que el hueco no tiene
 * consecuencia ante la DGI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export const RECEIPT_SEQUENCE_TYPE = "payment" as const;
export const RECEIPT_NUMBER_PREFIX = "CO" as const;
/** Seis dígitos, como `FAC-HON-000001`. Es el mismo formato que usa el backfill de la 047. */
export const RECEIPT_NUMBER_PAD = 6;

/** CO-000012. Rechaza lo que no sea un entero positivo: un recibo 0 o negativo no existe. */
export function formatReceiptNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`formatReceiptNumber: número de recibo inválido (${String(n)})`);
  }
  return `${RECEIPT_NUMBER_PREFIX}-${String(n).padStart(RECEIPT_NUMBER_PAD, "0")}`;
}

/** Consume la secuencia y devuelve el número formateado. Ver el encabezado sobre los huecos. */
export async function allocateReceiptNumber(db: DB, tenantId: string): Promise<string> {
  const { data, error } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: RECEIPT_SEQUENCE_TYPE,
  });

  if (error || typeof data !== "number") {
    const msg = error?.message ?? "No se pudo asignar el número de recibo";
    throw new Error(`allocateReceiptNumber: ${msg}`);
  }
  return formatReceiptNumber(data);
}

/** El próximo número SIN consumir la secuencia, para mostrarlo en el alta. */
export async function previewNextReceiptNumber(
  db: DB,
  tenantId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("numbering_sequences")
    .select("last_number")
    .eq("tenant_id", tenantId)
    .eq("sequence_type", RECEIPT_SEQUENCE_TYPE)
    .maybeSingle();

  if (error || !data) return null;
  return formatReceiptNumber((data.last_number as number) + 1);
}

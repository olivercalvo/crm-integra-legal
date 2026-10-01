/**
 * Numeración de la COMPRA: `business_expenses.purchase_number` y
 * `expenses.purchase_number` = FAC-CO-000001 (Bloque 1, E3, migración `071`).
 *
 * Una sola secuencia (`purchase`) para las compras del bufete Y los gastos de
 * trámite (P-2b de Josuarth, 01/10/2026): los dos son facturas de compra, y lo
 * que distingue un gasto de trámite es la cuenta 130003 y el caso, no la serie.
 * El número no se repite entre las dos tablas.
 *
 * Es el número PROPIO del documento y va a `journal_entries.reference`. El de
 * la factura del proveedor es otro (`supplier_invoice_number`) y va a
 * `referencia_externa`.
 *
 * 🔴 Se toma ANTES de postear, como el recibo (SOP-031): un alta que falla
 * después deja un HUECO. Un gasto de trámite que ya tiene número y cuyo asiento
 * falló REUSA su número en el reintento (`postearGastoTramite`), así que ahí no
 * queda hueco. Una vez asignado, el número no cambia (trigger de la 071).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export const PURCHASE_SEQUENCE_TYPE = "purchase" as const;
export const PURCHASE_NUMBER_PREFIX = "FAC-CO" as const;
export const PURCHASE_NUMBER_PAD = 6;

/** FAC-CO-000012. Rechaza lo que no sea un entero positivo. */
export function formatPurchaseNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`formatPurchaseNumber: número de compra inválido (${String(n)})`);
  }
  return `${PURCHASE_NUMBER_PREFIX}-${String(n).padStart(PURCHASE_NUMBER_PAD, "0")}`;
}

/** Consume la secuencia y devuelve el número formateado. */
export async function allocatePurchaseNumber(db: DB, tenantId: string): Promise<string> {
  const { data, error } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: PURCHASE_SEQUENCE_TYPE,
  });
  if (error || typeof data !== "number") {
    const msg = error?.message ?? "No se pudo asignar el número de la compra";
    throw new Error(`allocatePurchaseNumber: ${msg}`);
  }
  return formatPurchaseNumber(data);
}

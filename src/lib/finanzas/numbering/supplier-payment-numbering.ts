/**
 * Numeración del PAGO A PROVEEDOR: `supplier_payments.payment_number` =
 * PA-000001. Calco de `receipt-numbering.ts`: la misma RPC
 * `get_next_sequence_number`, secuencia `'supplier_payment'` (048).
 *
 * 🔁 Desde E3 (Bloque 1, 01/10/2026) el prefijo es `PA-` (módulo Pagos, plan
 * punto 2). Hasta ahí era `CE-` (comprobante de egreso, Bloque 3). La secuencia
 * no se reinicia: los `CE-` de staging se quedan y el siguiente sale `PA-` con
 * el número que sigue. En producción nunca se emitió un `CE-`. El test lo fija.
 *
 * 🔴 El número se toma ANTES del INSERT y un alta que falla después deja un
 * HUECO — el mismo criterio del recibo de caja (SOP-031) y de `emitInvoice`.
 * Un comprobante de egreso no es documento fiscal.
 *
 * Los SALDOS HEREDADOS (`kind = 'migrated_balance'`) no se numeran nunca: no
 * son pagos. El CHECK de la 048 lo impide aunque alguien lo intente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export const SUPPLIER_PAYMENT_SEQUENCE_TYPE = "supplier_payment" as const;
export const SUPPLIER_PAYMENT_NUMBER_PREFIX = "PA" as const;
export const SUPPLIER_PAYMENT_NUMBER_PAD = 6;

export function formatSupplierPaymentNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`formatSupplierPaymentNumber: número inválido (${String(n)})`);
  }
  return `${SUPPLIER_PAYMENT_NUMBER_PREFIX}-${String(n).padStart(SUPPLIER_PAYMENT_NUMBER_PAD, "0")}`;
}

export async function allocateSupplierPaymentNumber(db: DB, tenantId: string): Promise<string> {
  const { data, error } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: SUPPLIER_PAYMENT_SEQUENCE_TYPE,
  });
  if (error || typeof data !== "number") {
    const msg = error?.message ?? "No se pudo asignar el número del comprobante";
    throw new Error(`allocateSupplierPaymentNumber: ${msg}`);
  }
  return formatSupplierPaymentNumber(data);
}

export async function previewNextSupplierPaymentNumber(
  db: DB,
  tenantId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("numbering_sequences")
    .select("last_number")
    .eq("tenant_id", tenantId)
    .eq("sequence_type", SUPPLIER_PAYMENT_SEQUENCE_TYPE)
    .maybeSingle();
  if (error || !data) return null;
  return formatSupplierPaymentNumber((data.last_number as number) + 1);
}

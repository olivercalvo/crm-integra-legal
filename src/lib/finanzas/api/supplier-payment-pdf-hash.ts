/**
 * Hash determinístico del contenido de un COMPROBANTE DE EGRESO (el PDF de un
 * pago a proveedor, Bloque 3 — espejo de `receipt-pdf-hash.ts`, misma política):
 *
 *   - SHA-256 hex, JSON canónico con claves ordenadas.
 *   - Entra SOLO lo que afecta visualmente al PDF: número, fecha, monto,
 *     método, referencia, notas, proveedor (con RUC y DV en campos SEPARADOS),
 *     la compra que paga, banco, asiento y —si la hay— la reversión.
 *   - `status` y `reversion` SÍ entran: al reversar, el PDF cambia (banda roja
 *     y asiento espejo) y tiene que regenerarse.
 *   - NO entra el saldo actual de la compra: cambia con cada pago posterior y
 *     el comprobante es una foto del pago, no de la cuenta corriente.
 */

import { createHash } from "crypto";
import { canonicalStringify } from "@/lib/finanzas/api/invoice-pdf-hash";

export interface SupplierPaymentPdfPayload {
  payment_number: string;
  payment_date: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  proveedor: {
    name: string;
    supplier_number: string | null;
    ruc: string | null;
    dv: string | null;
  };
  /** `compra` (business_expenses) o `tramite` (gasto de trámite, 049). Cambia los rótulos. */
  documento_kind: "compra" | "tramite";
  compra: {
    description: string;
    expense_date: string;
    supplier_invoice_number: string | null;
    total: number;
  };
  banco: { code: string; name: string } | null;
  asiento: number | null;
  reversion: { entry_number: number; reversed_at: string; reason: string } | null;
}

export function computeSupplierPaymentContentHash(payload: SupplierPaymentPdfPayload): string {
  // La misma serialización canónica que facturas, cotizaciones y recibos: un
  // solo criterio de "qué es el mismo contenido" para todos los PDF.
  const canonical = canonicalStringify(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

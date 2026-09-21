/**
 * Hash determinístico del contenido de un RECIBO DE CAJA, para el cache del
 * PDF (Bloque 2 — espejo de `invoice-pdf-hash.ts`, misma política):
 *
 *   - SHA-256 hex, JSON canónico con claves ordenadas, arrays en orden.
 *   - Entra SOLO lo que afecta visualmente al PDF: número, fecha, monto,
 *     método, referencia, notas, cliente (con RUC y DV en campos SEPARADOS),
 *     facturas aplicadas, banco, asiento y —si la hay— la reversión.
 *   - `status` y `reversion` SÍ entran: al reversar, el PDF cambia (banda roja
 *     y asiento espejo) y tiene que regenerarse.
 *   - NO entra el saldo actual de la factura: cambia con cada cobro posterior y
 *     el recibo es una foto del cobro, no de la cuenta corriente.
 */

import { createHash } from "crypto";
import { canonicalStringify } from "@/lib/finanzas/api/invoice-pdf-hash";

export interface ReceiptPdfPayload {
  payment_number: string;
  payment_date: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  client: {
    name: string;
    client_number: string;
    tax_id: string | null;
    tax_id_type: string | null;
    digito_verificador: string | null;
  };
  aplicaciones: {
    invoice_number: string;
    issue_date: string;
    grand_total: number;
    amount_applied: number;
  }[];
  banco: { code: string; name: string } | null;
  asiento: number | null;
  reversion: { entry_number: number; reversed_at: string; reason: string } | null;
}

export function computeReceiptContentHash(payload: ReceiptPdfPayload): string {
  // La misma serialización canónica que facturas y cotizaciones: un solo
  // criterio de "qué es el mismo contenido" para los tres PDF.
  const canonical = canonicalStringify(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

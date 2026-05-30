/**
 * Hash determinístico del contenido de una factura para cache del PDF
 * autogenerado (Sprint 2F — espejo de quote-pdf-hash.ts).
 *
 * Política idéntica al hash de cotización:
 *   - SHA-256 hex (64 chars).
 *   - JSON canónico con keys ordenadas alfabéticamente en cada nivel.
 *   - Arrays preservan orden (significativo para `lines.line_order`).
 *   - El payload incluye SÓLO lo que afecta visualmente al PDF. NO incluye
 *     `updated_at`, ni `amount_paid`/`balance_due` (cambian con cada pago
 *     y NO impactan al PDF, que es snapshot de la factura).
 *   - El `status` SÍ entra (la etiqueta navy bajo el número cambia).
 *   - Los 4 campos DGI SÍ entran (se renderizan en el PDF si están).
 *   - `cancellation_reason` + `cancelled_at` SÍ entran (visibles en anuladas).
 *   - Los montos NUMERIC se coercionan a Number antes de serializar.
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Payload shape
// ---------------------------------------------------------------------------

export interface InvoicePdfClientPayload {
  name: string;
  tax_id: string | null;
  tax_id_type: string | null;
  email: string | null;
  phone: string | null;
  client_type: "persona_natural" | "persona_juridica" | null;
}

export interface InvoicePdfCasePayload {
  code: string;
  description: string | null;
}

export interface InvoicePdfLinePayload {
  line_order: number;
  description: string;
  qty: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;
}

export interface InvoicePdfTotalsPayload {
  subtotal: number;
  tax_total: number;
  total: number;
}

export interface InvoicePdfDgiPayload {
  numero_documento: string | null;
  cufe: string | null;
  fecha_autorizacion: string | null;
  cafe_url: string | null;
}

export interface InvoicePdfCancellationPayload {
  reason: string | null;
  cancelled_at: string | null;
}

export interface InvoicePdfPayload {
  invoice_number: string;
  invoice_kind: "HONORARIOS" | "REEMBOLSO";
  status: string;
  client: InvoicePdfClientPayload;
  case: InvoicePdfCasePayload | null;
  issue_date: string;
  due_date: string;
  notes: string | null;
  lines: InvoicePdfLinePayload[];
  totals: InvoicePdfTotalsPayload;
  dgi: InvoicePdfDgiPayload;
  cancellation: InvoicePdfCancellationPayload;
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value ?? null);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`
  );
  return `{${parts.join(",")}}`;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export function computeInvoiceContentHash(payload: InvoicePdfPayload): string {
  const canonical = canonicalStringify(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const __test__ = {
  canonicalStringify,
};

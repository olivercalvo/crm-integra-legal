/**
 * Hash determinístico del contenido de una cotización para cache del PDF
 * autogenerado (Sprint 2E.3, decisiones D4 + D5).
 *
 * Política:
 *   - SHA-256 hex (64 chars).
 *   - Sobre un JSON canónico con keys ordenadas alfabéticamente en cada nivel
 *     del objeto. Arrays preservan el orden de inserción (significativo para
 *     `lines.line_order`).
 *   - El payload incluye SOLO lo que afecta visualmente al PDF (D5). NO
 *     incluye timestamps de auditoría (updated_at, sent_at, viewed_at,
 *     approved_at, etc) ni metadatos derivados (subtotal_total redundante con
 *     las líneas).
 *   - El `status` SÍ entra al hash: si una cotización transiciona de
 *     'enviada' a 'aceptada' / 'rechazada', el banner del PDF puede cambiar,
 *     por lo que conviene regenerar.
 *   - Los montos se normalizan a Number antes de serializar para evitar
 *     ambigüedad string ("1.50" vs 1.5) que viene del driver Supabase para
 *     columnas NUMERIC.
 *
 * Uso típico (Fase B):
 *   ```
 *   const payload = buildQuotePdfPayload(quoteWithLines, clientExtras);
 *   const hash = computeQuoteContentHash(payload);
 *   if (existingRow?.source_content_hash === hash) {
 *     // cache hit → devolver signed URL del current.pdf
 *   } else {
 *     // regenerar PDF, upsert blob, UPDATE row con nuevo hash + version + 1
 *   }
 *   ```
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Payload shape (D5)
// ---------------------------------------------------------------------------

/**
 * Datos del cliente que entran al hash. Incluye `tax_id`/`tax_id_type` que
 * viven en la tabla `clients` (agregados por la migration 20260505000001) y
 * `phone` que existe en `clients` desde día 1. La query del endpoint /pdf
 * debe traer estos campos explícitamente (no están en el SELECT estándar de
 * `getQuoteById`).
 */
export interface QuotePdfClientPayload {
  name: string;
  tax_id: string | null;
  tax_id_type: string | null;
  email: string | null;
  phone: string | null;
  client_type: "persona_natural" | "persona_juridica" | null;
}

export interface QuotePdfCasePayload {
  code: string;
  description: string | null;
}

export interface QuotePdfLinePayload {
  line_order: number;
  description: string;
  qty: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;
  invoice_kind: "HON" | "REI";
}

export interface QuotePdfTotalsPayload {
  subtotal_hon: number;
  subtotal_rei: number;
  total: number;
}

/**
 * Payload completo que el hash consume. Las funciones consumidoras deben
 * coercionar strings de NUMERIC a Number antes de construir esta estructura.
 */
export interface QuotePdfPayload {
  quote_number: string;
  /** Título descriptivo (Sprint 2E.3.2). Entra al hash: si cambia, el PDF se regenera. */
  title: string;
  status: string;
  client: QuotePdfClientPayload;
  case: QuotePdfCasePayload | null;
  issue_date: string;
  valid_until: string;
  internal_notes: string | null;
  terms_and_conditions: string | null;
  lines: QuotePdfLinePayload[];
  totals: QuotePdfTotalsPayload;
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/**
 * JSON.stringify con keys ordenadas alfabéticamente en cada nivel.
 * - Primitivos: mismo output que JSON.stringify.
 * - Arrays: preservan el orden original (significativo para las líneas).
 * - Objetos: keys ordenadas con String.prototype.localeCompare estándar.
 *
 * No maneja referencias circulares (no las hay en QuotePdfPayload).
 */
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

/**
 * Devuelve el SHA-256 hex (64 chars lowercase) del payload del PDF de
 * cotización. Determinístico: misma estructura semántica → mismo hash,
 * independientemente del orden de keys en el objeto original.
 */
export function computeQuoteContentHash(payload: QuotePdfPayload): string {
  const canonical = canonicalStringify(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Helper de export para tests / debugging. NO usar en endpoints de producción
 * directamente: usar computeQuoteContentHash.
 */
export const __test__ = {
  canonicalStringify,
};

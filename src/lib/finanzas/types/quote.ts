/**
 * Tipos compartidos del módulo Finanzas — cotizaciones (quotes).
 *
 * Convenciones (consistentes con types/invoice.ts):
 *   - status e invoice_kind son TEXT con CHECK constraint en BD (no enums).
 *     Acá los modelamos como union types para safety client-side.
 *   - tax_rate es DECIMAL [0, 1] en BD (0.0700 = 7%). La UI multiplica por
 *     100 al mostrar como porcentaje. NO confundir con porcentaje [0, 100].
 *   - Montos NUMERIC vienen como string desde Supabase REST. Convertir con
 *     Number() antes de operar.
 *   - converted_invoice_ids es UUID[] en BD → string[] | null en TS.
 */

// ---------- Status / kind --------------------------------------------------

/**
 * Valores válidos de quotes.status (CHECK quotes_status_check).
 *
 * Transiciones (validadas por T2-quote en BD):
 *   borrador → enviada               (sendQuote)
 *   borrador → cancelada_pre_envio   (cancelQuote — admin descarta)
 *   enviada  → aceptada              (portal cliente o markAcceptedManual)
 *   enviada  → rechazada             (portal cliente o markRejectedManual)
 *   enviada  → expirada              (cron en Fase 2E.4 cuando valid_until < hoy)
 *   aceptada → convertida            (convertToInvoices)
 */
export type QuoteStatus =
  | "borrador"
  | "enviada"
  | "aceptada"
  | "rechazada"
  | "expirada"
  | "convertida"
  | "cancelada_pre_envio";

/** Tipo de factura que generará la línea al convertir (D2). */
export type QuoteLineKind = "HON" | "REI";

// ---------- UI labels ------------------------------------------------------

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  expirada: "Expirada",
  convertida: "Convertida",
  cancelada_pre_envio: "Cancelada (pre-envío)",
};

export const QUOTE_LINE_KIND_LABEL: Record<QuoteLineKind, string> = {
  HON: "Honorarios",
  REI: "Reembolso",
};

// ---------- Sequence (D7) -------------------------------------------------

/** Sequence_type para get_next_sequence_number(). */
export const QUOTE_SEQUENCE_TYPE = "quote" as const;

/** Prefijo del quote_number formateado: COT-NNNNNN. */
export const QUOTE_NUMBER_PREFIX = "COT" as const;

/**
 * Límites de longitud del campo title (Sprint 2E.3.2).
 *
 * El CHECK constraint quotes_title_length en BD enforza estos mismos
 * valores. Si se cambia uno, hay que migrar el otro en lock-step
 * (lección Sprint 2E.1).
 */
export const QUOTE_TITLE_MIN = 3;
export const QUOTE_TITLE_MAX = 100;

/**
 * Límite máximo del campo observations (Sprint QUOTES-POLISH).
 *
 * Alineado con el CHECK quotes_observations_length_check en BD. Cualquier
 * cambio acá debe migrarse en lock-step en sql/pending/012 (lección
 * Sprint 2E.1: schema y código se mueven juntos).
 */
export const QUOTE_OBSERVATIONS_MAX = 2000;

// ---------- DB row shapes -------------------------------------------------

/** Cabecera de quote tal como viene del SELECT. 36 columnas. */
export interface QuoteRow {
  // ----- Originales (Batch 3a) -----
  id: string;
  tenant_id: string;
  quote_number: string;
  client_id: string;
  case_id: string | null;
  issue_date: string;        // YYYY-MM-DD
  valid_until: string;       // YYYY-MM-DD
  status: QuoteStatus;
  currency: string;          // 'USD'
  subtotal_total: string | number;
  tax_total: string | number;
  grand_total: string | number;
  notes: string | null;
  /** Observaciones cliente-visible en el PDF (Sprint QUOTES-POLISH). Distinto a notes (interno). */
  observations: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // ----- Sprint 2E.3.2 -----
  /** Descripción corta obligatoria (3-100 chars). CHECK quotes_title_length. */
  title: string;
  // ----- Sprint 2E.1 (D1-D9) -----
  /** Snapshot del T&C al crear (D4). NULL = usar template del tenant. */
  terms_and_conditions: string | null;
  /** Subtotal de líneas con invoice_kind='HON'. */
  subtotal_hon: string | number;
  /** Subtotal de líneas con invoice_kind='REI'. */
  subtotal_rei: string | number;
  // Portal (D1, D6) — se setean al ejecutar sendQuote
  public_token: string | null;
  sent_at: string | null;
  sent_to_email: string | null;
  sent_by: string | null;
  // Aceptación (D1) — IP/UA solo cuando vino del portal; NULL si fue manual
  approved_at: string | null;
  approved_by_ip: string | null;
  approved_by_user_agent: string | null;
  // Rechazo (D5) — reason opcional
  rejected_at: string | null;
  rejected_by_ip: string | null;
  rejected_by_user_agent: string | null;
  rejection_reason: string | null;
  // Cancelación pre-envío
  cancelled_at: string | null;
  cancellation_reason: string | null;
  // Conversión a facturas (D2) — array de 1 o 2 invoice_ids
  converted_at: string | null;
  converted_invoice_ids: string[] | null;
  converted_by: string | null;
}

/** Línea de quote tal como viene del SELECT. 18 columnas. */
export interface QuoteLineRow {
  id: string;
  tenant_id: string;
  quote_id: string;
  line_order: number;
  service_id: string | null;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  tax_code: string;
  /** DECIMAL [0, 1] — 0.0700 = 7%. */
  tax_rate: string | number;
  tax_code_id: string | null;
  /** Calculados por trigger T8b-quote, nullable en DB pero siempre poblados post-INSERT. */
  subtotal: string | number | null;
  tax_amount: string | number | null;
  line_total: string | number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  invoice_kind: QuoteLineKind;
}

/** Quote + cliente + caso + líneas (vista detalle). */
export interface QuoteWithLines extends QuoteRow {
  client: {
    id: string;
    name: string;
    client_number: string;
    client_status: "prospect" | "active" | "inactive";
    client_type: "persona_natural" | "persona_juridica" | null;
    ruc: string | null;
    email: string | null;
  } | null;
  case: { id: string; case_code: string; description: string | null } | null;
  lines: QuoteLineRow[];
}

/** Quote para listados (versión liviana). */
export interface QuoteListItem extends QuoteRow {
  client: {
    id: string;
    name: string;
    client_number: string;
    client_status: "prospect" | "active" | "inactive";
  } | null;
  case: { id: string; case_code: string } | null;
}

// ---------- Form input shapes ---------------------------------------------

/** Línea tal como llega desde el form (sin id, sin _key — el wire format del POST). */
export interface NewQuoteLineInput {
  invoice_kind: QuoteLineKind;
  description: string;
  quantity: number;
  unit_price: number;
  /** DECIMAL [0, 1]. NO porcentaje. */
  tax_rate: number;
  /** TEXT del code (ej. 'ITBMS_7') — snapshot redundante con BD. */
  tax_code: string;
  service_id?: string | null;
  tax_code_id?: string | null;
}

/**
 * Datos mínimos del prospect creado inline al crear cotización (D10, D13).
 * Si el cliente ya existe, usar `client_id` en su lugar.
 */
export interface NewProspectInput {
  name: string;
  email: string;
  phone?: string | null;
  client_type: "persona_natural" | "persona_juridica";
}

/**
 * Payload para crear una cotización.
 * Reglas:
 *   - Exactly ONE of `client_id` OR `new_prospect` debe estar presente.
 *   - `valid_until` es obligatorio (D3) y >= issue_date (CHECK en BD).
 *   - `issue_date` opcional; default = hoy.
 *   - `terms_and_conditions` opcional; si vacío, se snapshot-ea el template
 *     del tenant.
 *   - `lines` debe tener >= 1 elemento.
 */
export interface CreateQuoteInput {
  client_id?: string;
  new_prospect?: NewProspectInput;
  case_id?: string | null;
  issue_date?: string;        // YYYY-MM-DD; default = today UTC
  valid_until: string;        // YYYY-MM-DD; obligatorio (D3)
  /** Título descriptivo (3-100 chars). Sprint 2E.3.2. */
  title: string;
  notes?: string | null;
  /** Observaciones cliente-visible (Sprint QUOTES-POLISH). Máx 2000 chars. */
  observations?: string | null;
  terms_and_conditions?: string | null;
  lines: NewQuoteLineInput[];
}

/** Payload para actualizar (solo permitido si status='borrador'). */
export interface UpdateQuoteInput {
  client_id?: string;
  case_id?: string | null;
  issue_date?: string;
  valid_until?: string;
  /** Si viene, debe respetar 3-100 chars. Sprint 2E.3.2. */
  title?: string;
  notes?: string | null;
  /** Observaciones cliente-visible (Sprint QUOTES-POLISH). Máx 2000 chars. */
  observations?: string | null;
  terms_and_conditions?: string | null;
  /** Si viene, REEMPLAZA todas las líneas (delete + insert). */
  lines?: NewQuoteLineInput[];
}

/** Payload para enviar al cliente. */
export interface SendQuoteInput {
  /** Email destinatario. Validado server-side. */
  sent_to_email: string;
}

/** Payload para cancelar pre-envío (D5: reason opcional). */
export interface CancelQuoteInput {
  reason?: string | null;
}

/** Payload para marcar rechazada manualmente (D5: reason opcional). */
export interface MarkRejectedInput {
  reason?: string | null;
}

// ---------- Filters --------------------------------------------------------

export interface QuoteFilters {
  status?: QuoteStatus | QuoteStatus[];
  client_id?: string;
  case_id?: string;
  /** Búsqueda parcial por quote_number. */
  search?: string;
  page?: number;
  pageSize?: number;
}

// ---------- Terms template -------------------------------------------------

export interface TermsTemplateRow {
  id: string;
  tenant_id: string;
  content: string;
  updated_by: string | null;
  updated_at: string;
}

export interface UpdateTermsTemplateInput {
  content: string;
}

// ---------- UI helpers -----------------------------------------------------

/** Si una cotización puede editarse (header + líneas). */
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === "borrador";
}

/** Si una cotización puede eliminarse (T6-quote enforza también). */
export function isQuoteDeletable(status: QuoteStatus): boolean {
  return status === "borrador" || status === "cancelada_pre_envio";
}

/** Si una cotización puede enviarse (transición borrador → enviada). */
export function isQuoteSendable(status: QuoteStatus): boolean {
  return status === "borrador";
}

/** Si una cotización puede cancelarse pre-envío. */
export function isQuoteCancellable(status: QuoteStatus): boolean {
  return status === "borrador";
}

/** Si una cotización puede aceptarse/rechazarse manualmente. */
export function isQuoteDecidable(status: QuoteStatus): boolean {
  return status === "enviada";
}

/** Si una cotización puede convertirse a facturas. */
export function isQuoteConvertible(status: QuoteStatus): boolean {
  return status === "aceptada";
}

/**
 * Si una cotización puede reenviarse al cliente (Sprint 2E.3 hotfix).
 *
 * El reenvío refresca sent_at/sent_to_email/sent_by sin cambiar el status,
 * y conserva el mismo public_token. Se permite mientras el ciclo del envío
 * sigue activo: enviada (cliente todavía no respondió), aceptada (refrescar
 * confirmación) o rechazada (volver a contactar). NO en borrador (todavía
 * no se envió), convertida (ya está cerrada) ni cancelada/expirada (ciclo
 * cerrado).
 */
export function isQuoteResendable(status: QuoteStatus): boolean {
  return (
    status === "enviada" || status === "aceptada" || status === "rechazada"
  );
}

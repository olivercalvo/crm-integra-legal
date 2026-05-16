/**
 * Tipos compartidos del módulo Finanzas — facturas.
 *
 * Convenciones:
 *   - invoice_kind y status en BD son strings con CHECK constraint, no enums.
 *     Acá los modelamos como union types para safety client-side.
 *   - Los UPPERCASE viven solo en BD; en UI mostramos labels en español
 *     ("Honorarios", "Reembolso", etc.).
 *   - Montos como `string` cuando vienen de Supabase (NUMERIC se serializa así
 *     vía REST API). Convertir a number con Number() antes de operar.
 */

// ---------- Status / kind --------------------------------------------------

/** Valores válidos de invoices.invoice_kind (UPPERCASE en BD). */
export type InvoiceKind = "HONORARIOS" | "REEMBOLSO";

/** Valores válidos de invoices.status. */
export type InvoiceStatus =
  | "borrador"
  | "emitida"
  | "parcialmente_pagada"
  | "pagada"
  | "anulada"
  | "cancelada_pre_emision";

/** Mapping invoice_kind → sequence_type para get_next_sequence_number(). */
export const SEQUENCE_TYPE_BY_KIND: Record<InvoiceKind, "invoice_hon" | "invoice_reim"> = {
  HONORARIOS: "invoice_hon",
  REEMBOLSO: "invoice_reim",
};

/** Prefijo del invoice_number formateado. */
export const PREFIX_BY_KIND: Record<InvoiceKind, "FAC-HON" | "FAC-REI"> = {
  HONORARIOS: "FAC-HON",
  REEMBOLSO: "FAC-REI",
};

// ---------- Catalog rows --------------------------------------------------

export interface ClientOption {
  id: string;
  name: string;
  client_number: string;
  default_payment_terms_days?: number | null;
  ruc?: string | null;
}

export interface CaseOption {
  id: string;
  case_code: string;
  description: string | null;
  client_id: string;
}

export interface ServiceOption {
  id: string;
  code: string;
  name: string;
  service_type: "honorarios" | "reembolso" | "subcontratado" | "otro";
  revenue_account: string;
  default_tax_code: string;
  /** Snapshot del rate del default_tax_code (denormalizado en query). */
  default_tax_rate?: number;
  /** id UUID del default_tax_code (denormalizado en query). */
  default_tax_code_id?: string;
}

export interface TaxCodeOption {
  id: string;
  code: string;
  name: string;
  rate: number;
}

export interface AccountOption {
  code: string;
  name: string;
  account_type: string;
}

// ---------- Form input shapes ---------------------------------------------

/** Línea tal como vive en el form (antes de persistir). */
export interface InvoiceLineInput {
  /** UUID temporal cliente-side. NO se envía a BD. */
  _key: string;
  /** ID real de la línea persistida (para edits). null en líneas nuevas. */
  id: string | null;
  /** ID del SKU del catálogo. null si la línea es "personalizada". */
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  /** UUID del tax_code seleccionado. */
  tax_code_id: string;
  /** TEXT del code (ej. 'ITBMS_7') — snapshot redundante con BD. */
  tax_code: string;
  /** Snapshot del rate (decimal: 0.0700 = 7%). */
  tax_rate: number;
}

/** Payload para crear factura. */
export interface CreateInvoiceInput {
  invoice_kind: InvoiceKind;
  client_id: string;
  case_id: string | null;
  issue_date: string; // YYYY-MM-DD
  due_date: string;   // YYYY-MM-DD
  notes: string | null;
  lines: Array<Omit<InvoiceLineInput, "_key" | "id">>;
}

/** Payload para actualizar factura (solo borradores). */
export interface UpdateInvoiceInput {
  invoice_kind: InvoiceKind;
  client_id: string;
  case_id: string | null;
  issue_date: string;
  due_date: string;
  notes: string | null;
  lines: InvoiceLineInput[]; // con id si ya existían
}

// ---------- API row shapes ------------------------------------------------

/** Cabecera de invoice tal como viene del SELECT. */
export interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_kind: InvoiceKind;
  client_id: string;
  case_id: string | null;
  quote_id: string | null;
  issue_date: string;
  due_date: string;
  status: InvoiceStatus;
  currency: string;
  subtotal_total: string | number;
  tax_total: string | number;
  grand_total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // ----- DGI (eFactura) — registro manual pre-integración PAC.
  // Estos 4 campos los carga la abogada DESPUÉS de replicar la factura
  // interna en eFactura. Cuando se complete la integración con el PAC
  // (Camino 2), el flujo automático los va a poblar.
  // Schema: migration 20260506000001_finanzas_b4_schema_prep_dgi.sql
  dgi_numero_documento: string | null;
  dgi_cufe: string | null;
  dgi_fecha_autorizacion: string | null;
  dgi_cafe_url: string | null;
  // ----- Anulación. Se llenan en el mismo UPDATE que cambia status a 'anulada'.
  // Schema: migration 20260507000001_finanzas_b4_anular_factura.sql
  cancellation_reason: string | null;
  cancelled_at: string | null;
}

/** Payload para registrar/actualizar los datos DGI de una factura emitida. */
export interface UpdateInvoiceDgiInput {
  dgi_numero_documento: string | null;
  dgi_cufe: string | null;
  dgi_fecha_autorizacion: string | null;
  dgi_cafe_url: string | null;
}

/**
 * Payload para anular una factura. Reason es requerida (mínimo 3 chars).
 * observations es opcional (máx 2000 chars) y se guarda en la NC generada.
 * Sprint QUOTES-POLISH D7.
 */
export interface CancelInvoiceInput {
  reason: string;
  observations?: string | null;
}

/** Límite alineado con CHECK credit_notes_observations_length_check en BD. */
export const CREDIT_NOTE_OBSERVATIONS_MAX = 2000;

/** Línea de invoice tal como viene del SELECT. */
export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_order: number;
  service_id: string | null;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  tax_code: string;
  tax_rate: string | number;
  tax_code_id: string | null;
  subtotal: string | number;
  tax_amount: string | number;
  line_total: string | number;
}

/** Invoice + cliente + caso joineados (detalle). */
export interface InvoiceWithRelations extends InvoiceRow {
  client: { id: string; name: string; client_number: string; ruc: string | null } | null;
  case: { id: string; case_code: string; description: string | null } | null;
  lines: InvoiceLineRow[];
}

/** Invoice de lista (con relaciones mínimas). */
export interface InvoiceListItem extends InvoiceRow {
  client: { id: string; name: string; client_number: string } | null;
  case: { id: string; case_code: string } | null;
}

// ---------- UI labels ------------------------------------------------------

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  HONORARIOS: "Honorarios",
  REEMBOLSO: "Reembolso",
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  parcialmente_pagada: "Pago parcial",
  pagada: "Pagada",
  anulada: "Anulada",
  cancelada_pre_emision: "Cancelada (pre-emisión)",
};

/** Si una factura puede editarse (líneas + cabecera). */
export function isEditable(status: InvoiceStatus): boolean {
  return status === "borrador";
}

/** Si una factura puede eliminarse (T6 lo enforza también server-side). */
export function isDeletable(status: InvoiceStatus): boolean {
  return status === "borrador";
}

/** Si una factura puede emitirse (transición borrador → emitida). */
export function isEmittable(status: InvoiceStatus): boolean {
  return status === "borrador";
}

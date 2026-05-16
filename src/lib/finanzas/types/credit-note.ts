/**
 * Tipos compartidos del módulo Finanzas — notas de crédito.
 *
 * Las NCs se generan automáticamente al anular una factura emitida (Sprint
 * 2C). Son mirror literal de la factura origen: líneas idénticas, mismos
 * tax_codes, monto exacto. Cancelan 100% (no soportamos NC parciales en
 * el MVP).
 *
 * Convenciones:
 *   - status fijo en 'emitida' (CHECK en BD).
 *   - Una NC NUNCA se elimina (T6).
 *   - Una NC es inmutable post-creación (T5/T5d).
 *   - Numeración via secuencia 'credit_note' → formato NC-NNNNNN.
 */

export type CreditNoteStatus = "emitida";

export interface CreditNoteRow {
  id: string;
  credit_note_number: string;
  invoice_id: string;
  client_id: string;
  issue_date: string;
  reason: string;
  status: CreditNoteStatus;
  currency: string;
  subtotal_total: string | number;
  tax_total: string | number;
  grand_total: string | number;
  created_at: string;
  created_by: string | null;
}

export interface CreditNoteLineRow {
  id: string;
  credit_note_id: string;
  invoice_line_id: string | null;
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

export interface CreditNoteWithRelations extends CreditNoteRow {
  lines: CreditNoteLineRow[];
  invoice: {
    id: string;
    invoice_number: string;
    invoice_kind: "HONORARIOS" | "REEMBOLSO";
    issue_date: string;
  } | null;
  client: {
    id: string;
    name: string;
    client_number: string;
    ruc: string | null;
  } | null;
}

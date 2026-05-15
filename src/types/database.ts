export type UserRole = "admin" | "abogada" | "asistente" | "contador";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  branding: Record<string, string> | null;
  created_at: string;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  role: UserRole;
  full_name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  tenant_id: string;
  client_number: string;
  name: string;
  ruc: string | null;
  type: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  client_since: string | null;
  observations: string | null;
  responsible_lawyer_id: string | null;
  /**
   * @deprecated Sprint 2E.1 — usar `client_status` en lugar de `active`.
   *
   * Hoy es una columna GENERATED ALWAYS AS (client_status = 'active') STORED
   * en la BD para retrocompatibilidad. Será dropeada en una migration separada
   * al final del Sprint 2E.1, después de verificar en preview que NINGÚN
   * código sigue leyéndola. NO escribir nuevo código que dependa de este campo.
   */
  active: boolean;
  /** Estado del registro: `prospect` (datos mínimos, no facturable), `active` (datos completos), `inactive` (archivado). */
  client_status: "prospect" | "active" | "inactive";
  /** Tipo fiscal: persona natural (cédula/pasaporte) o jurídica (RUC). NULL en registros legacy donde no se distinguió. */
  client_type: "persona_natural" | "persona_juridica" | null;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  tenant_id: string;
  client_id: string;
  case_number: number;
  case_code: string;
  description: string | null;
  classification_id: string | null;
  institution_id: string | null;
  responsible_id: string | null;
  opened_at: string;
  status_id: string | null;
  physical_location: string | null;
  observations: string | null;
  has_digital_file: boolean;
  entity: string | null;
  procedure_type: string | null;
  institution_procedure_number: string | null;
  institution_case_number: string | null;
  case_start_date: string | null;
  procedure_start_date: string | null;
  deadline: string | null;
  last_followup_at: string | null;
  assistant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  tenant_id: string;
  case_id: string;
  amount: number;
  concept: string;
  date: string;
  expense_type: "tramite" | "administrativo";
  registered_by: string;
  receipt_url: string | null;
  receipt_filename: string | null;
  created_at: string;
}

export interface ClientPayment {
  id: string;
  tenant_id: string;
  case_id: string;
  amount: number;
  description: string | null;
  payment_date: string;
  payment_type: "tramite" | "administrativo";
  registered_by: string;
  receipt_url: string | null;
  receipt_filename: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  tenant_id: string;
  case_id: string;
  description: string;
  deadline: string | null;
  assigned_to: string | null;
  status: "pendiente" | "cumplida";
  created_by: string;
  completed_at: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  tenant_id: string;
  case_id: string;
  text: string;
  user_id: string;
  follow_up_date: string | null;
  created_at: string;
}

/**
 * Tipos de entidad sobre las que un documento puede colgar.
 * Sprint 2E.3: agregados 'quote' e 'invoice' (D10 future-proof — 'invoice'
 * queda preparado para Fase 2F). El CHECK del constraint vive en BD,
 * ver sql/pending/006_extend_documents_for_auto_pdfs.sql.
 */
export type DocumentEntityType =
  | "client"
  | "case"
  | "task"
  | "comment"
  | "quote"
  | "invoice";

/**
 * Origen del adjunto.
 *   'manual'           = subido por usuario via UI (DocumentUpload).
 *   'auto_quote_pdf'   = PDF auto-generado desde una cotización (Sprint 2E.3).
 *   'auto_invoice_pdf' = preparado para Fase 2F (factura).
 *
 * Reglas:
 *   - source='manual' es el default y aplica a todos los rows pre-Sprint 2E.3.
 *   - Sólo rows con source='manual' pueden borrarse via /api/documents/[id]/delete.
 *   - Los rows con source!='manual' se eliminan implícitamente al borrar la
 *     entidad fuente (ej. al borrar el quote, su PDF auto se limpia).
 */
export type DocumentSource = "manual" | "auto_quote_pdf" | "auto_invoice_pdf";

export interface Document {
  id: string;
  tenant_id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  file_name: string;
  file_path: string;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
  /** Sprint 2E.3: origen del adjunto. Default 'manual' en BD. */
  source: DocumentSource;
  /** Versión del contenido auto-generado. Incrementa al regenerar. NULL si source='manual'. */
  source_version: number | null;
  /** Timestamp de la última regeneración del PDF auto. NULL si source='manual'. */
  source_generated_at: string | null;
  /** SHA-256 hex del payload canónico que produjo el PDF actual. Cache de regeneración. NULL si source='manual'. */
  source_content_hash: string | null;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  entity: string;
  entity_id: string;
  action: "create" | "update" | "delete";
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface CatClassification {
  id: string;
  tenant_id: string;
  name: string;
  prefix: string;
  description: string | null;
  color: string | null;
  active: boolean;
  created_at: string;
}

export interface CatStatus {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface CatInstitution {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface CatTeam {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  role: string | null;
  active: boolean;
  created_at: string;
}

// ── Personal To-Dos ──

export interface PersonalTodo {
  id: string;
  tenant_id: string;
  user_id: string;
  description: string;
  deadline: string | null;
  status: "pendiente" | "cumplida";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodoComment {
  id: string;
  tenant_id: string;
  todo_id: string;
  text: string;
  user_id: string;
  created_at: string;
}

export interface TodoDocument {
  id: string;
  tenant_id: string;
  todo_id: string;
  file_name: string;
  file_path: string;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
}

// ── Prospects Pipeline ──

export type ProspectStatus =
  | "contacto_inicial"
  | "propuesta_enviada"
  | "en_negociacion"
  | "ganado"
  | "perdido";

export interface Prospect {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  service_interest: string | null;
  notes: string | null;
  contact_date: string;
  status: ProspectStatus;
  converted_client_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProspectComment {
  id: string;
  tenant_id: string;
  prospect_id: string;
  text: string;
  user_id: string;
  created_at: string;
}

export interface ProspectDocument {
  id: string;
  tenant_id: string;
  prospect_id: string;
  file_name: string;
  file_path: string;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
}

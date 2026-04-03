export type UserRole = "admin" | "abogada" | "asistente";

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
  observations: string | null;
  active: boolean;
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
  registered_by: string;
  created_at: string;
}

export interface ClientPayment {
  id: string;
  tenant_id: string;
  case_id: string;
  amount: number;
  payment_date: string;
  registered_by: string;
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

export interface Document {
  id: string;
  tenant_id: string;
  entity_type: "client" | "case";
  entity_id: string;
  file_name: string;
  file_path: string;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
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

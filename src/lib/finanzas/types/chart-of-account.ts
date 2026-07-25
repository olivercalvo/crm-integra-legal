/**
 * Tipos compartidos del Plan de Cuentas (chart_of_accounts).
 *
 * Convenciones:
 *   - account_type vive en BD en INGLÉS (asset|liability|equity|income|expense)
 *     por estándar contable + CHECK constraint. En UI mostramos labels en
 *     ESPAÑOL (Activo/Pasivo/Patrimonio/Ingreso/Gasto). El mapeo español→inglés
 *     lo hace el selector del form (option value = inglés, label = español).
 *   - La tabla es PLANA: no hay jerarquía (parent_id). Mantener plana por ahora.
 *   - is_system = cuentas críticas que los reportes referencian por código
 *     (1201, 1202, 2301, 4101, 4102). No se pueden desactivar ni cambiarles el
 *     código desde la UI.
 */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

/** Valores válidos de account_type (deben coincidir con el CHECK de BD). */
export const ACCOUNT_TYPES: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

/** Label en español para cada account_type de BD. */
export const ACCOUNT_TYPE_LABEL_ES: Record<AccountType, string> = {
  asset: "Activo",
  liability: "Pasivo",
  equity: "Patrimonio",
  income: "Ingreso",
  expense: "Gasto",
};

/**
 * Orden de presentación de las secciones agrupadas por tipo (activo → pasivo →
 * patrimonio → ingreso → gasto), consistente con la estructura de un balance +
 * estado de resultados.
 */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

/** Comprueba si un valor arbitrario es un account_type válido. */
export function isAccountType(v: unknown): v is AccountType {
  return typeof v === "string" && (ACCOUNT_TYPES as string[]).includes(v);
}

/** Fila del plan de cuentas tal como la consume la UI. */
export interface ChartAccountRow {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_name_qb: string | null;
  description: string | null;
  is_trust_pass_through: boolean;
  is_system: boolean;
  active: boolean;
}

/** Payload validado para crear una cuenta. */
export interface CreateChartAccountInput {
  code: string;
  name: string;
  account_type: AccountType;
  description: string | null;
  active: boolean;
}

/**
 * Payload validado para editar una cuenta. `code` es opcional: solo se permite
 * cambiarlo en cuentas NO-system (el server lo bloquea para is_system=true).
 */
export interface UpdateChartAccountInput {
  code?: string;
  name: string;
  account_type: AccountType;
  description: string | null;
  active: boolean;
}

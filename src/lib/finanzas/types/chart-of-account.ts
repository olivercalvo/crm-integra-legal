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
 *   - subcategoria es INDEPENDIENTE de account_type: agrupa los reportes
 *     (Balance General por corriente/no corriente, Estado de Resultado
 *     separando costos de gastos operativos). Ver SUBCATEGORIAS más abajo.
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

// ---------------------------------------------------------------------------
// SUBCATEGORÍA — agrupador de reportes (Paso 1a del plan contable con Josuar)
// ---------------------------------------------------------------------------

/**
 * Subcategoría contable. Se guarda en BD en snake_case (columna
 * `chart_of_accounts.subcategoria`, TEXT NULL sin CHECK — la validación vive
 * acá) y se muestra con label en español.
 *
 * Es ORTOGONAL a account_type: su razón de ser es que un solo
 * account_type='expense' cubre tanto los COSTOS (5xxxxx) como los GASTOS
 * OPERATIVOS (6xxxxx), y el Estado de Resultado los necesita separados
 * (ingresos − costos = Ganancia Bruta; − gastos = Utilidad Operativa). El
 * Balance General, del mismo modo, agrupa activos y pasivos por
 * corriente / no corriente.
 */
export type Subcategoria =
  | "activo_corriente"
  | "activo_no_corriente"
  | "propiedad_planta_equipo"
  | "pasivo_corriente"
  | "pasivo_no_corriente"
  | "patrimonio"
  | "ingreso"
  | "costo"
  | "gasto_operativo"
  | "otro";

/**
 * Valores válidos de subcategoria, en orden de presentación del dropdown
 * (activos → pasivos → patrimonio → resultado → otro), consistente con el
 * orden de lectura de un Balance General + Estado de Resultado.
 */
export const SUBCATEGORIAS: Subcategoria[] = [
  "activo_corriente",
  "activo_no_corriente",
  "propiedad_planta_equipo",
  "pasivo_corriente",
  "pasivo_no_corriente",
  "patrimonio",
  "ingreso",
  "costo",
  "gasto_operativo",
  "otro",
];

/** Label en español para cada subcategoria (lo que ve el usuario). */
export const SUBCATEGORIA_LABEL_ES: Record<Subcategoria, string> = {
  activo_corriente: "Activo corriente",
  activo_no_corriente: "Activo no corriente",
  propiedad_planta_equipo: "Propiedad, planta y equipo",
  pasivo_corriente: "Pasivo corriente",
  pasivo_no_corriente: "Pasivo no corriente",
  patrimonio: "Patrimonio",
  ingreso: "Ingreso",
  costo: "Costo",
  gasto_operativo: "Gasto operativo",
  otro: "Otro",
};

/** Comprueba si un valor arbitrario es una subcategoria válida. */
export function isSubcategoria(v: unknown): v is Subcategoria {
  return typeof v === "string" && (SUBCATEGORIAS as string[]).includes(v);
}

/** Label en español de una subcategoria, con fallback para NULL/desconocida. */
export function subcategoriaLabel(v: string | null | undefined): string {
  if (isSubcategoria(v)) return SUBCATEGORIA_LABEL_ES[v];
  return "—";
}

/** Fila del plan de cuentas tal como la consume la UI. */
export interface ChartAccountRow {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  subcategoria: Subcategoria | null;
  saldo_inicial: number;
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
  subcategoria: Subcategoria | null;
  saldo_inicial: number;
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
  subcategoria: Subcategoria | null;
  saldo_inicial: number;
  description: string | null;
  active: boolean;
}

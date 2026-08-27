/**
 * Tipos compartidos del Plan de Cuentas (chart_of_accounts).
 *
 * Convenciones:
 *   - account_type vive en BD en INGLÉS (asset|liability|equity|income|cost|
 *     expense) por estándar contable + CHECK constraint. En UI mostramos labels
 *     en ESPAÑOL. El mapeo español→inglés lo hace el selector del form
 *     (option value = inglés, label = español).
 *   - La tabla es PLANA: no hay jerarquía (parent_id). Mantener plana por ahora.
 *   - is_system = cuentas críticas que los reportes referencian por código
 *     (1201, 1202, 2301, 4101, 4102). No se pueden desactivar ni cambiarles el
 *     código desde la UI.
 *   - subcategoria agrupa los reportes. Desde NIIF 18 NO es libre: depende del
 *     account_type. Ver SUBCATEGORIAS_POR_TIPO más abajo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NIIF 18 — por qué esto cambió (Fase 1, 2026-08-27)
 * ─────────────────────────────────────────────────────────────────────────────
 * NIIF 18 es obligatoria desde el 1 de enero de 2027 y reemplaza a NIC 1.
 * Clasifica ingresos Y gastos (no solo gastos) por ACTIVIDAD: operación,
 * inversión y financiamiento. Como el módulo contable se está construyendo
 * ahora, se construye ya con la norma nueva en vez de rehacerlo en diciembre.
 *
 * Dos cambios de fondo respecto del vocabulario anterior:
 *
 *   1. COSTO es un TIPO propio, no una subcategoría de gasto. Son SEIS tipos
 *      (Josuar fue explícito). Antes, `account_type='expense'` cubría costos y
 *      gastos y se separaban por `subcategoria='costo'` vs `'gasto_operativo'`.
 *
 *   2. Las subcategorías de resultado son NUEVE (3 naturalezas × 3 actividades)
 *      y son OBLIGATORIAS en cuentas de resultado activas. Reemplazan a las tres
 *      genéricas de antes (`ingreso`, `costo`, `gasto_operativo`), que ya no
 *      existen. `costo` en particular DEBÍA desaparecer: pasó a ser un tipo y no
 *      pueden coexistir dos cosas distintas con el mismo nombre.
 *
 * Las subcategorías de BALANCE (activo/pasivo/patrimonio) no las toca NIIF 18 y
 * quedan como estaban.
 */

// ---------------------------------------------------------------------------
// ACCOUNT TYPE — los seis tipos
// ---------------------------------------------------------------------------

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "cost"
  | "expense";

/** Valores válidos de account_type (deben coincidir con el CHECK de BD). */
export const ACCOUNT_TYPES: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "cost",
  "expense",
];

/** Label en español para cada account_type de BD. */
export const ACCOUNT_TYPE_LABEL_ES: Record<AccountType, string> = {
  asset: "Activo",
  liability: "Pasivo",
  equity: "Patrimonio",
  income: "Ingreso",
  cost: "Costo",
  expense: "Gasto",
};

/**
 * Orden de presentación de las secciones agrupadas por tipo, consistente con la
 * estructura de un balance + estado de resultado: activo → pasivo → patrimonio
 * → ingreso → costo → gasto. `cost` va entre ingreso y gasto porque el Estado
 * de Resultado resta primero los costos (Utilidad Bruta) y después los gastos.
 */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "cost",
  "expense",
];

/** Comprueba si un valor arbitrario es un account_type válido. */
export function isAccountType(v: unknown): v is AccountType {
  return typeof v === "string" && (ACCOUNT_TYPES as string[]).includes(v);
}

/**
 * Tipos de RESULTADO (van al Estado de Resultado). El resto son de BALANCE.
 * La distinción manda en dos reglas: qué subcategorías se ofrecen, y en cuáles
 * la subcategoría es obligatoria.
 */
export const TIPOS_RESULTADO: AccountType[] = ["income", "cost", "expense"];

/** true si el tipo va al Estado de Resultado (ingreso, costo o gasto). */
export function esTipoResultado(t: AccountType): boolean {
  return TIPOS_RESULTADO.includes(t);
}

// ---------------------------------------------------------------------------
// SUBCATEGORÍA — agrupador de reportes
// ---------------------------------------------------------------------------

/**
 * Subcategoría contable. Se guarda en BD en snake_case (columna
 * `chart_of_accounts.subcategoria`) y se muestra con label en español.
 *
 * Las nueve de resultado son la matriz de NIIF 18: las tres naturalezas
 * (ingreso / costo / gasto) por las tres actividades (operación / inversión /
 * financiamiento).
 */
export type Subcategoria =
  // — Balance (no las toca NIIF 18) —
  | "activo_corriente"
  | "activo_no_corriente"
  | "propiedad_planta_equipo"
  | "pasivo_corriente"
  | "pasivo_no_corriente"
  | "patrimonio"
  | "otro"
  // — Resultado (NIIF 18) —
  | "ingresos_operativos"
  | "ingresos_inversion"
  | "ingresos_financiamiento"
  | "costos_operativos"
  | "costos_inversion"
  | "costos_financiamiento"
  | "gastos_operativos"
  | "gastos_inversion"
  | "gastos_financiamiento";

/**
 * Valores válidos de subcategoria, en orden de presentación (balance primero,
 * después resultado por actividad), consistente con el orden de lectura de un
 * Balance General + Estado de Resultado.
 */
export const SUBCATEGORIAS: Subcategoria[] = [
  "activo_corriente",
  "activo_no_corriente",
  "propiedad_planta_equipo",
  "pasivo_corriente",
  "pasivo_no_corriente",
  "patrimonio",
  "otro",
  "ingresos_operativos",
  "ingresos_inversion",
  "ingresos_financiamiento",
  "costos_operativos",
  "costos_inversion",
  "costos_financiamiento",
  "gastos_operativos",
  "gastos_inversion",
  "gastos_financiamiento",
];

/**
 * Label en español para cada subcategoria (lo que ve el usuario).
 *
 * Las nueve de resultado están TEXTUALES como las mandó Josuar por correo,
 * mayúsculas incluidas ("Ingresos Operativos" pero "Ingresos por
 * financiamiento"). La inconsistencia es de él y se respeta a propósito: es el
 * vocabulario que reconoce cuando revisa el reporte.
 */
export const SUBCATEGORIA_LABEL_ES: Record<Subcategoria, string> = {
  activo_corriente: "Activo corriente",
  activo_no_corriente: "Activo no corriente",
  propiedad_planta_equipo: "Propiedad, planta y equipo",
  pasivo_corriente: "Pasivo corriente",
  pasivo_no_corriente: "Pasivo no corriente",
  patrimonio: "Patrimonio",
  otro: "Otro",
  ingresos_operativos: "Ingresos Operativos",
  ingresos_inversion: "Ingresos de Inversión",
  ingresos_financiamiento: "Ingresos por financiamiento",
  costos_operativos: "Costos Operativos",
  costos_inversion: "Costos de Inversión",
  costos_financiamiento: "Costos por financiamiento",
  gastos_operativos: "Gastos Operativos",
  gastos_inversion: "Gastos por Inversión",
  gastos_financiamiento: "Gastos por financiamiento",
};

/**
 * Qué subcategorías puede tener cada tipo de cuenta.
 *
 * Rose fue explícita sobre las nueve de NIIF 18: "QUE APAREZCAN CUANDO LA
 * CUENTA ES INGRESO, COSTO O GASTO". En cuentas de balance no se muestran; ahí
 * siguen las de siempre.
 *
 * El selector de la UI se filtra con este mapa, y el servidor valida contra él:
 * esconder opciones en el dropdown no es un permiso.
 */
export const SUBCATEGORIAS_POR_TIPO: Record<AccountType, Subcategoria[]> = {
  asset: ["activo_corriente", "activo_no_corriente", "propiedad_planta_equipo", "otro"],
  liability: ["pasivo_corriente", "pasivo_no_corriente", "otro"],
  equity: ["patrimonio", "otro"],
  income: ["ingresos_operativos", "ingresos_inversion", "ingresos_financiamiento"],
  cost: ["costos_operativos", "costos_inversion", "costos_financiamiento"],
  expense: ["gastos_operativos", "gastos_inversion", "gastos_financiamiento"],
};

/** Las subcategorías que corresponden a un tipo, en orden de presentación. */
export function subcategoriasParaTipo(t: AccountType): Subcategoria[] {
  return SUBCATEGORIAS_POR_TIPO[t] ?? [];
}

/**
 * true si la subcategoría es OBLIGATORIA para ese tipo.
 *
 * Solo en cuentas de resultado: sin subcategoría, el Estado de Resultado no
 * puede ubicar la cuenta en su bloque de actividad. En balance sigue siendo
 * opcional (las 34 cuentas viejas de QuickBooks la tienen en NULL y están
 * desactivadas — por eso el CHECK de BD solo aplica a `active = true`).
 */
export function requiereSubcategoria(t: AccountType): boolean {
  return esTipoResultado(t);
}

/** Comprueba si un valor arbitrario es una subcategoria válida. */
export function isSubcategoria(v: unknown): v is Subcategoria {
  return typeof v === "string" && (SUBCATEGORIAS as string[]).includes(v);
}

/** true si la subcategoría es válida PARA ESE TIPO (no solo válida en general). */
export function isSubcategoriaValidaParaTipo(
  t: AccountType,
  v: unknown
): v is Subcategoria {
  return isSubcategoria(v) && subcategoriasParaTipo(t).includes(v);
}

/** Label en español de una subcategoria, con fallback para NULL/desconocida. */
export function subcategoriaLabel(v: string | null | undefined): string {
  if (isSubcategoria(v)) return SUBCATEGORIA_LABEL_ES[v];
  return "—";
}

// ---------------------------------------------------------------------------
// CUENTA CONTROL
// ---------------------------------------------------------------------------

/**
 * Marca una cuenta como CONTROL de un auxiliar: su saldo tiene que cuadrar
 * contra el detalle del subsistema correspondiente (la antigüedad de cuentas
 * por cobrar para `clientes`, la de por pagar para `proveedores`).
 *
 * NULL = cuenta normal, sin auxiliar que cuadrar.
 */
export type CuentaControl = "clientes" | "proveedores";

export const CUENTAS_CONTROL: CuentaControl[] = ["clientes", "proveedores"];

export const CUENTA_CONTROL_LABEL_ES: Record<CuentaControl, string> = {
  clientes: "Controla clientes",
  proveedores: "Controla proveedores",
};

export function isCuentaControl(v: unknown): v is CuentaControl {
  return typeof v === "string" && (CUENTAS_CONTROL as string[]).includes(v);
}

/** Label de cuenta control, con fallback para NULL. */
export function cuentaControlLabel(v: string | null | undefined): string {
  if (isCuentaControl(v)) return CUENTA_CONTROL_LABEL_ES[v];
  return "—";
}

// ---------------------------------------------------------------------------
// FILAS Y PAYLOADS
// ---------------------------------------------------------------------------

/** Fila del plan de cuentas tal como la consume la UI. */
export interface ChartAccountRow {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  subcategoria: Subcategoria | null;
  cuenta_control: CuentaControl | null;
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
  cuenta_control: CuentaControl | null;
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
  cuenta_control: CuentaControl | null;
  saldo_inicial: number;
  description: string | null;
  active: boolean;
}

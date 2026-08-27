/**
 * Mapeo y parseo PURO de la carga masiva del Plan de Cuentas (Paso 1b del plan
 * contable con Josuar, ver docs/finanzas/roadmap-contable.md §10).
 *
 * Este módulo NO importa XLSX ni toca la BD: recibe una matriz de celdas
 * (`unknown[][]`) y devuelve filas tipadas. Eso lo hace testeable sin fixtures
 * binarios ni mocks — el módulo que lee el .xlsx/.csv
 * (`chart-of-accounts-workbook.ts`) solo convierte el archivo a esa matriz y
 * delega acá.
 *
 * Tolerancia de lectura (requisito del negocio): el mismo parser tiene que
 * tragar DOS formatos distintos sin configuración:
 *   1. Nuestra plantilla:  Código | Nombre | Tipo | Subcategoría | Saldo inicial
 *   2. El balance de comprobación de Josuar, que trae filas de título arriba,
 *      encabezados con otros nombres ("Nombre de cuenta", "Tipo de Cuenta",
 *      "Balance Inicial") y columnas extra (Débito, Crédito, Saldo final).
 * De ahí que los encabezados se busquen case/acento-insensible, que la fila de
 * encabezado se DETECTE (no se asuma en la fila 1) y que las columnas que no
 * reconocemos se ignoren en silencio.
 */

import {
  isSubcategoria,
  SUBCATEGORIA_LABEL_ES,
  SUBCATEGORIAS,
  type AccountType,
  type CuentaControl,
  type Subcategoria,
} from "@/lib/finanzas/types/chart-of-account";

// ---------------------------------------------------------------------------
// Normalización de texto
// ---------------------------------------------------------------------------

/**
 * Clave canónica de un encabezado: minúsculas, sin acentos, sin puntuación de
 * borde, con espacios internos colapsados. "  Nombre de Cuenta : " → "nombre de cuenta".
 *
 * El strip de acentos usa NFD + borrado de marcas combinantes, así "Código" y
 * "Codigo" caen en la misma clave y no hace falta enumerar cada variante.
 */
export function normalizeHeaderKey(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/^[\s.:;,_-]+|[\s.:;,_-]+$/g, "")
    .trim();
}

/** Igual que normalizeHeaderKey pero para valores de celda (tipo, subcategoría). */
function normalizeValueKey(value: unknown): string {
  return normalizeHeaderKey(value);
}

/**
 * Lookup inverso label español → value snake_case, para que el Excel pueda
 * traer "Propiedad, planta y equipo" y no solo "propiedad_planta_equipo".
 *
 * Hace falta un mapa de verdad, no un `replace(" ", "_")`: los labels tienen
 * comas y conectores que el value no lleva ("Propiedad, planta y equipo" →
 * `propiedad_planta_equipo`), así que ninguna transformación mecánica los une.
 */
const SUBCATEGORIA_BY_LABEL: Record<string, Subcategoria> = Object.fromEntries(
  SUBCATEGORIAS.map((s) => [normalizeHeaderKey(SUBCATEGORIA_LABEL_ES[s]), s])
);

/**
 * Interpreta el valor de la celda Subcategoría. Acepta el value snake_case o el
 * label en español (con o sin acentos/mayúsculas). null = no reconocido.
 */
export function parseSubcategoria(raw: unknown): Subcategoria | null {
  const text = raw == null ? "" : String(raw).trim();
  if (text === "") return null;

  const normalized = normalizeValueKey(text);

  // 1) ¿Es el value tal cual? ("gasto_operativo", "GASTO_OPERATIVO")
  const asValue = normalized.replace(/ /g, "_");
  if (isSubcategoria(asValue)) return asValue;

  // 2) ¿Es el label en español? ("Gasto operativo", "Propiedad, planta y equipo")
  return SUBCATEGORIA_BY_LABEL[normalized] ?? null;
}

// ---------------------------------------------------------------------------
// Alias de columnas
// ---------------------------------------------------------------------------

/**
 * Alias aceptados por campo, ya normalizados. Se comparan por igualdad exacta
 * contra la clave normalizada del encabezado — NO por `includes()`, porque
 * "saldo final" no debe caer en "saldo inicial" y "tipo de cuenta" no debe
 * caer en el alias "cuenta" del código.
 */
const COLUMN_ALIASES = {
  code: ["codigo", "codigo de cuenta", "numero", "numero de cuenta", "cuenta", "nro", "no"],
  name: ["nombre", "nombre de cuenta", "nombre de la cuenta", "descripcion"],
  type: ["tipo", "tipo de cuenta", "tipo cuenta"],
  subcategoria: ["subcategoria", "sub categoria"],
  saldo: [
    "saldo inicial",
    "saldo_inicial",
    "balance inicial",
    "saldo de apertura",
    "saldo apertura",
  ],
} as const;

export type ColumnField = keyof typeof COLUMN_ALIASES;

/** Índice de cada campo en la fila de encabezado. -1 = columna ausente. */
export interface ColumnIndexes {
  code: number;
  name: number;
  type: number;
  subcategoria: number;
  saldo: number;
}

function emptyColumns(): ColumnIndexes {
  return { code: -1, name: -1, type: -1, subcategoria: -1, saldo: -1 };
}

/**
 * Mapea una fila candidata a encabezado → índices de columna. Si dos columnas
 * matchean el mismo campo gana la primera (izquierda), que es la que un humano
 * leería como la principal.
 */
export function mapHeaderRow(row: unknown[]): ColumnIndexes {
  const cols = emptyColumns();
  row.forEach((cell, index) => {
    const key = normalizeHeaderKey(cell);
    if (!key) return;
    for (const field of Object.keys(COLUMN_ALIASES) as ColumnField[]) {
      if (cols[field] !== -1) continue; // ya asignada: la primera gana
      if ((COLUMN_ALIASES[field] as readonly string[]).includes(key)) {
        cols[field] = index;
        return;
      }
    }
  });
  return cols;
}

/**
 * Encuentra la fila de encabezado. Recorre de arriba hacia abajo y se queda con
 * la PRIMERA fila que identifique código Y nombre — el mínimo para poder
 * importar algo. Las filas de título del balance de comprobación de Josuar
 * ("INTEGRA LEGAL, S.A.", "Balance de comprobación", "Al 31/12/2025") no
 * matchean ningún alias, así que se saltan solas.
 *
 * Solo mira las primeras `limit` filas: si no hay encabezado ahí, el archivo no
 * es lo que esperamos y es mejor un error claro que adivinar.
 */
export function findHeaderRow(
  rows: unknown[][],
  limit = 30
): { index: number; columns: ColumnIndexes } | null {
  const max = Math.min(rows.length, limit);
  for (let i = 0; i < max; i++) {
    const columns = mapHeaderRow(rows[i] ?? []);
    if (columns.code !== -1 && columns.name !== -1) {
      return { index: i, columns };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mapeo de Tipo (español) → account_type + subcategoría por defecto
// ---------------------------------------------------------------------------

/**
 * Resultado del mapeo de tipo. `subcategoriaDefault` es la subcategoría que se
 * asume cuando la fila NO trae una columna Subcategoría explícita.
 *
 * El caso importante: "Costo" y "Gasto" colapsan al MISMO account_type
 * ('expense') porque el CHECK de BD solo admite 5 valores en inglés. Lo que los
 * distingue en el Estado de Resultado es la subcategoría — de ahí que el mapeo
 * la complete solo (costo vs gasto_operativo). Ver Paso 1a.
 */
export interface AccountTypeMapping {
  account_type: AccountType;
  subcategoriaDefault: Subcategoria | null;
}

/**
 * Tabla de mapeo. Acepta singular y plural en español, y además los 5 valores
 * crudos en inglés (tolerancia barata: permite re-importar un archivo que salió
 * de una exportación del propio sistema).
 *
 * Activo / Pasivo / Patrimonio / Ingreso NO reciben subcategoría por defecto a
 * propósito: para el Balance General hay que distinguir corriente de no
 * corriente y eso NO se puede inferir del tipo. Se deja NULL (sin clasificar) y
 * se completa con la columna Subcategoría del Excel o editando la cuenta.
 */
const TYPE_MAP: Record<string, AccountTypeMapping> = {
  activo: { account_type: "asset", subcategoriaDefault: null },
  activos: { account_type: "asset", subcategoriaDefault: null },
  asset: { account_type: "asset", subcategoriaDefault: null },

  pasivo: { account_type: "liability", subcategoriaDefault: null },
  pasivos: { account_type: "liability", subcategoriaDefault: null },
  liability: { account_type: "liability", subcategoriaDefault: null },

  patrimonio: { account_type: "equity", subcategoriaDefault: null },
  equity: { account_type: "equity", subcategoriaDefault: null },

  // Las cuentas de RESULTADO defaultean a la actividad de OPERACIÓN. Desde
  // NIIF 18 la subcategoría es obligatoria en estas cuentas, así que dejarla en
  // null haría fallar la importación de toda fila que no la traiga explícita.
  // Inversión y financiamiento se eligen a mano en la columna Subcategoría.
  ingreso: { account_type: "income", subcategoriaDefault: "ingresos_operativos" },
  ingresos: { account_type: "income", subcategoriaDefault: "ingresos_operativos" },
  income: { account_type: "income", subcategoriaDefault: "ingresos_operativos" },

  // COSTO es su propio account_type desde NIIF 18 (antes era expense + costo).
  costo: { account_type: "cost", subcategoriaDefault: "costos_operativos" },
  costos: { account_type: "cost", subcategoriaDefault: "costos_operativos" },
  "costo de venta": { account_type: "cost", subcategoriaDefault: "costos_operativos" },
  "costos de venta": { account_type: "cost", subcategoriaDefault: "costos_operativos" },
  "costo operativo": { account_type: "cost", subcategoriaDefault: "costos_operativos" },
  "costos operativos": { account_type: "cost", subcategoriaDefault: "costos_operativos" },
  cost: { account_type: "cost", subcategoriaDefault: "costos_operativos" },

  gasto: { account_type: "expense", subcategoriaDefault: "gastos_operativos" },
  gastos: { account_type: "expense", subcategoriaDefault: "gastos_operativos" },
  "gasto operativo": { account_type: "expense", subcategoriaDefault: "gastos_operativos" },
  "gastos operativos": { account_type: "expense", subcategoriaDefault: "gastos_operativos" },
  expense: { account_type: "expense", subcategoriaDefault: "gastos_operativos" },
};

/** Mapea el Tipo en español a account_type + subcategoría default. null si no se reconoce. */
export function mapAccountType(raw: unknown): AccountTypeMapping | null {
  const key = normalizeValueKey(raw);
  if (!key) return null;
  return TYPE_MAP[key] ?? null;
}

/** Lista de tipos aceptados, para el mensaje de error de una fila inválida. */
export const ACCEPTED_TYPE_LABELS =
  "Activo, Pasivo, Patrimonio, Ingreso, Costo, Gasto";

// ---------------------------------------------------------------------------
// Parseo del saldo inicial
// ---------------------------------------------------------------------------

/** numeric(14,2) → 12 dígitos enteros. Mismo tope que el validador del 1a. */
const SALDO_ABS_MAX = 1_000_000_000_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type SaldoParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/**
 * Parsea el saldo inicial de una celda. Vacío / ausente → 0.
 *
 * Tolera lo que aparece en planillas reales: símbolo de moneda ("B/. 1,200.50",
 * "$1200"), espacios, negativo con signo o entre paréntesis (convención
 * contable: "(1,234.00)" = -1234.00), y separadores de miles/decimales en
 * formato US o europeo.
 *
 * Regla de separadores (documentada porque es inherentemente ambigua):
 *   - Si aparecen "," y ".", el que va ÚLTIMO es el decimal ("1.234,56" → ES,
 *     "1,234.56" → US).
 *   - Solo comas: si calza el patrón de miles `1,234` / `1,234,567` se tratan
 *     como miles; si no ("1,5") la coma es decimal.
 *   - Solo puntos: 2 o más puntos son miles ("1.234.567"); UN punto es decimal
 *     ("1.234" → 1.23). Panamá usa formato US, así que el punto suelto se
 *     interpreta como decimal.
 */
export function parseSaldoInicial(raw: unknown): SaldoParseResult {
  // Celda numérica real (XLSX con raw:true) — el camino feliz.
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "Saldo inicial no es un número" };
    if (Math.abs(raw) >= SALDO_ABS_MAX) {
      return { ok: false, reason: "Saldo inicial fuera de rango (máximo 12 dígitos)" };
    }
    return { ok: true, value: round2(raw) };
  }

  if (raw == null) return { ok: true, value: 0 };

  let s = String(raw).trim();
  if (s === "" || s === "-" || s === "—") return { ok: true, value: 0 };

  // Negativo entre paréntesis (convención contable).
  let negative = false;
  const parens = s.match(/^\((.*)\)$/);
  if (parens) {
    negative = true;
    s = parens[1].trim();
  }

  // Moneda y espacios.
  s = s.replace(/B\/\.?/gi, "").replace(/USD/gi, "").replace(/\$/g, "");
  s = s.replace(/[\s\u00a0]/g, "");

  // Signo explícito (puede venir además de los paréntesis).
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  if (s === "") return { ok: true, value: 0 };
  if (!/^[\d.,]+$/.test(s)) {
    return { ok: false, reason: `Saldo inicial inválido: "${String(raw).trim()}"` };
  }

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos presentes: el último es el decimal.
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(s)
      ? s.replace(/,/g, "")
      : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const dotCount = (s.match(/\./g) ?? []).length;
    normalized = dotCount >= 2 ? s.replace(/\./g, "") : s;
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: `Saldo inicial inválido: "${String(raw).trim()}"` };
  }
  if (Math.abs(n) >= SALDO_ABS_MAX) {
    return { ok: false, reason: "Saldo inicial fuera de rango (máximo 12 dígitos)" };
  }
  return { ok: true, value: round2(negative ? -n : n) };
}

// ---------------------------------------------------------------------------
// Parseo de filas
// ---------------------------------------------------------------------------

/**
 * Formato de código válido. Mismo criterio que
 * validators/chart-of-account.ts (letras, dígitos, guion y punto): un código
 * que no calce acá tampoco pasaría el validador del endpoint.
 */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]*$/;
const CODE_MAX = 20;
const NAME_MAX = 120;

/** Fila del archivo ya interpretada. `errors` vacío = lista para escribir. */
export interface ParsedImportRow {
  /** Fila en la planilla, 1-based, tal como la ve el usuario en Excel. */
  rowNumber: number;
  code: string;
  name: string;
  account_type: AccountType | null;
  subcategoria: Subcategoria | null;
  saldo_inicial: number;
  /** Motivos por los que la fila no se puede importar. Vacío = OK. */
  errors: string[];
}

export interface ParseSheetResult {
  /** Índice 0-based de la fila de encabezado dentro de la matriz. */
  headerRowIndex: number;
  columns: ColumnIndexes;
  rows: ParsedImportRow[];
  /** Filas descartadas en silencio (títulos, vacías, sin código). */
  skippedRows: number;
}

function cellAt(row: unknown[], index: number): unknown {
  if (index < 0) return null;
  return row[index] ?? null;
}

/**
 * Interpreta la matriz completa. Devuelve `null` si no encuentra encabezados
 * (el caller lo traduce a un error accionable para el usuario).
 *
 * Una fila SIN código válido se descarta EN SILENCIO, no como error: así los
 * títulos, subtotales ("TOTAL ACTIVOS") y filas en blanco del balance de
 * comprobación no ensucian el preview. Una fila CON código pero con tipo o
 * nombre inválido sí es un error: el usuario claramente quiso importarla.
 */
export function parseSheetRows(rows: unknown[][]): ParseSheetResult | null {
  const header = findHeaderRow(rows);
  if (!header) return null;

  const out: ParsedImportRow[] = [];
  let skipped = 0;

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1; // 1-based como Excel

    const codeRaw = cellAt(row, header.columns.code);
    const code = codeRaw == null ? "" : String(codeRaw).trim();

    // Sin código válido → no es una cuenta. Se descarta sin ruido.
    if (!code || code.length > CODE_MAX || !CODE_RE.test(code)) {
      skipped++;
      continue;
    }

    const errors: string[] = [];

    // Nombre
    const nameRaw = cellAt(row, header.columns.name);
    const name = nameRaw == null ? "" : String(nameRaw).trim().replace(/\s+/g, " ");
    if (!name) {
      errors.push("Falta el nombre de la cuenta");
    } else if (name.length < 2) {
      errors.push("Nombre muy corto (mínimo 2 caracteres)");
    } else if (name.length > NAME_MAX) {
      errors.push(`Nombre muy largo (máximo ${NAME_MAX} caracteres)`);
    }

    // Tipo → account_type + subcategoría por defecto
    const typeRaw = cellAt(row, header.columns.type);
    const mapping = mapAccountType(typeRaw);
    if (!mapping) {
      const shown = typeRaw == null || String(typeRaw).trim() === ""
        ? "(vacío)"
        : `"${String(typeRaw).trim()}"`;
      errors.push(`Tipo de cuenta no reconocido: ${shown}. Use: ${ACCEPTED_TYPE_LABELS}`);
    }

    // Subcategoría: la EXPLÍCITA del archivo gana sobre el default del tipo.
    let subcategoria: Subcategoria | null = mapping?.subcategoriaDefault ?? null;
    const subRaw = cellAt(row, header.columns.subcategoria);
    const subText = subRaw == null ? "" : String(subRaw).trim();
    if (subText !== "") {
      // Acepta el value snake_case ("gasto_operativo") o el label en español
      // ("Gasto operativo"), porque el usuario copia y pega de la plantilla.
      const explicit = parseSubcategoria(subText);
      if (explicit) {
        subcategoria = explicit;
      } else {
        errors.push(`Subcategoría no reconocida: "${subText}"`);
      }
    }

    // Saldo inicial
    const saldoResult = parseSaldoInicial(cellAt(row, header.columns.saldo));
    if (!saldoResult.ok) errors.push(saldoResult.reason);

    out.push({
      rowNumber,
      code,
      name,
      account_type: mapping?.account_type ?? null,
      subcategoria,
      saldo_inicial: saldoResult.ok ? saldoResult.value : 0,
      errors,
    });
  }

  return {
    headerRowIndex: header.index,
    columns: header.columns,
    rows: out,
    skippedRows: skipped,
  };
}

// ---------------------------------------------------------------------------
// Clasificación crear / actualizar / error
// ---------------------------------------------------------------------------

export type RowAction = "create" | "update" | "error";

/** Datos de la cuenta existente que el commit necesita PRESERVAR. */
export interface ExistingAccountInfo {
  id: string;
  /** Se reenvía en el update: el PATCH es reemplazo total y la borraría. */
  description: string | null;
  /** Ídem: un import NO debe reactivar ni desactivar cuentas. */
  active: boolean;
  /** Ídem: la marca de cuenta control se pone a mano y el Excel no la trae. */
  cuenta_control: CuentaControl | null;
  is_system: boolean;
}

export interface ClassifiedRow extends ParsedImportRow {
  action: RowAction;
  /** Presente solo si action === "update". */
  existingId?: string;
  /** true si la cuenta existente es del sistema (se muestra en el preview). */
  isSystem?: boolean;
}

export interface ClassifyResult {
  rows: ClassifiedRow[];
  counts: { create: number; update: number; error: number };
}

/**
 * Decide qué hacer con cada fila. `existing` mapea código → info de la cuenta
 * que ya está en la BD de ese tenant.
 *
 * Detecta además códigos REPETIDOS dentro del mismo archivo: la primera
 * aparición se procesa y las siguientes quedan en error. Sin este guard, dos
 * filas con el mismo código se escribirían una sobre la otra y el resumen
 * mentiría ("2 creadas" cuando en la BD hay 1).
 */
export function classifyRows(
  rows: ParsedImportRow[],
  existing: Map<string, ExistingAccountInfo>
): ClassifyResult {
  const seen = new Set<string>();
  const counts = { create: 0, update: 0, error: 0 };

  const classified = rows.map((row): ClassifiedRow => {
    const errors = [...row.errors];

    if (seen.has(row.code)) {
      errors.push(`Código "${row.code}" repetido en el archivo (solo se toma la primera fila)`);
    } else {
      seen.add(row.code);
    }

    if (errors.length > 0) {
      counts.error++;
      return { ...row, errors, action: "error" };
    }

    const match = existing.get(row.code);
    if (match) {
      counts.update++;
      return {
        ...row,
        errors,
        action: "update",
        existingId: match.id,
        isSystem: match.is_system,
      };
    }

    counts.create++;
    return { ...row, errors, action: "create" };
  });

  return { rows: classified, counts };
}

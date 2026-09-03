/**
 * LÍNEAS DE GASTO — el modelo compartido por los DOS módulos.
 *
 * Una línea cuelga de un gasto de trámite (`expenses`, módulo Legal) O de una
 * compra del bufete (`business_expenses`, módulo Finanzas). Nunca de los dos:
 * la tabla tiene dos FK nullables y un CHECK de exclusividad.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ UNA SOLA TABLA PARA LOS DOS MÓDULOS
 * ═════════════════════════════════════════════════════════════════════════════
 * El 02/09/2026 se descubrió que un gasto admite UNA sola cuenta contable y el
 * fixture ya tenía un caso que necesita tres: el gasto del 15/03 se muestra como
 * "Honorarios Profesionales $1.497,85" pero su asiento lo parte en útiles
 * 412,35 / honorarios 900,00 / mensajería 185,50.
 *
 * Ese hallazgo aplica IGUAL a los dos módulos, así que el modelo se comparte
 * desde el arranque. Lo que se reusa no es solo la forma de la fila: es este
 * archivo, el validador, el editor de líneas y el builder que las convierte en
 * líneas de asiento. Con dos tablas gemelas se duplicarían los cuatro, y dos
 * cosas duplicadas divergen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ LO QUE **NO** SE COMPARTE: A DÓNDE VA EL ITBMS
 * ─────────────────────────────────────────────────────────────────────────────
 * La línea GUARDA `tax_rate` y `tax_amount`. Quién decide contra qué cuenta va
 * ese impuesto es el builder del asiento, y es distinto en cada módulo:
 *
 *   · **Gasto de trámite** — el ITBMS es PASS-THROUGH. El bufete paga 107 por
 *     cuenta del cliente y le refactura 107 exento (los `REIM-*` del catálogo
 *     tienen `default_tax_code = 'EXENTO'`). No es crédito fiscal, porque el
 *     gasto no es del bufete: va entero a la cuenta del activo recuperable.
 *
 *   · **Compra del bufete** — el ITBMS SÍ es crédito fiscal, un activo propio.
 *     Y esa cuenta NO EXISTE en el plan: es una de las tres definiciones que
 *     faltan del contador.
 *
 * 🔑 Consecuencia práctica: **el gasto de trámite no está bloqueado por la
 * pregunta del ITBMS.** Ese bloqueo es solo de compras.
 */

// ---------------------------------------------------------------------------
// A QUÉ CUELGA UNA LÍNEA
// ---------------------------------------------------------------------------

/** Los dos documentos que pueden tener líneas. */
export type ExpenseParentKind = "tramite" | "compra";

/**
 * La columna FK que corresponde a cada tipo de padre. Se escribe explícito, y
 * no se deduce del nombre, para que el compilador avise si aparece un tercer
 * tipo de documento.
 */
export const COLUMNA_PADRE: Record<ExpenseParentKind, "expense_id" | "business_expense_id"> = {
  tramite: "expense_id",
  compra: "business_expense_id",
};

// ---------------------------------------------------------------------------
// LA CUENTA DE LA LÍNEA
// ---------------------------------------------------------------------------

/**
 * Cuenta por defecto de un gasto de trámite NUEVO: `130003 Fondo Legales de
 * Clientes`.
 *
 * Lo decidió el acta del 25/08/2026 ("Gasto de trámite al incurrirlo: DEBE
 * 130003, HABER Cuentas por Pagar"). Es un DEFAULT, no una imposición: la regla
 * de Rose es que ningún campo de cuenta se cierra por completo, así que la
 * pantalla lo precarga y deja cambiarlo.
 *
 * ⚠️ Vive acá y NO como DEFAULT de la columna en la base, a propósito. Un
 * default de base clasificaría en silencio cualquier fila que entre sin cuenta
 * —incluido un backfill o un script—, y eso es exactamente lo que se decidió
 * evitar (ver `chart_account_code` abajo).
 */
export const CUENTA_TRAMITE_DEFAULT = "130003";

/** Contrapartida del gasto al incurrirlo: `200001 Cuentas por pagar`. */
export const CUENTA_POR_PAGAR = "200001";

/**
 * Lo que se muestra cuando una línea no tiene cuenta.
 *
 * NO es "—" ni una cadena vacía: es un estado que alguien tiene que resolver, y
 * la pantalla lo marca en ámbar para que se vea.
 */
export const LABEL_SIN_CLASIFICAR = "Sin clasificar";

// ---------------------------------------------------------------------------
// FILAS
// ---------------------------------------------------------------------------

/** Una línea tal como vuelve de la base. */
export interface ExpenseLineRow {
  id: string;
  line_order: number;
  description: string;
  /**
   * 🔴 NULLABLE, Y ES UNA DECISIÓN, NO UN DESCUIDO.
   *
   * Las líneas que creó el backfill de los gastos históricos quedan en **NULL**,
   * no en `CUENTA_TRAMITE_DEFAULT`. Esos gastos se cargaron cuando el campo no
   * existía: **nadie los clasificó nunca.** Escribirles `130003` no sería
   * aplicar un default, sería inventar un dato y darle la misma apariencia que a
   * uno cargado por una persona. Algunos pueden haber sido costo propio del
   * bufete (`500005`) y no fondos de cliente.
   *
   * Que sea `string | null` es la garantía: **el builder del asiento no compila
   * si no maneja el caso**, así que una línea sin clasificar no se puede postear
   * por accidente. La alternativa —un flag `clasificacion_verificada`— es una
   * columna que hay que acordarse de consultar, y un comentario en la migración
   * no viaja con la fila.
   *
   * Lo NUEVO nunca nace en NULL: lo exige el validador al crear.
   *
   * La consulta de limpieza es `WHERE chart_account_code IS NULL`, y se vacía
   * sola a medida que alguien clasifica.
   */
  chart_account_code: string | null;
  /** Nombre de la cuenta, resuelto contra el plan. Null si no hay cuenta. */
  chart_account_name: string | null;
  /** Base, sin impuesto. */
  amount: number;
  /** Decimal [0, 1] — 0.07 = 7%. */
  tax_rate: number;
  tax_amount: number;
  /** Columna generada: `amount + tax_amount`. */
  line_total: number;
}

/**
 * Una línea en edición. Todo string porque viene de inputs del DOM: convertir
 * en el momento de teclear hace que "1." o "-" se borren mientras se escribe.
 */
export interface ExpenseLineDraft {
  /** Clave local del editor, no el id de la base. */
  key: string;
  description: string;
  chart_account_code: string;
  amount: string;
  tax_rate: string;
  tax_amount: string;
}

// ---------------------------------------------------------------------------
// TOTALES — módulo PURO
// ---------------------------------------------------------------------------

/** Redondeo a centavos, el único que se usa en este módulo. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface TotalesDeGasto {
  /** Suma de las bases. */
  base: number;
  /** Suma de los impuestos. */
  impuesto: number;
  /** `base + impuesto`. Es lo que se le debe al proveedor. */
  total: number;
}

/**
 * Los tres totales de un conjunto de líneas.
 *
 * Se redondea CADA suma al final y no línea por línea: `line_total` ya es una
 * columna generada en la base, así que sumar los redondeos de las partes daría
 * un número distinto al que la base calcula. El total de la cabecera tiene que
 * coincidir al centavo con `SUM(line_total)` o el asiento no cuadra.
 */
export function totalesDeLineas(
  lineas: readonly { amount: number; tax_amount: number }[]
): TotalesDeGasto {
  let base = 0;
  let impuesto = 0;
  for (const l of lineas) {
    base += Number(l.amount) || 0;
    impuesto += Number(l.tax_amount) || 0;
  }
  base = round2(base);
  impuesto = round2(impuesto);
  return { base, impuesto, total: round2(base + impuesto) };
}

/**
 * El ITBMS que corresponde a una base y una tasa.
 *
 * Existe para que el editor pueda precalcularlo al teclear, pero el valor que se
 * guarda es el que quede en el campo: el comprobante manda, y un proveedor puede
 * redondear distinto. El validador verifica coherencia con tolerancia, no
 * igualdad.
 */
export function impuestoSugerido(base: number, tasa: number): number {
  if (!Number.isFinite(base) || !Number.isFinite(tasa)) return 0;
  return round2(base * tasa);
}

/** Label de una tasa como porcentaje: 0.07 → "7%". */
export function tasaLabel(tasa: number): string {
  const pct = round2(tasa * 100);
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** Lo que se muestra en la columna de cuenta de una línea. */
export function cuentaLabel(linea: {
  chart_account_code: string | null;
  chart_account_name: string | null;
}): string {
  if (!linea.chart_account_code) return LABEL_SIN_CLASIFICAR;
  return linea.chart_account_name
    ? `${linea.chart_account_code} · ${linea.chart_account_name}`
    : linea.chart_account_code;
}

/** true si alguna línea quedó sin clasificar (viene del backfill histórico). */
export function haySinClasificar(
  lineas: readonly { chart_account_code: string | null }[]
): boolean {
  return lineas.some((l) => !l.chart_account_code);
}

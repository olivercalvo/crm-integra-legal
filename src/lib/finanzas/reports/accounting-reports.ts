/**
 * Armado PURO del Balance General y el Estado de Resultado (Paso 2 del plan
 * contable con Josuar, ver docs/finanzas/roadmap-contable.md §10).
 *
 * Este módulo NO toca la BD: recibe una lista de cuentas con su saldo y devuelve
 * las estructuras que la UI renderiza. La lectura vive en
 * `accounting-source.ts`, que es el ÚNICO archivo a cambiar cuando llegue el
 * motor de posteo (Paso 3) y el saldo pase a ser
 * `saldo_inicial + movimientos del ledger`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONVENCIÓN DE SIGNOS — es la de Josuar (balanza), y NO se invierte
 * ─────────────────────────────────────────────────────────────────────────────
 * Los saldos llegan en convención de balanza de comprobación:
 *
 *     DÉBITO  (positivo):  activos, costos, gastos
 *     CRÉDITO (negativo):  pasivos, patrimonio, ingresos
 *
 * Los reportes se arman SUMANDO los saldos tal cual. Consecuencias que hay que
 * tener presentes al leer los números (son correctas, no bugs):
 *
 *   - "Total de Ingresos" sale NEGATIVO (ej. -289,137.06).
 *   - Una GANANCIA aparece como número NEGATIVO; una PÉRDIDA, positivo.
 *     De ahí que `hayUtilidad` sea `utilidadOperativa < 0`.
 *   - "Total Pasivo + Patrimonio" queda igual y OPUESTO al "Total de Activo"
 *     (257,902.46 vs -257,902.46). El balance cuadra cuando la SUMA de ambos
 *     da 0, no cuando son iguales.
 *
 * Esto replica exactamente la presentación de los modelos que mandó Josuar.
 */

import type { AccountType, Subcategoria } from "@/lib/finanzas/types/chart-of-account";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/**
 * Cuenta lista para reportar. `saldo` está en convención de balanza (ver arriba).
 *
 * En el Paso 3 esta interfaz NO cambia: lo que cambia es cómo se calcula
 * `saldo` (hoy = `saldo_inicial`; después = `saldo_inicial` + movimientos).
 */
export interface ReportAccount {
  code: string;
  name: string;
  account_type: AccountType;
  subcategoria: Subcategoria | null;
  /**
   * Saldo para reportar, en convención de balanza.
   *
   * Desde el 02/09/2026 es `saldo_inicial + Σ movimientos del ledger`, no el
   * saldo de apertura a secas. Los campos de abajo lo desglosan.
   */
  saldo: number;
  /** El saldo de apertura, sin movimientos. Opcional: los tests arman cuentas a mano. */
  saldoInicial?: number;
  /** Neto del ledger (débitos − créditos) que se sumó al inicial. */
  movimientoLedger?: number;
  /** Σ débitos del período. Lo usa el Balance de Comprobación. */
  debitos?: number;
  /** Σ créditos del período. Lo usa el Balance de Comprobación. */
  creditos?: number;
  /**
   * true si la cuenta está DESACTIVADA pero tiene movimientos.
   *
   * Entra al reporte igual —su saldo es un hecho contable y sacarlo descuadraría
   * el estado— pero la pantalla tiene que decirlo: es un renglón que el contador
   * no espera ver en su plan de cuentas.
   */
  inactivaConMovimiento?: boolean;
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export interface ReportRow {
  code: string;
  name: string;
  amount: number;
}

/**
 * Grupo de renglones dentro de una sección. `label` null = grupo plano (la
 * sección no se subdivide, como INGRESOS o COSTOS en el modelo de Josuar).
 */
export interface ReportGroup {
  /** null = sin encabezado propio. */
  label: string | null;
  /** Etiqueta del subtotal. null = no se muestra subtotal del grupo. */
  subtotalLabel: string | null;
  rows: ReportRow[];
  subtotal: number;
  /**
   * true cuando el grupo junta cuentas SIN subcategoría. Se muestra al final de
   * su tipo y la UI avisa que hay que clasificarlas: sin este grupo esas
   * cuentas desaparecerían del reporte y los totales no cerrarían.
   */
  isUnclassified?: boolean;
}

export interface ReportSection {
  label: string;
  totalLabel: string;
  groups: ReportGroup[];
  total: number;
}

export interface EstadoResultado {
  ingresos: ReportSection;
  costos: ReportSection;
  /** Ingresos + Costos. Negativo = ganancia. */
  gananciaBruta: number;
  gastos: ReportSection;
  /** Ganancia bruta + Gastos. Negativo = ganancia. */
  utilidadOperativa: number;
  isr: IsrLine;
  /** Utilidad operativa + ISR. Negativo = ganancia. */
  utilidadNeta: number;
}

/**
 * Renglón de Impuesto sobre la Renta.
 *
 * PARÁMETRO, NO REGLA FISCAL: la tasa y el método (¿sobre utilidad operativa o
 * sobre una base gravable con ajustes? ¿tarifa alternativa CAIR?) están
 * PENDIENTES DE CONFIRMACIÓN de Josuar. Acá se aplica el cálculo más simple
 * posible —tasa plana sobre la utilidad operativa, solo si hay ganancia— y se
 * expone `rate` para que cambiarlo no requiera tocar la lógica del reporte.
 */
export interface IsrLine {
  /** Tasa usada, como fracción (0.25 = 25%). */
  rate: number;
  /** Monto en convención de balanza: positivo (débito), reduce la ganancia. */
  amount: number;
  /** false cuando no hubo utilidad y por lo tanto no se aplicó impuesto. */
  applied: boolean;
}

export interface BalanceGeneral {
  activos: ReportSection;
  pasivos: ReportSection;
  patrimonio: ReportSection;
  /**
   * Resultado del ejercicio que se lleva al patrimonio. Hoy = utilidad
   * OPERATIVA (decisión provisional, ver buildBalanceGeneral).
   */
  utilidadDelEjercicio: number;
  /** Total de Pasivos + Total de Patrimonio. */
  totalPasivoPatrimonio: number;
  /** Total de Activo + Total Pasivo+Patrimonio. 0 = cuadra. */
  descuadre: number;
  cuadra: boolean;
  /**
   * Cuentas de patrimonio con saldo distinto de cero.
   *
   * ⚠️ RIESGO DE DOBLE CONTEO. Este reporte suma las cuentas de patrimonio Y
   * agrega un renglón CALCULADO con la utilidad del ejercicio. Si la cuenta
   * `300003 Utilidad del Ejercicio` del plan de Josuar tiene saldo, el resultado
   * aparece dos veces y el balance se descuadra.
   *
   * Mientras el saldo venía solo de la apertura esto era hipotético. Desde que
   * el Balance suma el ledger (02/09/2026) un asiento de cierre puede acreditar
   * esa cuenta sin que nadie cargue nada a mano, así que el aviso lo emite el
   * builder —que es quien tiene los números— y no la pantalla.
   *
   * Vacío = no hay riesgo.
   */
  patrimonioConSaldo: ReportRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tasa de ISR por defecto: CERO.
 *
 * Integra es una **sociedad civil** y NO paga impuesto sobre la renta a nivel de
 * empresa: reparte el resultado a las socias y cada una paga su renta personal
 * (15%). Ese reparto es lo que muestra la sección de distribución del Estado de
 * Resultado (`estado-resultado-niif18.ts`), y por eso el ejercicio cierra en 0.
 *
 * **El parámetro se queda a propósito.** Rose lo pidió explícitamente pensando
 * en vender el sistema después a sociedades anónimas, que sí lo pagan: ahí se
 * pasa `isrRate` y el renglón aparece solo, sin tocar la lógica del reporte.
 *
 * Hasta el 27/08/2026 este default era 0.25, una tasa provisional que se puso
 * cuando todavía no estaba confirmado el tipo societario.
 */
export const DEFAULT_ISR_RATE = 0;

/** Tolerancia al comparar montos en B/. (medio centavo). */
const EPSILON = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Suma redondeando al final: evita arrastrar error binario en cadenas largas. */
function sumSaldos(accounts: ReportAccount[]): number {
  return round2(accounts.reduce((acc, a) => acc + a.saldo, 0));
}

function toRows(accounts: ReportAccount[]): ReportRow[] {
  return accounts.map((a) => ({ code: a.code, name: a.name, amount: round2(a.saldo) }));
}

/** Orden estable por código, numérico-aware ("100002" antes de "1100001"). */
function byCode(a: ReportAccount, b: ReportAccount): number {
  return a.code.localeCompare(b.code, "en", { numeric: true });
}

function sorted(accounts: ReportAccount[]): ReportAccount[] {
  return [...accounts].sort(byCode);
}

/** Grupo plano (sin encabezado ni subtotal propio). */
function flatGroup(accounts: ReportAccount[]): ReportGroup[] {
  const rows = sorted(accounts);
  if (rows.length === 0) return [];
  return [
    {
      label: null,
      subtotalLabel: null,
      rows: toRows(rows),
      subtotal: sumSaldos(rows),
    },
  ];
}

/**
 * Arma los grupos por subcategoría en el orden dado, y agrega al final un grupo
 * "Sin clasificar" con las cuentas cuya subcategoría es NULL o no está en la
 * lista esperada.
 *
 * Ese último grupo es lo que impide que una cuenta mal clasificada se caiga del
 * reporte en silencio: entra igual al total y la UI la señala.
 */
interface GroupSpec {
  subcategoria: Subcategoria;
  /** null = grupo sin encabezado propio (se lista plano). */
  label: string | null;
  /** null = sin subtotal propio. */
  subtotalLabel: string | null;
}

function groupsBySubcategoria(
  accounts: ReportAccount[],
  spec: GroupSpec[]
): ReportGroup[] {
  const groups: ReportGroup[] = [];
  const claimed = new Set<Subcategoria>();

  for (const g of spec) {
    claimed.add(g.subcategoria);
    const rows = sorted(accounts.filter((a) => a.subcategoria === g.subcategoria));
    if (rows.length === 0) continue;
    groups.push({
      label: g.label,
      subtotalLabel: g.subtotalLabel,
      rows: toRows(rows),
      subtotal: sumSaldos(rows),
    });
  }

  const leftovers = sorted(
    accounts.filter((a) => a.subcategoria === null || !claimed.has(a.subcategoria))
  );
  if (leftovers.length > 0) {
    groups.push({
      label: "Sin clasificar",
      subtotalLabel: "Total sin clasificar",
      rows: toRows(leftovers),
      subtotal: sumSaldos(leftovers),
      isUnclassified: true,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// ESTADO DE RESULTADO
// ---------------------------------------------------------------------------

export interface EstadoResultadoOptions {
  /** Tasa de ISR como fracción. Default DEFAULT_ISR_RATE (provisional). */
  isrRate?: number;
}

/**
 * Arma el Estado de Resultado con el formato de Josuar:
 *
 *   INGRESOS                     → Total de Ingresos
 *   COSTOS                       → Total de Costos
 *   GANANCIA O PÉRDIDA BRUTA     = Ingresos + Costos
 *   GASTOS OPERATIVOS            → Total de Gastos
 *   UTILIDAD OPERATIVA           = Bruta + Gastos
 *   IMPUESTO SOBRE LA RENTA      (parámetro, solo si hay utilidad)
 *   UTILIDAD NETA                = Operativa + ISR
 *
 * Las tres secciones se derivan del ACCOUNT_TYPE, una cada una: `income`,
 * `cost` y `expense`. Ninguna filtra por subcategoría.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAMBIÓ EN NIIF 18 (Fase 1, 2026-08-27) — leer si venís del código viejo
 * ─────────────────────────────────────────────────────────────────────────────
 * Antes, COSTOS y GASTOS partían `account_type='expense'` en dos POR
 * SUBCATEGORÍA (`costo` vs `gasto_operativo`), porque en BD ambos compartían el
 * mismo tipo. Desde que `cost` es un tipo propio, esa gimnasia sobra: el tipo ya
 * dice a qué sección va cada cuenta.
 *
 * Con eso desapareció también el grupo "Sin clasificar" que vivía dentro de
 * Gastos. Existía porque un `expense` con subcategoría NULL u otra no caía ni en
 * costos ni en gastos y se habría evaporado del reporte. Ahora que el criterio
 * es el tipo, NINGUNA cuenta puede evaporarse: cada cuenta de resultado tiene
 * exactamente un tipo y por lo tanto exactamente una sección. La subcategoría
 * pasa a ser un problema de AGRUPAMIENTO INTERNO, no de pertenencia — y eso es
 * lo que resuelve la Tarea 3 al abrir los bloques por actividad.
 */
export function buildEstadoResultado(
  accounts: ReportAccount[],
  options: EstadoResultadoOptions = {}
): EstadoResultado {
  const isrRate = options.isrRate ?? DEFAULT_ISR_RATE;

  const incomeAccounts = accounts.filter((a) => a.account_type === "income");
  const costoAccounts = accounts.filter((a) => a.account_type === "cost");
  const gastoAccounts = accounts.filter((a) => a.account_type === "expense");

  const ingresos: ReportSection = {
    label: "INGRESOS",
    totalLabel: "Total de Ingresos",
    groups: flatGroup(incomeAccounts),
    total: sumSaldos(incomeAccounts),
  };

  const costos: ReportSection = {
    label: "COSTOS",
    totalLabel: "Total de Costos",
    groups: flatGroup(costoAccounts),
    total: sumSaldos(costoAccounts),
  };

  const gananciaBruta = round2(ingresos.total + costos.total);

  const gastos: ReportSection = {
    label: "GASTOS OPERATIVOS",
    totalLabel: "Total de Gastos",
    groups: flatGroup(gastoAccounts),
    total: sumSaldos(gastoAccounts),
  };

  const utilidadOperativa = round2(gananciaBruta + gastos.total);

  // Convención de balanza: ganancia = negativo. Solo se grava si hay ganancia.
  const hayUtilidad = utilidadOperativa < -EPSILON;
  const isrAmount = hayUtilidad ? round2(-utilidadOperativa * isrRate) : 0;

  return {
    ingresos,
    costos,
    gananciaBruta,
    gastos,
    utilidadOperativa,
    isr: { rate: isrRate, amount: isrAmount, applied: hayUtilidad },
    utilidadNeta: round2(utilidadOperativa + isrAmount),
  };
}

// ---------------------------------------------------------------------------
// BALANCE GENERAL
// ---------------------------------------------------------------------------

/**
 * Orden de los grupos de ACTIVO, tal como los presenta Josuar: corriente →
 * propiedad, planta y equipo → no corriente. NO es el orden de SUBCATEGORIAS en
 * types/chart-of-account.ts (que pone no corriente antes de PPE); acá manda el
 * modelo del contador.
 */
const ACTIVO_GROUPS: GroupSpec[] = [
  {
    subcategoria: "activo_corriente",
    label: "Activos corrientes",
    subtotalLabel: "Total Activos corrientes",
  },
  {
    subcategoria: "propiedad_planta_equipo",
    label: "Propiedad, planta y equipo",
    subtotalLabel: "Total Propiedad, planta y equipo",
  },
  // Contracuenta de PPE, e inmediatamente debajo de ella porque es donde se lee:
  // el activo fijo NETO es la resta de las dos. Agregada el 01/09/2026 (Rose la
  // señaló como faltante el 25/08).
  //
  // ⚠️ Es la ÚNICA línea que este bloque toca del Balance General, y no mueve
  // ningún número: hoy no hay ninguna cuenta con esta subcategoría. Sin ella, la
  // subcategoría se podría asignar en el Plan de Cuentas pero la cuenta caería en
  // el grupo "sin clasificar" del Balance — o sea, el campo nuevo nacería roto.
  {
    subcategoria: "depreciacion_acumulada",
    label: "Depreciación acumulada",
    subtotalLabel: "Total Depreciación acumulada",
  },
  {
    subcategoria: "activo_no_corriente",
    label: "Activo no corriente",
    subtotalLabel: "Total Activo no corriente",
  },
];

const PASIVO_GROUPS: GroupSpec[] = [
  {
    subcategoria: "pasivo_corriente",
    label: "Pasivo corriente",
    subtotalLabel: "Total Pasivo corriente",
  },
  {
    subcategoria: "pasivo_no_corriente",
    label: "Pasivo no corriente",
    subtotalLabel: "Total Pasivo no corriente",
  },
];

/** El patrimonio va plano: el modelo de Josuar no lo subdivide. */
const PATRIMONIO_GROUPS: GroupSpec[] = [
  { subcategoria: "patrimonio", label: null, subtotalLabel: null },
];

export interface BalanceGeneralOptions {
  /**
   * Resultado del ejercicio a llevar al patrimonio. Se pasa desde afuera (en
   * vez de recalcularlo acá) para que el Balance y el Estado de Resultado no
   * puedan divergir: es literalmente el mismo número.
   */
  utilidadDelEjercicio: number;
}

/**
 * Arma el Balance General (Estado de Situación Financiera) con el formato de
 * Josuar: ACTIVOS agrupados por subcategoría, PASIVOS, y PATRIMONIO con un
 * renglón calculado "Utilidad del Ejercicio".
 *
 * ⚠️ RIESGO DE DOBLE CONTEO — leer antes de tocar:
 * El plan de cuentas de Josuar YA tiene una cuenta `300003 Utilidad del
 * Ejercicio` (equity / patrimonio) que hoy está en 0. Este reporte suma las
 * cuentas de patrimonio Y agrega el renglón calculado, tal como pide el modelo.
 * Mientras `300003` esté en 0 los totales dan bien; si alguien le carga un
 * saldo, la utilidad se contaría DOS VECES y el balance se descuadraría.
 * Por eso `cuadra`/`descuadre` se calculan y la UI muestra el descuadre en
 * lugar de esconderlo. Cuando llegue el Paso 3, el cierre del ejercicio debería
 * postear el resultado a `300003` y este renglón calculado desaparece.
 *
 * ⚠️ PROVISIONAL: se usa la utilidad OPERATIVA (antes de ISR), pendiente de que
 * Josuar confirme si el patrimonio debe llevar la operativa o la neta.
 */
export function buildBalanceGeneral(
  accounts: ReportAccount[],
  options: BalanceGeneralOptions
): BalanceGeneral {
  const assetAccounts = accounts.filter((a) => a.account_type === "asset");
  const liabilityAccounts = accounts.filter((a) => a.account_type === "liability");
  const equityAccounts = accounts.filter((a) => a.account_type === "equity");

  const activos: ReportSection = {
    label: "ACTIVOS",
    totalLabel: "Total de Activo",
    groups: groupsBySubcategoria(assetAccounts, ACTIVO_GROUPS),
    total: sumSaldos(assetAccounts),
  };

  const pasivos: ReportSection = {
    label: "PASIVOS",
    totalLabel: "Total de Pasivos",
    groups: groupsBySubcategoria(liabilityAccounts, PASIVO_GROUPS),
    total: sumSaldos(liabilityAccounts),
  };

  const utilidadDelEjercicio = round2(options.utilidadDelEjercicio);

  // Las cuentas de patrimonio van planas (el modelo de Josuar no las subdivide),
  // más el renglón calculado del resultado del ejercicio.
  const equityGroups = groupsBySubcategoria(equityAccounts, PATRIMONIO_GROUPS);
  const patrimonio: ReportSection = {
    label: "PATRIMONIO",
    totalLabel: "Total de Patrimonio",
    groups: equityGroups,
    total: round2(sumSaldos(equityAccounts) + utilidadDelEjercicio),
  };

  const totalPasivoPatrimonio = round2(pasivos.total + patrimonio.total);
  // Convención de balanza: Activo y (Pasivo + Patrimonio) son iguales y
  // opuestos, así que cuadra cuando la SUMA da 0.
  const descuadre = round2(activos.total + totalPasivoPatrimonio);

  // Cualquier cuenta de patrimonio con saldo es candidata a duplicar el
  // resultado, no solo la 300003: el renglón calculado se suma igual.
  const patrimonioConSaldo: ReportRow[] = equityAccounts
    .filter((a) => Math.abs(a.saldo) >= EPSILON)
    .map((a) => ({ code: a.code, name: a.name, amount: round2(a.saldo) }));

  return {
    activos,
    pasivos,
    patrimonio,
    utilidadDelEjercicio,
    totalPasivoPatrimonio,
    descuadre,
    cuadra: Math.abs(descuadre) < EPSILON,
    patrimonioConSaldo,
  };
}

/**
 * Arma los DOS reportes de una pasada, garantizando que la "Utilidad del
 * Ejercicio" del Balance sea exactamente la utilidad operativa del Estado de
 * Resultado.
 */
export function buildAccountingReports(
  accounts: ReportAccount[],
  options: EstadoResultadoOptions = {}
): { estadoResultado: EstadoResultado; balanceGeneral: BalanceGeneral } {
  const estadoResultado = buildEstadoResultado(accounts, options);
  const balanceGeneral = buildBalanceGeneral(accounts, {
    utilidadDelEjercicio: estadoResultado.utilidadOperativa,
  });
  return { estadoResultado, balanceGeneral };
}

/**
 * LIBRO MAYOR — armado puro.
 *
 * Reproduce el modelo que mandó Josuar (`Temas Contables/image001.png`), con
 * sus columnas y en su orden:
 *
 *   cuenta de distribución · fecha · tipo de transacción · número · nombre ·
 *   descripción · cuenta de contrapartida · importe · saldo
 *
 * Cada cuenta arranca con una fila "Saldo inicial" y cierra con su total.
 *
 * Módulo PURO: sin I/O, sin React. La lectura vive en `libro-mayor-source.ts`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ TRES DECISIONES PENDIENTES DE JOSUAR, AISLADAS A PROPÓSITO
 * ═════════════════════════════════════════════════════════════════════════════
 * Su modelo no alcanza a definir tres cosas. Cada una vive en UNA función, para
 * que cuando conteste haya que cambiar tres funciones y no rastrear el criterio
 * por media pantalla:
 *
 *   consulta 3 → `contrapartidaDe()`   (en `contabilidad/contrapartida.ts`)
 *   consulta 4 → `totalesDePie()`      (acá abajo)
 *   consulta 5 → `importeDeLinea()`    (acá abajo)
 *
 * Ninguna es un placeholder: las tres tienen una versión defendible y
 * funcionando. Lo que está pendiente es cuál de las alternativas quiere él.
 */

import {
  contrapartidaDe,
  contrapartidaEsAmbigua,
  type LineaParaContrapartida,
} from "@/lib/finanzas/contabilidad/contrapartida";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/**
 * Una línea hermana dentro del mismo asiento.
 *
 * Extiende lo que necesita `contrapartidaDe()` con dos campos que usa el mayor:
 * `line_order` (para identificar la línea propia cuando un asiento toca la
 * misma cuenta dos veces) y `descripcion` (de donde sale el nombre del tercero).
 *
 * Se extiende ACÁ y no en `contrapartida.ts` a propósito: ese módulo es el punto
 * aislado de una decisión pendiente y conviene que no acumule campos que no
 * necesita para decidir.
 */
export interface LineaHermana extends LineaParaContrapartida {
  line_order: number;
  descripcion: string | null;
}

/** Una línea de asiento, con lo que hace falta del asiento que la contiene. */
export interface MovimientoCrudo {
  entry_id: string;
  entry_number: number;
  transaction_date: string;
  /** `source_type` del asiento: factura, gasto, pago, manual, apertura… */
  source_type: string;
  source_id: string | null;
  /** Naturaleza del asiento (Art. 5.5). */
  entry_description: string;
  /** Descripción propia de la línea, si tiene. */
  line_description: string | null;
  line_order: number;
  debit: number;
  credit: number;
  /** La cuenta de ESTA línea. */
  account_code: string;
  account_name: string;
  account_type: AccountType;
  /** TODAS las líneas del asiento, para poder resolver la contrapartida. */
  hermanas: LineaHermana[];
}

export interface CuentaDelMayor {
  code: string;
  name: string;
  account_type: AccountType;
  saldo_inicial: number;
  saldo_inicial_fecha: string | null;
}

// ---------------------------------------------------------------------------
// PENDIENTE — CONSULTA 5: ¿el importe va con signo, o en Debe/Haber?
// ---------------------------------------------------------------------------

/**
 * El importe de un movimiento, para la columna "Importe".
 *
 * En el modelo de Josuar la columna trae UN número CON SIGNO, no dos columnas
 * Debe/Haber. En `1021 Banco Pichincha` (un activo) se ve así:
 *
 *     Pago                          12,412.00     (entra → positivo)
 *     Pago de facturas de proveedor  -1,712.00     (sale  → negativo)
 *
 * O sea: para un ACTIVO, importe = débito − crédito.
 *
 * ⚠️ LO QUE NO SE SABE: qué pasa con un PASIVO o un INGRESO. Todos los ejemplos
 * visibles de su modelo son cuentas de activo. Hay dos criterios posibles:
 *
 *   a) SIEMPRE `débito − crédito` (convención de balanza). Un pasivo que crece
 *      se ve negativo, igual que en el Balance General de este sistema.
 *   b) Según la NATURALEZA de la cuenta: `crédito − débito` en pasivo,
 *      patrimonio e ingreso, para que "la cuenta crece" siempre se lea en
 *      positivo.
 *
 * Se implementa (a), y por dos razones concretas: es lo único que su modelo
 * muestra, y es la convención que YA usan el Balance General y la balanza de
 * este sistema — mezclar dos convenciones en reportes que se leen juntos es
 * peor que elegir la que no se puede confirmar del todo.
 *
 * Si Josuar pide (b), se cambia SOLO esta función.
 */
export function importeDeLinea(m: {
  debit: number;
  credit: number;
  account_type: AccountType;
}): number {
  return round2(m.debit - m.credit);
}

/**
 * Cuánto mueve esta línea el SALDO CORRIDO de la cuenta.
 *
 * Va aparte de `importeDeLinea()` a propósito. Si mañana el importe pasa a
 * mostrarse "según la naturaleza de la cuenta" (opción b de arriba), el saldo
 * corrido NO debe cambiar con él: el saldo se acumula siempre en convención de
 * balanza para que cierre contra el Balance General. Son dos cosas distintas
 * que hoy dan lo mismo.
 */
export function efectoEnSaldo(m: { debit: number; credit: number }): number {
  return round2(m.debit - m.credit);
}

// ---------------------------------------------------------------------------
// PENDIENTE — CONSULTA 4: ¿el pie es el neto, el saldo final, o los dos?
// ---------------------------------------------------------------------------

export interface TotalesPie {
  /** Suma de los movimientos del período. NO incluye el saldo inicial. */
  netoDelPeriodo: number;
  /** Saldo inicial + movimientos. Es con lo que la cuenta queda. */
  saldoFinal: number;
  /** Suma de los débitos del período (informativo). */
  totalDebitos: number;
  /** Suma de los créditos del período (informativo). */
  totalCreditos: number;
}

/**
 * Los totales del pie de cada cuenta.
 *
 * ⚠️ En el modelo de Josuar el recuadro del pie **NO es el saldo final: es la
 * suma de los movimientos**. Se verifica con su propio ejemplo, y por eso vale
 * la pena dejarlo escrito — es el detalle que más fácil se lee mal:
 *
 *     1021 Banco Pichincha 261
 *       Saldo inicial ................  14,381.27
 *       + 12,412.00 − 1,712.00 − 351.25 − 3,608.74
 *       saldo corrido final ..........  21,121.28
 *       recuadro del pie .............   6,740.01   ← el NETO, no el saldo
 *
 *     12,412.00 − 1,712.00 − 351.25 − 3,608.74 = 6,740.01 ✓
 *
 * Como la descripción del requisito decía solo "cierra con su total" —que es
 * ambiguo— se muestran **LOS DOS, rotulados**. Es más información, no menos, y
 * la respuesta de Josuar va a ser quedarse con uno.
 */
export function totalesDePie(
  saldoInicial: number,
  movimientos: { debit: number; credit: number }[]
): TotalesPie {
  const totalDebitos = round2(movimientos.reduce((s, m) => s + m.debit, 0));
  const totalCreditos = round2(movimientos.reduce((s, m) => s + m.credit, 0));
  const netoDelPeriodo = round2(totalDebitos - totalCreditos);
  return {
    netoDelPeriodo,
    saldoFinal: round2(saldoInicial + netoDelPeriodo),
    totalDebitos,
    totalCreditos,
  };
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

/** Una fila del mayor, con las columnas del modelo de Josuar. */
export interface FilaMayor {
  kind: "saldo-inicial" | "movimiento";
  /** Columna "Cuenta de distribución": la cuenta cuyo mayor se está viendo. */
  cuentaDistribucion: string;
  fecha: string | null;
  /** Columna "Tipo de transacción", en español. */
  tipoTransaccion: string;
  /** Columna "Número": el correlativo del asiento. */
  numero: string;
  /** Columna "Nombre": el tercero. Ver `nombreDelTercero()`. */
  nombre: string;
  descripcion: string;
  contrapartida: string;
  /** true si la contrapartida es ambigua (más de una cuenta del otro lado). */
  contrapartidaAmbigua: boolean;
  importe: number;
  saldo: number;
  // --- trazabilidad nivel 2 ---
  entryId: string | null;
  sourceType: string | null;
  sourceId: string | null;
}

export interface MayorDeCuenta {
  cuenta: CuentaDelMayor;
  filas: FilaMayor[];
  totales: TotalesPie;
  /** Cuántos movimientos entraron (sin contar la fila de saldo inicial). */
  cantidadMovimientos: number;
}

/** Etiqueta en español del `source_type` del asiento. */
const TIPO_TRANSACCION_ES: Record<string, string> = {
  factura: "Factura",
  gasto: "Gasto / compra",
  pago: "Pago",
  nota_credito: "Nota de crédito",
  manual: "Asiento de diario",
  reversion: "Reversión",
  apertura: "Asiento de apertura",
};

export function tipoTransaccionLabel(sourceType: string): string {
  return TIPO_TRANSACCION_ES[sourceType] ?? sourceType;
}

/**
 * Columna "Nombre" — el tercero de la operación.
 *
 * El ledger NO tiene un campo de tercero: no se modeló, y agregarlo ahora
 * tocaría una tabla inmutable. Se deduce de la descripción de la línea que toca
 * la CUENTA CONTROL del asiento (`cuenta_control` = clientes o proveedores),
 * que es justamente donde el seed y el futuro cableado ponen el nombre.
 *
 * Si no hay línea de cuenta control, queda vacío en vez de inventar algo.
 */
export function nombreDelTercero(
  hermanas: LineaHermana[],
  controlPorCodigo: Record<string, string | null>
): string {
  const control = hermanas.find((l) => controlPorCodigo[l.code]);
  return control?.descripcion?.trim() || "";
}

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

export interface LibroMayorOptions {
  /** code → cuenta_control ('clientes' | 'proveedores' | null). */
  controlPorCodigo?: Record<string, string | null>;
}

/**
 * Arma el mayor de UNA cuenta.
 *
 * Los movimientos deben venir ya filtrados por cuenta y por rango de fechas, y
 * ordenados. El orden lo define la fuente, no este módulo — pero se reordena
 * igual por (fecha, número de asiento, orden de línea) para que el saldo
 * corrido sea determinístico aunque la consulta cambie de ORDER BY.
 */
export function buildMayorDeCuenta(
  cuenta: CuentaDelMayor,
  movimientos: MovimientoCrudo[],
  options: LibroMayorOptions = {}
): MayorDeCuenta {
  const control = options.controlPorCodigo ?? {};

  const ordenados = [...movimientos].sort(
    (a, b) =>
      a.transaction_date.localeCompare(b.transaction_date) ||
      a.entry_number - b.entry_number ||
      a.line_order - b.line_order
  );

  const filas: FilaMayor[] = [];

  // Fila de saldo inicial. Se muestra SIEMPRE, aunque sea 0: es la que explica
  // de dónde arranca el saldo corrido, y su ausencia haría parecer que la
  // cuenta abrió en cero cuando quizá abrió sin cargar.
  filas.push({
    kind: "saldo-inicial",
    cuentaDistribucion: `${cuenta.code} ${cuenta.name}`,
    fecha: cuenta.saldo_inicial_fecha,
    tipoTransaccion: "",
    numero: "",
    nombre: "",
    descripcion: "Saldo inicial",
    contrapartida: "",
    contrapartidaAmbigua: false,
    importe: 0,
    saldo: round2(cuenta.saldo_inicial),
    entryId: null,
    sourceType: null,
    sourceId: null,
  });

  let saldo = round2(cuenta.saldo_inicial);

  for (const m of ordenados) {
    saldo = round2(saldo + efectoEnSaldo(m));

    // La línea propia dentro del asiento, identificada por posición: un asiento
    // puede tocar la misma cuenta dos veces y son renglones distintos.
    const propia =
      m.hermanas.find((h) => h.line_order === m.line_order) ?? m.hermanas[0];

    const nombre = nombreDelTercero(m.hermanas, control);
    const propiaDescripcion = m.line_description?.trim() || "";

    // Si la línea que se está mostrando ES la de la cuenta control, su
    // descripción y el nombre del tercero son el MISMO texto — y repetirlo en
    // dos columnas contiguas no informa, solo ensucia. En ese caso la columna
    // Descripción cae a la naturaleza del asiento, que sí agrega algo.
    const descripcion =
      propiaDescripcion && propiaDescripcion !== nombre
        ? propiaDescripcion
        : m.entry_description;

    filas.push({
      kind: "movimiento",
      cuentaDistribucion: `${cuenta.code} ${cuenta.name}`,
      fecha: m.transaction_date,
      tipoTransaccion: tipoTransaccionLabel(m.source_type),
      numero: String(m.entry_number),
      nombre,
      descripcion,
      contrapartida: contrapartidaDe(propia, m.hermanas),
      contrapartidaAmbigua: contrapartidaEsAmbigua(propia, m.hermanas),
      importe: importeDeLinea(m),
      saldo,
      entryId: m.entry_id,
      sourceType: m.source_type,
      sourceId: m.source_id,
    });
  }

  return {
    cuenta,
    filas,
    totales: totalesDePie(cuenta.saldo_inicial, ordenados),
    cantidadMovimientos: ordenados.length,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

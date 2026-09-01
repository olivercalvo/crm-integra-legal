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
 * DE LAS TRES CONSULTAS ABIERTAS, DOS QUEDARON RESUELTAS (01/09/2026)
 * ═════════════════════════════════════════════════════════════════════════════
 * Josuarth mandó su formato el 26/08 (`Temas Contables/image001.png`), y ese
 * modelo contesta dos de las tres preguntas que este módulo tenía aisladas:
 *
 *   consulta 4 → `totalesDePie()`      ✅ el pie es el NETO de movimientos
 *   consulta 5 → `importeDeLinea()`    ✅ UNA columna Importe, con signo
 *   consulta 3 → `contrapartidaDe()`   ⏳ sigue abierta (contrapartida ambigua)
 *
 * Las dos resueltas ya estaban implementadas así, porque era lo que su modelo
 * dejaba entrever. Lo que cambió es que dejaron de ser una apuesta: hay un
 * documento que las respalda. Se mantienen en funciones propias igual — no por
 * indecisión, sino porque son criterios de presentación y el próximo cliente
 * puede querer otro.
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
  /**
   * Saldo con el que ARRANCA la fila "Saldo inicial" del mayor.
   *
   * Sin filtro de fechas es igual a `saldo_inicial`. CON filtro desde una fecha,
   * es `saldo_inicial + Σ movimientos anteriores a esa fecha`: si el contador
   * pide el mayor desde junio, la cuenta no arranca en su saldo de apertura de
   * enero — arranca donde la dejó mayo.
   *
   * Hasta el 01/09/2026 el mayor mostraba siempre el de apertura, así que
   * cualquier rango que no empezara en el inicio del ejercicio daba un saldo
   * corrido corrido de lugar. Opcional para no romper a quien construya la
   * cuenta a mano (los tests): si falta, se usa `saldo_inicial`.
   */
  saldo_arranque?: number;
  /** Fecha efectiva del arranque: el `desde` del filtro, o la de apertura. */
  arranque_fecha?: string | null;
  /** true si hubo movimientos previos sumados — la UI lo rotula distinto. */
  arranque_ajustado?: boolean;
}

// ---------------------------------------------------------------------------
// CONSULTA 5 — RESUELTA (formato de Josuarth, 26/08/2026)
// Una sola columna "Importe" con signo. Negativo = crédito.
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
 * SE IMPLEMENTA `débito − crédito` SIEMPRE, en convención de balanza. Un pasivo
 * que crece se ve negativo, igual que en el Balance General de este sistema.
 *
 * Queda un matiz que su modelo no muestra, porque todos sus ejemplos son cuentas
 * de activo: si prefiere que en pasivo, patrimonio e ingreso el importe se
 * presente `crédito − débito` —para que "la cuenta crece" se lea siempre en
 * positivo— se cambia SOLO esta función. No se pregunta como consulta bloqueante
 * porque mezclar dos convenciones entre reportes que se leen juntos sería peor
 * que sostener la que ya usa el resto del sistema.
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
// CONSULTA 4 — RESUELTA (formato de Josuarth, 26/08/2026)
// El pie es el NETO de movimientos del período. El saldo final NO va ahí: se
// lee en la última fila de la columna Saldo, como en su modelo.
// ---------------------------------------------------------------------------

export interface TotalesPie {
  /** Suma de los movimientos del período. NO incluye el saldo inicial.
   *  Es EL número del recuadro del pie en el modelo de Josuarth. */
  netoDelPeriodo: number;
  /** Arranque + movimientos. NO se muestra en el pie: se lee en la última fila
   *  de la columna Saldo. Se calcula para poder verificar que cierren. */
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
 * La tabla muestra en el recuadro del pie SOLO el neto, como él. `saldoFinal`
 * se sigue calculando y se sigue exportando: es la comprobación aritmética de la
 * última fila de la columna Saldo (arranque + neto tiene que dar esa fila), y
 * los tests lo usan como tal. Que se calcule no significa que se muestre.
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

  // De dónde arranca el saldo corrido. Con filtro de fechas NO es el saldo de
  // apertura: es el saldo al día anterior al `desde`. Ver `CuentaDelMayor`.
  const saldoArranque = cuenta.saldo_arranque ?? cuenta.saldo_inicial;

  // Fila de saldo inicial. Se muestra SIEMPRE, aunque sea 0: es la que explica
  // de dónde arranca el saldo corrido, y su ausencia haría parecer que la
  // cuenta abrió en cero cuando quizá abrió sin cargar.
  filas.push({
    kind: "saldo-inicial",
    cuentaDistribucion: `${cuenta.code} ${cuenta.name}`,
    fecha: cuenta.arranque_fecha ?? cuenta.saldo_inicial_fecha,
    tipoTransaccion: "",
    numero: "",
    nombre: "",
    descripcion: "Saldo inicial",
    contrapartida: "",
    contrapartidaAmbigua: false,
    importe: 0,
    saldo: round2(saldoArranque),
    entryId: null,
    sourceType: null,
    sourceId: null,
  });

  let saldo = round2(saldoArranque);

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
    totales: totalesDePie(saldoArranque, ordenados),
    cantidadMovimientos: ordenados.length,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

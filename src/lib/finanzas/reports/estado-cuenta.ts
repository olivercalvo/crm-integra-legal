/**
 * ESTADO DE CUENTA por tercero — cliente o proveedor.
 *
 * Es el mismo concepto que el Libro Mayor pero por TERCERO en vez de por cuenta:
 * saldo inicial, movimientos con fecha, descripción, débito, crédito y saldo
 * corrido, y saldo final. Por eso se ve igual, usa el mismo vocabulario y los
 * mismos enlaces al documento — es el mismo reporte mirado por otro eje.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL SALDO INICIAL ES CERO, Y ES CORRECTO
 * ─────────────────────────────────────────────────────────────────────────────
 * A diferencia del mayor, acá no hay saldo de apertura POR TERCERO: el que vino
 * de QuickBooks está en la cuenta control, sin repartir entre clientes. Así que
 * el estado de cuenta arranca en cero y muestra solo lo que el sistema registró.
 *
 * No es un cero de "no hay nada": es un cero de "acá empieza lo que sabemos". La
 * pantalla lo dice, porque un contador que ve un estado de cuenta que arranca en
 * cero necesita saber si es porque el cliente no debía nada o porque el dato no
 * está.
 *
 * Módulo PURO: sin I/O.
 */

const EPSILON = 0.005;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Un movimiento del tercero, antes de calcular el saldo corrido. */
export interface MovimientoTercero {
  fecha: string;
  /** "Factura", "Cobro", "Gasto", "Pago" — el mismo vocabulario del mayor. */
  tipo: string;
  /** Número de factura o descripción del documento. */
  documento: string;
  descripcion: string;
  /** Lo que AUMENTA la deuda del tercero con nosotros (o la nuestra con él). */
  debito: number;
  /** Lo que la DISMINUYE. */
  credito: number;
  /** Para el enlace. */
  documentoId: string | null;
  sourceType: string | null;
}

export interface FilaEstadoCuenta extends MovimientoTercero {
  /** Saldo acumulado después de este movimiento. */
  saldo: number;
}

export interface EstadoCuenta {
  tercero: string;
  terceroId: string | null;
  /** Siempre 0 hoy: la apertura no está repartida por tercero. */
  saldoInicial: number;
  filas: FilaEstadoCuenta[];
  totalDebito: number;
  totalCredito: number;
  saldoFinal: number;
}

/**
 * Arma el estado de cuenta con el saldo corrido.
 *
 * Los movimientos llegan ordenados por fecha; dentro del mismo día, el orden es
 * el que trae la fuente (documento antes que su cobro, que es como ocurrió).
 */
export function buildEstadoCuenta(
  tercero: string,
  terceroId: string | null,
  movimientos: MovimientoTercero[],
  saldoInicial = 0
): EstadoCuenta {
  let saldo = round2(saldoInicial);
  const filas: FilaEstadoCuenta[] = movimientos.map((m) => {
    saldo = round2(saldo + m.debito - m.credito);
    return { ...m, saldo };
  });

  return {
    tercero,
    terceroId,
    saldoInicial: round2(saldoInicial),
    filas,
    totalDebito: round2(movimientos.reduce((s, m) => s + m.debito, 0)),
    totalCredito: round2(movimientos.reduce((s, m) => s + m.credito, 0)),
    saldoFinal: saldo,
  };
}

/** ¿El saldo final cuadra con lo que suman los movimientos? */
export function cuadra(ec: EstadoCuenta): boolean {
  const esperado = round2(ec.saldoInicial + ec.totalDebito - ec.totalCredito);
  return Math.abs(ec.saldoFinal - esperado) < EPSILON;
}

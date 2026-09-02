/**
 * BALANCE DE COMPROBACIÓN — el reporte puente.
 *
 * En QuickBooks lo conocen como "Balance de sumas y saldos", y así se rotula en
 * pantalla para que se reconozca sin preguntarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES "EL PUENTE"
 * ─────────────────────────────────────────────────────────────────────────────
 * Una fila por cuenta con saldo inicial, débitos, créditos y saldo final. Es el
 * reporte donde un contador verifica que la contabilidad cierra ANTES de mirar
 * los estados financieros: si acá no cuadra, el Balance General y el Estado de
 * Resultado están construidos sobre algo roto.
 *
 * Y de ahí sale su exigencia: **sus saldos finales tienen que ser los mismos que
 * muestran esos dos reportes, cuenta por cuenta**. Eso no se logra comparando
 * después, se logra no teniendo dos fuentes: este builder recibe los MISMOS
 * `ReportAccount` que `buildAccountingReports`, del mismo `loadReportAccounts`.
 * No es que coincidan; es que es el mismo número.
 *
 * Módulo PURO: sin I/O. Recibe cuentas y devuelve filas y totales.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA CONVENCIÓN DE SIGNOS
 * ─────────────────────────────────────────────────────────────────────────────
 * `saldoInicial` y `saldoFinal` van en convención de BALANZA, igual que el
 * Balance General: débito positivo, crédito negativo. Un pasivo con saldo se ve
 * negativo, y está bien.
 *
 * `debitos` y `creditos` son SUMAS de columna, siempre positivas: son lo que se
 * movió de cada lado, no un saldo.
 */

import type { ReportAccount } from "@/lib/finanzas/reports/accounting-reports";

const EPSILON = 0.005;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface FilaComprobacion {
  code: string;
  name: string;
  /** Saldo de apertura, en convención de balanza. */
  saldoInicial: number;
  /** Σ de la columna débito del período. Siempre ≥ 0. */
  debitos: number;
  /** Σ de la columna crédito del período. Siempre ≥ 0. */
  creditos: number;
  /** `saldoInicial + debitos − creditos`. El MISMO que muestran los estados. */
  saldoFinal: number;
  /** true si la cuenta está desactivada pero tiene movimientos. */
  inactivaConMovimiento: boolean;
}

export interface TotalesComprobacion {
  /** Σ de los saldos iniciales. En una contabilidad sana da 0. */
  saldoInicial: number;
  debitos: number;
  creditos: number;
  saldoFinal: number;
  /**
   * `debitos − creditos`. **Cero es lo único aceptable**: cada asiento tiene la
   * misma plata de los dos lados, así que la suma de todas las columnas tiene
   * que empatar. Distinto de cero significa que hay un asiento descuadrado en la
   * base, y el reporte lo dice en pantalla en vez de esconderlo.
   */
  diferencia: number;
  cuadra: boolean;
}

export interface BalanceComprobacion {
  filas: FilaComprobacion[];
  totales: TotalesComprobacion;
  /** Cuántas cuentas quedaron con todo en cero (el filtro las esconde). */
  cuentasEnCero: number;
}

/**
 * Arma el Balance de Comprobación a partir de las mismas cuentas que alimentan
 * el Balance General y el Estado de Resultado.
 *
 * Las cuentas llegan ya ordenadas por código desde `loadReportAccounts`; el
 * orden se respeta porque es el del plan de cuentas, que es como el contador lo
 * lee.
 */
export function buildBalanceComprobacion(accounts: ReportAccount[]): BalanceComprobacion {
  const filas: FilaComprobacion[] = accounts.map((a) => {
    const saldoInicial = round2(a.saldoInicial ?? 0);
    const debitos = round2(a.debitos ?? 0);
    const creditos = round2(a.creditos ?? 0);
    return {
      code: a.code,
      name: a.name,
      saldoInicial,
      debitos,
      creditos,
      // Se usa `a.saldo` y NO se recalcula: es el número que muestran los otros
      // dos reportes. Recalcularlo acá abriría la puerta a que difieran.
      saldoFinal: round2(a.saldo),
      inactivaConMovimiento: a.inactivaConMovimiento === true,
    };
  });

  const suma = (f: (x: FilaComprobacion) => number) => round2(filas.reduce((s, x) => s + f(x), 0));
  const debitos = suma((x) => x.debitos);
  const creditos = suma((x) => x.creditos);
  const diferencia = round2(debitos - creditos);

  return {
    filas,
    totales: {
      saldoInicial: suma((x) => x.saldoInicial),
      debitos,
      creditos,
      saldoFinal: suma((x) => x.saldoFinal),
      diferencia,
      cuadra: Math.abs(diferencia) < EPSILON,
    },
    cuentasEnCero: filas.filter((f) => !tieneAlgo(f)).length,
  };
}

/** ¿La fila tiene algo que mostrar? Todo en cero = la esconde el filtro. */
export function tieneAlgo(f: FilaComprobacion): boolean {
  return (
    Math.abs(f.saldoInicial) >= EPSILON ||
    Math.abs(f.debitos) >= EPSILON ||
    Math.abs(f.creditos) >= EPSILON ||
    Math.abs(f.saldoFinal) >= EPSILON
  );
}

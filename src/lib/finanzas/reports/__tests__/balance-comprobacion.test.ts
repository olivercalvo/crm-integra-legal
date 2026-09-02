/**
 * Tests del Balance de Comprobación — el reporte puente.
 *
 * Lo que se verifica no es que "funcione": es que **sus saldos finales sean los
 * mismos que los del Balance General y el Estado de Resultado, cuenta por
 * cuenta**. Si un solo número difiere, hay dos fuentes donde debería haber una.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAccountingReports,
  type ReportAccount,
} from "@/lib/finanzas/reports/accounting-reports";
import { buildBalanceComprobacion } from "@/lib/finanzas/reports/balance-comprobacion";
import { buildEstadoResultadoNiif18 } from "@/lib/finanzas/reports/estado-resultado-niif18";
import { JOSUAR_ACCOUNTS } from "./josuar-accounts.fixture";

const EPSILON = 0.005;

/** Los movimientos que hay sembrados en staging, por código. */
const MOVIMIENTOS: Record<string, { d: number; c: number }> = {
  "100001": { d: 2070, c: 0 },
  "100004": { d: 4965, c: 2070 },
  "130003": { d: 0, c: 150 },
  "200001": { d: 0, c: 3594.25 },
  "200003": { d: 0, c: 315 },
  "400001": { d: 0, c: 2500 },
  "400006": { d: 0, c: 2000 },
  "500003": { d: 325.5, c: 0 },
  "500005": { d: 470, c: 150 },
  "610001": { d: 1850, c: 0 },
  "610002": { d: 700, c: 0 },
  "610008": { d: 152.35, c: 0 },
  "610009": { d: 246.4, c: 0 },
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Cuentas como las entrega `loadReportAccounts` con el ledger sembrado. */
function conMovimientos(): ReportAccount[] {
  return JOSUAR_ACCOUNTS.map((a) => {
    const m = MOVIMIENTOS[a.code] ?? { d: 0, c: 0 };
    const neto = round2(m.d - m.c);
    return {
      ...a,
      saldo: round2(a.saldo + neto),
      saldoInicial: a.saldo,
      movimientoLedger: neto,
      debitos: m.d,
      creditos: m.c,
    };
  });
}

function sinLedger(): ReportAccount[] {
  return JOSUAR_ACCOUNTS.map((a) => ({
    ...a,
    saldoInicial: a.saldo,
    movimientoLedger: 0,
    debitos: 0,
    creditos: 0,
  }));
}

// ---------------------------------------------------------------------------
// 1. CUADRA
// ---------------------------------------------------------------------------

test("los débitos igualan a los créditos", () => {
  const r = buildBalanceComprobacion(conMovimientos());
  assert.ok(
    Math.abs(r.totales.diferencia) < EPSILON,
    `débitos ${r.totales.debitos} vs créditos ${r.totales.creditos}, diferencia ${r.totales.diferencia}`
  );
  assert.ok(r.totales.cuadra);
});

test("si un asiento estuviera descuadrado, el reporte NO lo esconde", () => {
  // Se rompe a mano el equilibrio: un débito de más sin su crédito.
  const rotas = conMovimientos().map((c) =>
    c.code === "100001" ? { ...c, debitos: (c.debitos ?? 0) + 500 } : c
  );
  const r = buildBalanceComprobacion(rotas);

  assert.ok(!r.totales.cuadra, "tiene que reportar que no cuadra");
  assert.ok(
    Math.abs(r.totales.diferencia - 500) < EPSILON,
    `la diferencia tiene que ser el monto exacto: ${r.totales.diferencia}`
  );
});

// ---------------------------------------------------------------------------
// 2. EL PUENTE — la razón de ser de este reporte
// ---------------------------------------------------------------------------

test("PUENTE: el saldo final coincide cuenta por cuenta con el Balance General", () => {
  const cuentas = conMovimientos();
  const comp = buildBalanceComprobacion(cuentas);
  const { balanceGeneral: bg } = buildAccountingReports(cuentas);

  // Todos los renglones de cuenta que muestra el Balance General.
  const delBalance = new Map<string, number>();
  for (const seccion of [bg.activos, bg.pasivos, bg.patrimonio]) {
    for (const g of seccion.groups) {
      for (const fila of g.rows) delBalance.set(fila.code, fila.amount);
    }
  }

  const diferencias: string[] = [];
  for (const f of comp.filas) {
    const enBalance = delBalance.get(f.code);
    if (enBalance === undefined) continue; // es de resultado, va en el ER
    if (Math.abs(f.saldoFinal - enBalance) >= EPSILON) {
      diferencias.push(`${f.code} ${f.name}: comprobación ${f.saldoFinal} ≠ balance ${enBalance}`);
    }
  }

  assert.deepEqual(diferencias, [], `\n${diferencias.join("\n")}\n`);
  assert.ok(delBalance.size > 10, "el Balance tiene que haber traído cuentas");
});

test("PUENTE: el saldo final coincide cuenta por cuenta con el Estado de Resultado", () => {
  const cuentas = conMovimientos();
  const comp = buildBalanceComprobacion(cuentas);
  const er = buildEstadoResultadoNiif18(cuentas);

  // El ER presenta con signo invertido (`entreParentesis`), pero `balanza`
  // conserva el saldo original: es el que tiene que coincidir.
  const delER = new Map<string, number>();
  for (const fila of er.filas) {
    if (fila.kind === "cuenta" && !fila.estructural) delER.set(fila.code, fila.valor.balanza);
  }

  const diferencias: string[] = [];
  for (const f of comp.filas) {
    const enER = delER.get(f.code);
    if (enER === undefined) continue;
    if (Math.abs(f.saldoFinal - enER) >= EPSILON) {
      diferencias.push(`${f.code} ${f.name}: comprobación ${f.saldoFinal} ≠ ER ${enER}`);
    }
  }

  assert.deepEqual(diferencias, [], `\n${diferencias.join("\n")}\n`);
  assert.ok(delER.size > 10, "el ER tiene que haber traído cuentas");
});

test("TODAS las cuentas del plan aparecen: ninguna se pierde entre los reportes", () => {
  const cuentas = conMovimientos();
  const comp = buildBalanceComprobacion(cuentas);
  assert.equal(comp.filas.length, cuentas.length);
});

// ---------------------------------------------------------------------------
// 3. LA ARITMÉTICA DE CADA FILA
// ---------------------------------------------------------------------------

test("saldo final = saldo inicial + débitos − créditos, en cada fila", () => {
  const malas: string[] = [];
  for (const f of buildBalanceComprobacion(conMovimientos()).filas) {
    const esperado = round2(f.saldoInicial + f.debitos - f.creditos);
    if (Math.abs(f.saldoFinal - esperado) >= EPSILON) {
      malas.push(`${f.code}: ${f.saldoFinal} ≠ ${esperado}`);
    }
  }
  assert.deepEqual(malas, [], `\n${malas.join("\n")}\n`);
});

test("los números de las dos cuentas que Josuarth va a mirar", () => {
  const filas = buildBalanceComprobacion(conMovimientos()).filas;
  const cxc = filas.find((f) => f.code === "100004")!;

  assert.ok(Math.abs(cxc.saldoInicial - 191947.55) < EPSILON, "inicial");
  assert.ok(Math.abs(cxc.debitos - 4965) < EPSILON, "débitos");
  assert.ok(Math.abs(cxc.creditos - 2070) < EPSILON, "créditos");
  assert.ok(Math.abs(cxc.saldoFinal - 194842.55) < EPSILON, "saldo final = el del mayor");
});

// ---------------------------------------------------------------------------
// 4. CON EL LEDGER VACÍO — el estado al que se puede volver
// ---------------------------------------------------------------------------

test("ledger VACÍO: el reporte se ve coherente y cuadra", () => {
  const r = buildBalanceComprobacion(sinLedger());

  assert.ok(r.totales.cuadra, "sin movimientos, débitos y créditos son 0 y 0");
  assert.equal(r.totales.debitos, 0);
  assert.equal(r.totales.creditos, 0);
  assert.equal(r.filas.length, JOSUAR_ACCOUNTS.length, "las cuentas siguen estando");

  // Y el saldo final es el de apertura, que es lo correcto sin movimientos.
  for (const f of r.filas) {
    assert.ok(Math.abs(f.saldoFinal - f.saldoInicial) < EPSILON, `${f.code} se movió sin asientos`);
  }
});

test("las cuentas en cero se cuentan para poder esconderlas", () => {
  const r = buildBalanceComprobacion(conMovimientos());
  assert.ok(r.cuentasEnCero > 10, `esperaba varias en cero, hay ${r.cuentasEnCero}`);
  // Y las que se esconden no aportan a ningún total.
  const visibles = r.filas.filter(
    (f) => Math.abs(f.saldoInicial) + Math.abs(f.debitos) + Math.abs(f.creditos) + Math.abs(f.saldoFinal) >= EPSILON
  );
  const sumaVisibles = round2(visibles.reduce((s, f) => s + f.debitos, 0));
  assert.ok(Math.abs(sumaVisibles - r.totales.debitos) < EPSILON, "esconder no puede mover el total");
});

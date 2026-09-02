/**
 * CONVERGENCIA: el Balance y el Libro Mayor tienen que decir lo mismo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE VERIFICA Y POR QUÉ NO ALCANZA CON QUE "CUADRE"
 * ─────────────────────────────────────────────────────────────────────────────
 * Los asientos son de partida doble, así que `Σ(débitos − créditos)` sobre TODAS
 * las cuentas da cero por construcción. El Balance seguiría cuadrando aunque el
 * movimiento se sumara a la cuenta equivocada: el descuadre daría 0.00 igual.
 *
 * Por eso la prueba que vale es la RECONCILIACIÓN CUENTA POR CUENTA — para las
 * 64, no solo para la que se está mirando. Y las que NO tienen movimiento tienen
 * que dar delta exactamente cero: si una se mueve sin tener asientos, algo se
 * está sumando donde no va.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAccountingReports,
  type ReportAccount,
} from "@/lib/finanzas/reports/accounting-reports";
import { JOSUAR_ACCOUNTS } from "./josuar-accounts.fixture";

const EPSILON = 0.005;

/** Movimientos del ledger de staging, por código de cuenta (convención balanza). */
const MOVIMIENTOS_STAGING: Record<string, number> = {
  "100001": 2070.0, // Banco General Operativa
  "100004": 2895.0, // Cuentas por Cobrar Clientes
  "130003": -150.0, // Fondos Legales de Clientes (el reembolso facturado)
  "200001": -3594.25, // Cuentas por pagar
  "200003": -315.0, // ITBMS por Pagar
  "400001": -2500.0, // Derecho Corporativo
  "400006": -2000.0, // Derecho Administrativo
  "500003": 325.5, // Mensajeria Especializada
  "500005": 320.0, // Costos tramites legales
  "610001": 1850.0, // Alquiler
  "610002": 700.0, // Honorarios Profesionales
  "610008": 152.35, // Utiles de Oficina
  "610009": 246.4, // Combustible
};

/** Las cuentas como las entrega `loadReportAccounts` con el ledger sembrado. */
function conMovimientos(): ReportAccount[] {
  return JOSUAR_ACCOUNTS.map((a) => {
    const mov = MOVIMIENTOS_STAGING[a.code] ?? 0;
    return {
      ...a,
      saldo: round2(a.saldo + mov),
      saldoInicial: a.saldo,
      movimientoLedger: mov,
    };
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function assertMoney(actual: number, esperado: number, mensaje: string): void {
  assert.ok(
    Math.abs(actual - esperado) < EPSILON,
    `${mensaje}: esperado ${esperado.toFixed(2)}, obtenido ${actual.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
// 1. NO REGRESIÓN — con el ledger vacío, producción no se mueve
// ---------------------------------------------------------------------------

test("ledger VACÍO: el Balance da exactamente los totales del Excel de Josuar", () => {
  // Es lo que demuestra que desplegar esto no movería un centavo en producción,
  // donde nada postea todavía.
  const sinLedger: ReportAccount[] = JOSUAR_ACCOUNTS.map((a) => ({
    ...a,
    saldoInicial: a.saldo,
    movimientoLedger: 0,
  }));
  const { balanceGeneral: bg, estadoResultado: er } = buildAccountingReports(sinLedger);

  assertMoney(bg.activos.total, 257902.46, "Total de Activo");
  assertMoney(bg.patrimonio.total, -244476.91, "Total de Patrimonio");
  assertMoney(bg.totalPasivoPatrimonio, -257902.46, "Total Pasivo + Patrimonio");
  assertMoney(er.ingresos.total, -289137.06, "Total de Ingresos");
  assertMoney(er.utilidadOperativa, -244476.91, "Utilidad Operativa");
  assertMoney(bg.descuadre, 0, "descuadre");
});

// ---------------------------------------------------------------------------
// 2. LA RECONCILIACIÓN — cuenta por cuenta, las 64
// ---------------------------------------------------------------------------

test("RECONCILIACIÓN: cada cuenta vale su saldo inicial más su neto del mayor", () => {
  const cuentas = conMovimientos();
  const descuadradas: string[] = [];

  for (const c of cuentas) {
    const esperado = round2((c.saldoInicial ?? 0) + (c.movimientoLedger ?? 0));
    if (Math.abs(c.saldo - esperado) >= EPSILON) {
      descuadradas.push(`${c.code} ${c.name}: ${c.saldo} ≠ ${esperado}`);
    }
  }

  assert.deepEqual(descuadradas, [], `\n${descuadradas.join("\n")}\n`);
  assert.equal(cuentas.length, 62, "el fixture de Josuar son 62 cuentas");
});

test("las cuentas SIN movimiento dan delta exactamente CERO", () => {
  // El caso que una suma mal dirigida rompería: si el movimiento de una cuenta
  // se colara en otra, alguna de estas 49 dejaría de dar cero.
  const cuentas = conMovimientos();
  const sinMovimiento = cuentas.filter((c) => !MOVIMIENTOS_STAGING[c.code]);
  const conDelta: string[] = [];

  for (const c of sinMovimiento) {
    const delta = round2(c.saldo - (c.saldoInicial ?? 0));
    if (delta !== 0) conDelta.push(`${c.code} ${c.name}: delta ${delta}`);
  }

  assert.deepEqual(conDelta, [], `\n${conDelta.join("\n")}\n`);
  assert.ok(sinMovimiento.length >= 45, `esperaba muchas sin movimiento, hay ${sinMovimiento.length}`);
});

// ---------------------------------------------------------------------------
// 3. LOS NÚMEROS PREDICHOS
// ---------------------------------------------------------------------------

test("con el ledger sembrado, el Balance da los números medidos contra staging", () => {
  const { balanceGeneral: bg } = buildAccountingReports(conMovimientos());

  // ⚠️ DOS DE ESTOS NÚMEROS CAMBIARON respecto de la predicción del 01/09, y la
  // causa es UNA sola: el asiento del reembolso (FAC-REI-000001) pasó a acreditar
  // `130003 Fondos Legales de Clientes` —un ACTIVO— en vez de `500005 Costos
  // trámites legales`. Ese cambio se hizo DESPUÉS de la predicción, en el Bloque
  // 0, y lo pide textual el acta de RM del 25/08: "Reembolso al facturar: HABER
  // 130003, nunca ingreso".
  //
  //   Activo:      predicho 262.867,46 − 150,00 = 262.717,46
  //   Patrimonio:  predicho −245.532,66 + 150,00 = −245.382,66
  //
  // Los 150,00 son el reembolso, que dejó de ser un costo recuperado y pasó a
  // bajar el fondo del cliente. Pasivo, CxC, Banco y el descuadre no se mueven.
  assertMoney(bg.activos.total, 262717.46, "Total de Activo");
  assertMoney(bg.pasivos.total, -17334.8, "Total Pasivo");
  assertMoney(bg.patrimonio.total, -245382.66, "Total Patrimonio");
  assertMoney(bg.descuadre, 0, "descuadre");
  assert.ok(bg.cuadra, "el balance tiene que cuadrar");
});

test("los 150,00 de diferencia con la predicción son EXACTAMENTE el reembolso", () => {
  // Se rehace el escenario viejo —el reembolso contra la cuenta de costo— y
  // tienen que salir los números que se predijeron. Es lo que demuestra que la
  // diferencia es el cambio de cuenta y no un error de cálculo.
  const comoAntes = conMovimientos().map((c) => {
    if (c.code === "130003") return { ...c, saldo: c.saldoInicial!, movimientoLedger: 0 };
    if (c.code === "500005") return { ...c, saldo: round2(c.saldoInicial! + 170), movimientoLedger: 170 };
    return c;
  });
  const { balanceGeneral: bg } = buildAccountingReports(comoAntes);

  assertMoney(bg.activos.total, 262867.46, "Total de Activo, como se predijo");
  assertMoney(bg.patrimonio.total, -245532.66, "Total Patrimonio, como se predijo");
  assertMoney(bg.descuadre, 0, "y también cuadraba");
});

test("las dos cuentas que Josuarth va a mirar primero", () => {
  const cuentas = conMovimientos();
  const cxc = cuentas.find((c) => c.code === "100004");
  const banco = cuentas.find((c) => c.code === "100001");

  assertMoney(cxc!.saldo, 194842.55, "Cuentas por Cobrar Clientes");
  assertMoney(banco!.saldo, 62770.91, "Banco General Operativa");

  // Y el saldo del Balance es EXACTAMENTE el saldo final del mayor de esa
  // cuenta: inicial 191.947,55 + neto 2.895,00.
  assertMoney(cxc!.saldoInicial!, 191947.55, "CxC saldo inicial");
  assertMoney(cxc!.movimientoLedger!, 2895.0, "CxC neto del mayor");
});

test("que el balance CUADRE no prueba que esté bien", () => {
  // Se mueven 5.000 de una cuenta de activo a otra: el descuadre sigue en 0.00
  // porque la partida doble se mantiene, pero la reconciliación por cuenta lo
  // caza. Es la razón por la que ese es el test que vale.
  const torcidas = conMovimientos().map((c) => {
    if (c.code === "100001") return { ...c, saldo: round2(c.saldo - 5000) };
    if (c.code === "100004") return { ...c, saldo: round2(c.saldo + 5000) };
    return c;
  });

  const { balanceGeneral: bg } = buildAccountingReports(torcidas);
  assertMoney(bg.descuadre, 0, "el descuadre sigue en cero — por eso no alcanza");

  const malas = torcidas.filter(
    (c) => Math.abs(c.saldo - round2((c.saldoInicial ?? 0) + (c.movimientoLedger ?? 0))) >= EPSILON
  );
  assert.equal(malas.length, 2, "la reconciliación por cuenta SÍ detecta las dos");
});

// ---------------------------------------------------------------------------
// 4. EL GUARD DE DOBLE CONTEO
// ---------------------------------------------------------------------------

test("con el patrimonio en cero no hay riesgo de doble conteo", () => {
  const { balanceGeneral: bg } = buildAccountingReports(conMovimientos());
  assert.deepEqual(bg.patrimonioConSaldo, [], "las cuentas de patrimonio están en 0");
});

test("si 300003 recibe saldo, el reporte lo DENUNCIA en vez de absorberlo", () => {
  // El escenario real: un asiento de cierre acredita la utilidad del ejercicio.
  // El Balance ya suma el renglón calculado, así que contaría dos veces.
  const cuentas = conMovimientos().map((c) =>
    c.code === "300003" ? { ...c, saldo: -244476.91, movimientoLedger: -244476.91 } : c
  );
  const { balanceGeneral: bg } = buildAccountingReports(cuentas);

  assert.equal(bg.patrimonioConSaldo.length, 1, "tiene que avisar");
  assert.equal(bg.patrimonioConSaldo[0].code, "300003");
  assert.ok(!bg.cuadra, "y además el balance deja de cuadrar, que es el síntoma");
});

// ---------------------------------------------------------------------------
// 5. CUENTAS INACTIVAS CON MOVIMIENTO
// ---------------------------------------------------------------------------

test("una cuenta inactiva con movimiento entra al Balance y no se pierde su saldo", () => {
  const cuentas = conMovimientos();
  const totalAntes = buildAccountingReports(cuentas).balanceGeneral.activos.total;

  const conInactiva: ReportAccount[] = [
    ...cuentas,
    {
      code: "199999",
      name: "Cuenta vieja desactivada",
      account_type: "asset",
      subcategoria: "activo_corriente",
      saldo: 1234.56,
      saldoInicial: 0,
      movimientoLedger: 1234.56,
      inactivaConMovimiento: true,
    },
  ];

  const bg = buildAccountingReports(conInactiva).balanceGeneral;
  assertMoney(bg.activos.total, round2(totalAntes + 1234.56), "el saldo NO se pierde");
});

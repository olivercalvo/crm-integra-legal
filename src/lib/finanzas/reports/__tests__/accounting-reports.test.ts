/**
 * Tests del armado PURO del Balance General y el Estado de Resultado (Paso 2).
 *
 * El bloque principal usa las 62 cuentas REALES de Josuar como fixture y
 * compara contra los totales de SU Excel. Es la prueba que importa: si el
 * agrupamiento, los signos o los filtros se rompen, estos números dejan de dar.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/reports/__tests__/accounting-reports.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEstadoResultado,
  buildBalanceGeneral,
  buildAccountingReports,
  DEFAULT_ISR_RATE,
  type ReportAccount,
} from "@/lib/finanzas/reports/accounting-reports";
import { JOSUAR_ACCOUNTS } from "./josuar-accounts.fixture";

/** Compara montos en B/. con tolerancia de medio centavo. */
function assertMoney(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 0.005,
    `${message}: esperado ${expected}, obtenido ${actual}`
  );
}

// ===========================================================================
// 1) Totales contra el Excel de Josuar (62 cuentas reales)
// ===========================================================================

test("fixture: son las 62 cuentas activas del plan de Josuar", () => {
  assert.equal(JOSUAR_ACCOUNTS.length, 62);
});

test("Estado de Resultado: los 5 totales coinciden con el Excel de Josuar", () => {
  const er = buildEstadoResultado(JOSUAR_ACCOUNTS);

  assertMoney(er.ingresos.total, -289137.06, "Total de Ingresos");
  assertMoney(er.costos.total, 9878.38, "Total de Costos");
  assertMoney(er.gananciaBruta, -279258.68, "Ganancia o Pérdida Bruta");
  assertMoney(er.gastos.total, 34781.77, "Total de Gastos");
  assertMoney(er.utilidadOperativa, -244476.91, "Utilidad Operativa");
});

test("Balance General: los 5 totales coinciden con el Excel de Josuar", () => {
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);

  const corrientes = bg.activos.groups.find((g) => g.label === "Activos corrientes");
  assert.ok(corrientes, "debe existir el grupo Activos corrientes");
  assertMoney(corrientes.subtotal, 252967.57, "Total Activos corrientes");

  assertMoney(bg.activos.total, 257902.46, "Total de Activo");
  assertMoney(bg.pasivos.total, -13425.55, "Total de Pasivos");
  assertMoney(bg.patrimonio.total, -244476.91, "Total de Patrimonio");
  assertMoney(bg.totalPasivoPatrimonio, -257902.46, "Total Pasivo + Patrimonio");
});

test("Balance General: cuadra con los datos reales (Activo = -(Pasivo+Patrimonio))", () => {
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);
  assertMoney(bg.descuadre, 0, "descuadre");
  assert.equal(bg.cuadra, true);
  assertMoney(bg.activos.total, -bg.totalPasivoPatrimonio, "Activo vs Pasivo+Patrimonio");
});

test("la Utilidad del Ejercicio del Balance ES la utilidad operativa del ER", () => {
  const { estadoResultado: er, balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);
  assert.equal(bg.utilidadDelEjercicio, er.utilidadOperativa);
  assertMoney(bg.utilidadDelEjercicio, -244476.91, "Utilidad del Ejercicio");
});

test("datos reales: ninguna cuenta cae en 'Sin clasificar'", () => {
  const { estadoResultado: er, balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);
  const allGroups = [
    ...er.ingresos.groups,
    ...er.costos.groups,
    ...er.gastos.groups,
    ...bg.activos.groups,
    ...bg.pasivos.groups,
    ...bg.patrimonio.groups,
  ];
  assert.equal(
    allGroups.filter((g) => g.isUnclassified).length,
    0,
    "las 62 cuentas de Josuar están todas clasificadas"
  );
});

test("Balance General: los grupos de activo salen en el orden de Josuar", () => {
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);
  assert.deepEqual(
    bg.activos.groups.map((g) => g.label),
    ["Activos corrientes", "Propiedad, planta y equipo", "Activo no corriente"]
  );
});

test("renglones ordenados por código dentro de cada grupo", () => {
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);
  for (const group of bg.activos.groups) {
    const codes = group.rows.map((r) => r.code);
    const expected = [...codes].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    assert.deepEqual(codes, expected, `grupo ${group.label} desordenado`);
  }
});

// ===========================================================================
// 2) Convención de signos y agrupamiento (casos sintéticos)
// ===========================================================================

function acc(
  code: string,
  account_type: ReportAccount["account_type"],
  subcategoria: ReportAccount["subcategoria"],
  saldo: number
): ReportAccount {
  return { code, name: `Cuenta ${code}`, account_type, subcategoria, saldo };
}

test("Costo y Gasto se separan por account_type, no por subcategoría (NIIF 18)", () => {
  // Antes de NIIF 18 las dos eran account_type='expense' y la única forma de
  // separarlas era la subcategoría. Ahora `cost` es un tipo propio.
  const er = buildEstadoResultado([
    acc("500001", "cost", "costos_operativos", 1000),
    acc("600001", "expense", "gastos_operativos", 250),
  ]);
  assertMoney(er.costos.total, 1000, "Total de Costos");
  assertMoney(er.gastos.total, 250, "Total de Gastos");
});

test("INGRESOS toma todas las cuentas income, incluso sin subcategoría", () => {
  const er = buildEstadoResultado([
    acc("400001", "income", "ingresos_operativos", -500),
    acc("400002", "income", null, -300),
  ]);
  assertMoney(er.ingresos.total, -800, "Total de Ingresos");
  assert.equal(er.ingresos.groups.length, 1, "income va plano, sin subgrupos");
});

test("ninguna cuenta de resultado se evapora: la sección la decide el tipo", () => {
  // Reemplaza al test viejo del grupo "Sin clasificar" dentro de Gastos. Ese
  // grupo existía porque un `expense` que no fuera ni `costo` ni
  // `gasto_operativo` no caía en ninguna sección y se habría perdido del
  // reporte. Con la sección decidida por account_type el problema no puede
  // ocurrir, así que lo que hay que proteger ahora es esa garantía.
  //
  // Las subcategorías van en NULL a propósito: es el peor caso posible, y el
  // CHECK de BD lo impide en cuentas activas, pero el armado puro no debe
  // depender de eso.
  const er = buildEstadoResultado([
    acc("600001", "expense", "gastos_operativos", 100),
    acc("690001", "expense", null, 40),
    acc("500001", "cost", null, 7),
    acc("400001", "income", null, -20),
  ]);
  assertMoney(er.gastos.total, 140, "el gasto sin subcategoría igual suma");
  assertMoney(er.costos.total, 7, "el costo sin subcategoría igual suma");
  assertMoney(er.ingresos.total, -20, "el ingreso sin subcategoría igual suma");

  const grupos = [...er.ingresos.groups, ...er.costos.groups, ...er.gastos.groups];
  assert.ok(
    grupos.every((g) => !g.isUnclassified),
    "el Estado de Resultado ya no necesita grupo Sin clasificar"
  );
});

test("un activo sin subcategoría entra en Sin clasificar al final de su tipo", () => {
  const bg = buildBalanceGeneral(
    [acc("100001", "asset", "activo_corriente", 500), acc("190001", "asset", null, 25)],
    { utilidadDelEjercicio: 0 }
  );
  assertMoney(bg.activos.total, 525, "Total de Activo incluye los sin clasificar");
  const last = bg.activos.groups[bg.activos.groups.length - 1];
  assert.equal(last.isUnclassified, true, "el grupo Sin clasificar va último");
  assert.equal(last.rows[0].code, "190001");
});

test("grupos vacíos no se renderizan", () => {
  const bg = buildBalanceGeneral([acc("100001", "asset", "activo_corriente", 10)], {
    utilidadDelEjercicio: 0,
  });
  assert.equal(bg.activos.groups.length, 1, "solo el grupo que tiene cuentas");
  assert.equal(bg.pasivos.groups.length, 0);
});

test("el Patrimonio suma las cuentas de patrimonio MÁS la utilidad del ejercicio", () => {
  const bg = buildBalanceGeneral([acc("300001", "equity", "patrimonio", -5000)], {
    utilidadDelEjercicio: -1000,
  });
  assertMoney(bg.patrimonio.total, -6000, "Total de Patrimonio");
  assertMoney(bg.utilidadDelEjercicio, -1000, "Utilidad del Ejercicio");
});

test("balance que NO cuadra se reporta como descuadre, no se esconde", () => {
  const bg = buildBalanceGeneral(
    [acc("100001", "asset", "activo_corriente", 1000), acc("200001", "liability", "pasivo_corriente", -400)],
    { utilidadDelEjercicio: 0 }
  );
  assert.equal(bg.cuadra, false);
  assertMoney(bg.descuadre, 600, "descuadre");
});

// ===========================================================================
// 3) Impuesto sobre la Renta (parámetro, no regla fiscal)
// ===========================================================================

test("ISR: con ganancia se aplica la tasa y reduce la utilidad", () => {
  // Ganancia de 1000 → en convención de balanza, utilidad operativa = -1000.
  const er = buildEstadoResultado([acc("400001", "income", "ingresos_operativos", -1000)]);
  assertMoney(er.utilidadOperativa, -1000, "Utilidad Operativa");
  assert.equal(er.isr.applied, true);
  assert.equal(er.isr.rate, DEFAULT_ISR_RATE);
  assertMoney(er.isr.amount, 250, "ISR 25% de 1000");
  assertMoney(er.utilidadNeta, -750, "Utilidad Neta");
});

test("ISR: con PÉRDIDA no se aplica (queda en 0)", () => {
  // Pérdida: gastos mayores que ingresos → utilidad operativa POSITIVA.
  const er = buildEstadoResultado([
    acc("400001", "income", "ingresos_operativos", -100),
    acc("600001", "expense", "gastos_operativos", 500),
  ]);
  assertMoney(er.utilidadOperativa, 400, "Utilidad Operativa (pérdida)");
  assert.equal(er.isr.applied, false);
  assertMoney(er.isr.amount, 0, "ISR");
  assertMoney(er.utilidadNeta, 400, "Utilidad Neta = operativa cuando hay pérdida");
});

test("ISR: resultado en cero no se grava", () => {
  const er = buildEstadoResultado([
    acc("400001", "income", "ingresos_operativos", -100),
    acc("600001", "expense", "gastos_operativos", 100),
  ]);
  assertMoney(er.utilidadOperativa, 0, "Utilidad Operativa");
  assert.equal(er.isr.applied, false);
  assertMoney(er.isr.amount, 0, "ISR");
});

test("ISR: la tasa es un parámetro (no está hardcodeada en el cálculo)", () => {
  const er = buildEstadoResultado([acc("400001", "income", "ingresos_operativos", -1000)], {
    isrRate: 0.1,
  });
  assert.equal(er.isr.rate, 0.1);
  assertMoney(er.isr.amount, 100, "ISR al 10%");
  assertMoney(er.utilidadNeta, -900, "Utilidad Neta");
});

test("ISR: con los datos reales de Josuar, al 25% sobre la utilidad operativa", () => {
  const er = buildEstadoResultado(JOSUAR_ACCOUNTS);
  assertMoney(er.isr.amount, 61119.23, "ISR 25% de 244,476.91");
  assertMoney(er.utilidadNeta, -183357.68, "Utilidad Neta");
});

// ===========================================================================
// 4) Bordes
// ===========================================================================

test("sin cuentas: todo en cero y el balance cuadra", () => {
  const { estadoResultado: er, balanceGeneral: bg } = buildAccountingReports([]);
  assertMoney(er.ingresos.total, 0, "Ingresos");
  assertMoney(er.utilidadOperativa, 0, "Utilidad Operativa");
  assert.equal(er.isr.applied, false);
  assertMoney(bg.activos.total, 0, "Activo");
  assert.equal(bg.cuadra, true);
});

test("los centavos no se arrastran: suma de decimales exacta a 2 dígitos", () => {
  const er = buildEstadoResultado([
    acc("600001", "expense", "gastos_operativos", 0.1),
    acc("600002", "expense", "gastos_operativos", 0.2),
  ]);
  assert.equal(er.gastos.total, 0.3, "0.1 + 0.2 debe dar 0.3, no 0.30000000000000004");
});

/**
 * LOS TRES RESULTADOS TIENEN QUE DAR EL MISMO NÚMERO.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ ATA ESTE ARCHIVO Y POR QUÉ
 * ═════════════════════════════════════════════════════════════════════════════
 * El resultado del ejercicio se calcula en TRES lugares distintos:
 *
 *   1. `buildBalanceGeneral()`  → `utilidadDelEjercicio`, el renglón calculado
 *      que se suma al patrimonio. Sin él, el Balance no cuadra.
 *   2. `buildEstadoResultado()` → el ER clásico, agrupado por tipo de cuenta.
 *   3. `buildEstadoResultadoNiif18()` → el ER por actividad, que es **el que
 *      renderiza `/finanzas/reportes/pyl`** y por lo tanto el único que el
 *      contador ve.
 *
 * Los tres leen las mismas `ReportAccount`, así que hoy no divergen. Pero nada
 * los obliga: son tres funciones separadas y el par que importa —Balance contra
 * NIIF 18— no compartía ni un test.
 *
 * Que el contador vea un resultado en el Estado de Resultado y otro distinto en
 * el patrimonio del Balance es de los errores que hacen desconfiar del sistema
 * entero, no de una pantalla.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAccountingReports,
  type ReportAccount,
} from "@/lib/finanzas/reports/accounting-reports";
import { buildEstadoResultadoNiif18 } from "@/lib/finanzas/reports/estado-resultado-niif18";

const EPSILON = 0.005;

/**
 * Una cuenta del plan, en convención de balanza: débito positivo, crédito
 * negativo. Una GANANCIA es negativa.
 */
function cuenta(
  code: string,
  name: string,
  account_type: ReportAccount["account_type"],
  subcategoria: ReportAccount["subcategoria"],
  saldo: number
): ReportAccount {
  return {
    code,
    name,
    account_type,
    subcategoria,
    saldo,
    saldoInicial: saldo,
    movimientoLedger: 0,
    debitos: 0,
    creditos: 0,
    inactivaConMovimiento: false,
  };
}

/** Un plan mínimo pero completo, con todo clasificado. */
function planClasificado(): ReportAccount[] {
  return [
    cuenta("100001", "Banco General Operativa", "asset", "activo_corriente", 10000),
    cuenta("200001", "Cuentas por pagar", "liability", "pasivo_corriente", -1200),
    cuenta("300001", "Capital", "equity", "patrimonio", -4000),
    cuenta("400001", "Derecho Corporativo", "income", "ingresos_operativos", -8000),
    cuenta("500001", "Costos de trámites", "cost", "costos_operativos", 1200),
    cuenta("610001", "Alquiler", "expense", "gastos_operativos", 2000),
  ];
}

/** Los tres números que tienen que coincidir. */
function losTres(accounts: ReportAccount[]) {
  const { estadoResultado, balanceGeneral } = buildAccountingReports(accounts);
  const niif18 = buildEstadoResultadoNiif18(accounts);
  return {
    balance: balanceGeneral.utilidadDelEjercicio,
    clasico: estadoResultado.utilidadOperativa,
    // ⚠️ `utilidadAntesImpuesto`, NO `utilidadOperativa`. En el NIIF 18
    // `utilidadOperativa` es el resultado del BLOQUE DE OPERACIÓN; el
    // equivalente al resultado del ER clásico suma las tres actividades MÁS las
    // cuentas sin categoría. Comparar el campo equivocado fue lo que hizo
    // reportar un defecto inexistente el 02/09/2026.
    niif18: niif18.totales.utilidadAntesImpuesto,
    niif18SoloOperacion: niif18.totales.utilidadOperativa,
    sinClasificar: niif18.sinClasificar,
    balanceGeneral,
  };
}

// ---------------------------------------------------------------------------
// EL CASO NORMAL: con todo clasificado, los tres dan igual
// ---------------------------------------------------------------------------

test("Balance = ER clásico = ER NIIF 18, al centavo", () => {
  const r = losTres(planClasificado());

  assert.ok(
    Math.abs(r.balance - r.clasico) < EPSILON,
    `Balance ${r.balance} ≠ ER clásico ${r.clasico}`
  );
  assert.ok(
    Math.abs(r.clasico - r.niif18) < EPSILON,
    `ER clásico ${r.clasico} ≠ ER NIIF 18 ${r.niif18} — y el NIIF 18 es el que ve el contador`
  );
  assert.ok(
    Math.abs(r.balance - r.niif18) < EPSILON,
    `Balance ${r.balance} ≠ ER NIIF 18 ${r.niif18}`
  );

  // Y el número es el que corresponde: −8000 ingresos + 1200 costos + 2000 gastos.
  assert.ok(Math.abs(r.balance - -4800) < EPSILON, `esperaba −4800, dio ${r.balance}`);
});

test("con una pérdida, los tres siguen coincidiendo", () => {
  const plan = planClasificado();
  // Se invierte el resultado: los gastos superan a los ingresos.
  plan[3] = cuenta("400001", "Derecho Corporativo", "income", "ingresos_operativos", -1000);
  const r = losTres(plan);

  assert.ok(r.balance > 0, "en balanza una pérdida es positiva");
  assert.ok(Math.abs(r.balance - r.clasico) < EPSILON);
  assert.ok(Math.abs(r.balance - r.niif18) < EPSILON);
});

test("sin cuentas de resultado, los tres dan cero", () => {
  const r = losTres([
    cuenta("100001", "Banco", "asset", "activo_corriente", 5000),
    cuenta("300001", "Capital", "equity", "patrimonio", -5000),
  ]);
  assert.equal(r.balance, 0);
  assert.equal(r.clasico, 0);
  assert.equal(r.niif18, 0);
});

test("el Balance cuadra cuando el resultado se suma al patrimonio", () => {
  const { balanceGeneral } = losTres(planClasificado());
  assert.ok(
    balanceGeneral.cuadra,
    `el balance no cuadra: descuadre ${balanceGeneral.descuadre}`
  );
  assert.ok(Math.abs(balanceGeneral.descuadre) < EPSILON);
});

// ---------------------------------------------------------------------------
// 🔴 EL MODO DE FALLA REAL: una cuenta de resultado SIN categoría NIIF 18
// ---------------------------------------------------------------------------

test("los tres coinciden TAMBIÉN con cuentas sin categoría NIIF 18", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // ESTE TEST ESTUVO INVERTIDO, Y VALE LA PENA QUE QUEDE ESCRITO.
  //
  // El 02/09/2026 se reportó como DEFECTO que el NIIF 18 dejaba las cuentas sin
  // categoría afuera de su total. **Era falso.** El reporte ya las sumaba —en
  // `utilidadAntesImpuesto`— y ya las mostraba en un bloque propio. Lo que
  // estaba mal era el test: comparaba `utilidadOperativa` del NIIF 18, que es el
  // resultado del BLOQUE DE OPERACIÓN, contra `utilidadOperativa` del ER
  // clásico, que es el resultado TOTAL. Dos conceptos con el mismo nombre.
  //
  // Ahora exige lo correcto: con una cuenta huérfana, los tres tienen que dar
  // igual igual.
  // ─────────────────────────────────────────────────────────────────────────
  const plan = [
    ...planClasificado(),
    cuenta("400099", "Ingreso sin clasificar", "income", null, -1500),
  ];
  const r = losTres(plan);

  assert.equal(r.sinClasificar.length, 1, "la cuenta tiene que caer en sinClasificar");
  assert.equal(r.sinClasificar[0].code, "400099");

  // Los TRES incluyen el ingreso huérfano: −4800 del bloque de operación −1500.
  assert.ok(Math.abs(r.balance - -6300) < EPSILON, `Balance: esperaba −6300, dio ${r.balance}`);
  assert.ok(Math.abs(r.clasico - -6300) < EPSILON, `ER clásico: esperaba −6300, dio ${r.clasico}`);
  assert.ok(
    Math.abs(r.niif18 - -6300) < EPSILON,
    `ER NIIF 18: esperaba −6300, dio ${r.niif18} — una cuenta quedó fuera del total`
  );

  // Y la cuenta huérfana NO entra al bloque de operación, que es lo correcto:
  // no pertenece a ninguna actividad.
  assert.ok(Math.abs(r.niif18SoloOperacion - -4800) < EPSILON);
});

test("un gasto sin categoría tampoco se pierde", () => {
  const plan = [
    ...planClasificado(),
    cuenta("610099", "Gasto sin clasificar", "expense", null, 900),
  ];
  const r = losTres(plan);

  assert.equal(r.sinClasificar.length, 1);
  assert.ok(Math.abs(r.balance - r.niif18) < EPSILON, "el gasto huérfano se perdió en el NIIF 18");
  assert.ok(Math.abs(r.balance - -3900) < EPSILON, `esperaba −3900, dio ${r.balance}`);
});

test("varias cuentas sin categoría, de tipos distintos, siguen cuadrando", () => {
  const plan = [
    ...planClasificado(),
    cuenta("400099", "Ingreso sin clasificar", "income", null, -1500),
    cuenta("500099", "Costo sin clasificar", "cost", null, 400),
    cuenta("610099", "Gasto sin clasificar", "expense", null, 900),
  ];
  const r = losTres(plan);

  assert.equal(r.sinClasificar.length, 3);
  assert.ok(Math.abs(r.balance - r.clasico) < EPSILON);
  assert.ok(Math.abs(r.balance - r.niif18) < EPSILON);
  assert.ok(Math.abs(r.balance - -5000) < EPSILON, `esperaba −5000, dio ${r.balance}`);
});

test("las cuentas sin categoría se VEN: bloque propio con su subtotal", () => {
  // Que se vean es la señal de que hay que clasificarlas. Esconderlas —o peor,
  // dejarlas afuera del total en silencio— es lo que hace desconfiar del
  // reporte entero.
  const plan = [
    ...planClasificado(),
    cuenta("400099", "Ingreso sin clasificar", "income", null, -1500),
    cuenta("610099", "Gasto sin clasificar", "expense", null, 900),
  ];
  const r = losTres(plan);
  assert.equal(r.sinClasificar.length, 2);
  assert.deepEqual(
    r.sinClasificar.map((a) => a.code).sort(),
    ["400099", "610099"]
  );

  // Y el reporte emite un bloque visible que dice POR QUÉ están ahí.
  const er = buildEstadoResultadoNiif18(plan);
  const bloque = er.filas.find(
    (f) => f.kind === "bloque" && f.label.includes("SIN CATEGORÍA NIIF 18")
  );
  assert.ok(bloque, "falta el bloque visible de cuentas sin categoría");

  const subtotal = er.filas.find(
    (f) => f.kind === "subtotal" && f.label.includes("sin categoría asignada")
  );
  assert.ok(subtotal, "falta el subtotal del bloque");
});

// ---------------------------------------------------------------------------
// ISR — Integra es sociedad civil
// ---------------------------------------------------------------------------

test("con tasa 0 no se cobra impuesto, pero SÍ hubo utilidad", () => {
  const { estadoResultado } = buildAccountingReports(planClasificado());

  assert.equal(estadoResultado.isr.rate, 0, "Integra es sociedad civil: tasa 0");
  assert.equal(estadoResultado.isr.amount, 0, "no se cobra impuesto a nivel de empresa");
  // El campo dice si hubo UTILIDAD, no si se cobró impuesto. Son cosas
  // distintas y confundirlas fue lo que motivó el renombre del 02/09/2026.
  assert.equal(estadoResultado.isr.huboUtilidad, true, "el período cerró con ganancia");
});

test("con pérdida no hay utilidad y tampoco impuesto", () => {
  const plan = planClasificado();
  plan[3] = cuenta("400001", "Derecho Corporativo", "income", "ingresos_operativos", -1000);
  const { estadoResultado } = buildAccountingReports(plan);

  assert.equal(estadoResultado.isr.huboUtilidad, false);
  assert.equal(estadoResultado.isr.amount, 0);
});

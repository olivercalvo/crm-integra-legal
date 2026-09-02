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
    niif18: niif18.totales.utilidadOperativa,
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

test("🔴 DEFECTO CONOCIDO: un ingreso sin subcategoría hace divergir al NIIF 18", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // ESTE TEST DOCUMENTA UN DEFECTO, NO LO BENDICE.
  //
  // El ER NIIF 18 arma sus totales recorriendo las tres ACTIVIDADES (operación,
  // inversión, financiamiento). Una cuenta de resultado sin `subcategoria` no
  // pertenece a ninguna, así que cae en `sinClasificar` y **queda fuera del
  // total**. El ER clásico y el Balance, en cambio, suman por TIPO de cuenta y
  // sí la incluyen.
  //
  // Resultado: el contador ve un número en /pyl y otro distinto en el
  // patrimonio del Balance, y la diferencia es exactamente el saldo de esa
  // cuenta.
  //
  // Hoy NO ocurre en staging (`sinClasificar` está vacío), pero puede ocurrir en
  // cuanto alguien cree una cuenta desde el Plan de Cuentas sin subcategoría —
  // que es posible, y por eso existe el aviso `UnclassifiedWarning`.
  //
  // ⚠️ CUANDO ESTO SE ARREGLE, ESTE TEST FALLA. Es a propósito: obliga a venir
  // acá, borrar esta aserción y dejar la de arriba, que es la correcta.
  // ─────────────────────────────────────────────────────────────────────────
  const plan = [
    ...planClasificado(),
    cuenta("400099", "Ingreso sin clasificar", "income", null, -1500),
  ];
  const r = losTres(plan);

  assert.equal(r.sinClasificar.length, 1, "la cuenta tiene que caer en sinClasificar");
  assert.equal(r.sinClasificar[0].code, "400099");

  // El Balance y el ER clásico SÍ la cuentan.
  assert.ok(Math.abs(r.balance - -6300) < EPSILON, `Balance: esperaba −6300, dio ${r.balance}`);
  assert.ok(Math.abs(r.clasico - -6300) < EPSILON, `ER clásico: esperaba −6300, dio ${r.clasico}`);

  // El NIIF 18 la deja afuera: se queda en el resultado sin ese ingreso.
  assert.ok(Math.abs(r.niif18 - -4800) < EPSILON, `ER NIIF 18: esperaba −4800, dio ${r.niif18}`);

  // Y la divergencia es EXACTAMENTE el saldo de la cuenta que quedó afuera.
  const divergencia = Math.round((r.balance - r.niif18) * 100) / 100;
  assert.equal(divergencia, -1500, "la divergencia tiene que ser el saldo de la cuenta huérfana");
});

test("un gasto sin subcategoría diverge igual — no es solo cosa de los ingresos", () => {
  const plan = [
    ...planClasificado(),
    cuenta("610099", "Gasto sin clasificar", "expense", null, 900),
  ];
  const r = losTres(plan);

  assert.equal(r.sinClasificar.length, 1);
  const divergencia = Math.round((r.balance - r.niif18) * 100) / 100;
  assert.equal(divergencia, 900);
});

test("el ER NIIF 18 EXPONE las cuentas sin clasificar, para que la pantalla avise", () => {
  // Es lo que hoy contiene el daño: `/pyl` muestra un aviso cuando esta lista no
  // está vacía. El aviso no arregla la divergencia, pero evita que el número
  // pase por bueno sin que nadie mire.
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

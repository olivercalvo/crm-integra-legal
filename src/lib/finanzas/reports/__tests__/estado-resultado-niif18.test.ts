/**
 * Tests del Estado de Resultado NIIF 18 (Fase 1, Tareas 3 y 4).
 *
 * Dos cosas que estos tests protegen y que son fáciles de romper sin notarlo:
 *
 *   1. EL VUELCO DE SIGNOS. El motor sigue en convención de BALANZA y el vuelco
 *      vive solo acá. Si alguien "arregla" los signos en `accounting-reports.ts`
 *      estos tests siguen pasando pero el Balance General deja de cuadrar — por
 *      eso hay además un test que ATA este builder al viejo (ver "el oráculo").
 *
 *   2. LOS TOTALES CONTRA EL EXCEL DE JOSUAR. Cambiar la estructura del reporte
 *      no puede mover la plata.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/reports/__tests__/estado-resultado-niif18.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEstadoResultadoNiif18,
  presentar,
  type FilaER,
} from "@/lib/finanzas/reports/estado-resultado-niif18";
import {
  buildEstadoResultado,
  type ReportAccount,
} from "@/lib/finanzas/reports/accounting-reports";
import { JOSUAR_ACCOUNTS } from "./josuar-accounts.fixture";

function assertMoney(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 0.005,
    `${message}: esperado ${expected}, obtenido ${actual}`
  );
}

function acc(
  code: string,
  account_type: ReportAccount["account_type"],
  subcategoria: ReportAccount["subcategoria"],
  saldo: number
): ReportAccount {
  return { code, name: `Cuenta ${code}`, account_type, subcategoria, saldo };
}

/** Busca la primera fila con ese label exacto. */
function fila(filas: FilaER[], label: string): FilaER {
  const f = filas.find((x) => "label" in x && x.label === label);
  assert.ok(f, `no se encontró la fila "${label}"`);
  return f;
}

/** El monto presentado de una fila con valor. */
function valor(filas: FilaER[], label: string) {
  const f = fila(filas, label);
  assert.ok("valor" in f, `la fila "${label}" no tiene monto`);
  return f.valor;
}

function labels(filas: FilaER[]): string[] {
  return filas.filter((f) => "label" in f).map((f) => (f as { label: string }).label);
}

// ===========================================================================
// 1) La regla de presentación
// ===========================================================================

test("presentar: monto = |balanza|, paréntesis ⟺ balanza > 0", () => {
  // Crédito (ingreso, ganancia): suma → sin paréntesis.
  assert.deepEqual(presentar(-289137.06), {
    balanza: -289137.06,
    monto: 289137.06,
    entreParentesis: false,
  });
  // Débito (costo, gasto, impuesto): resta → entre paréntesis.
  assert.deepEqual(presentar(9878.38), {
    balanza: 9878.38,
    monto: 9878.38,
    entreParentesis: true,
  });
  // El cero no lleva paréntesis.
  assert.deepEqual(presentar(0), { balanza: 0, monto: 0, entreParentesis: false });
});

test("un débito dentro de INGRESOS (descuento) se muestra restando", () => {
  // 430001 Descuentos otorgados tiene saldo POSITIVO en una cuenta de ingreso:
  // es contra-ingreso y tiene que leerse como una resta.
  const { filas } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);
  const descuento = filas.find((f) => f.kind === "cuenta" && f.code === "430001");
  assert.ok(descuento && descuento.kind === "cuenta");
  assert.equal(descuento.valor.entreParentesis, true, "debe ir entre paréntesis");
  assertMoney(descuento.valor.monto, 663.25, "monto impreso");
});

// ===========================================================================
// 2) Totales contra el Excel de Josuar
// ===========================================================================

test("los totales NIIF 18 dan los mismos números que el Excel de Josuar", () => {
  const { totales } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);

  assertMoney(totales.ingresosOperativos, -289137.06, "Ingresos operativos");
  assertMoney(totales.costosOperativos, 9878.38, "Costos operativos");
  assertMoney(totales.utilidadBrutaOperativa, -279258.68, "Utilidad Bruta operativa");
  assertMoney(totales.gastosOperativos, 34781.77, "Gastos operativos");
  assertMoney(totales.utilidadOperativa, -244476.91, "Utilidad Operativa");
  assertMoney(totales.utilidadAntesImpuesto, -244476.91, "Utilidad antes de impuesto");
});

test("EL ORÁCULO: la Utilidad Operativa NIIF 18 es la misma que la del motor viejo", () => {
  // Este es el test que impide que las dos vistas diverjan. `buildEstadoResultado`
  // se queda en balanza y es la referencia contra el Excel; si alguien toca el
  // armado NIIF 18 y la plata deja de coincidir, salta acá.
  const viejo = buildEstadoResultado(JOSUAR_ACCOUNTS);
  const nuevo = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);

  assertMoney(nuevo.totales.utilidadOperativa, viejo.utilidadOperativa, "Utilidad Operativa");
  assertMoney(nuevo.totales.ingresosOperativos, viejo.ingresos.total, "Ingresos");
  assertMoney(nuevo.totales.costosOperativos, viejo.costos.total, "Costos");
  assertMoney(nuevo.totales.gastosOperativos, viejo.gastos.total, "Gastos");
  assertMoney(nuevo.totales.utilidadBrutaOperativa, viejo.gananciaBruta, "Ganancia Bruta");
});

test("presentación: ingresos en positivo, costos y gastos entre paréntesis", () => {
  const { filas } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);

  const ingresos = valor(filas, "Total ingresos operativos");
  assertMoney(ingresos.monto, 289137.06, "Total ingresos impreso");
  assert.equal(ingresos.entreParentesis, false, "los ingresos NO van entre paréntesis");

  const costos = valor(filas, "Total costos operativos");
  assertMoney(costos.monto, 9878.38, "Total costos impreso");
  assert.equal(costos.entreParentesis, true, "los costos VAN entre paréntesis");

  const gastos = valor(filas, "Total gastos operativos");
  assertMoney(gastos.monto, 34781.77, "Total gastos impreso");
  assert.equal(gastos.entreParentesis, true, "los gastos VAN entre paréntesis");

  const utilidad = valor(filas, "► Utilidad Operativa");
  assertMoney(utilidad.monto, 244476.91, "Utilidad Operativa impresa");
  assert.equal(utilidad.entreParentesis, false, "una ganancia NO va entre paréntesis");
});

// ===========================================================================
// 3) Estructura: bloques por actividad
// ===========================================================================

test("el bloque de operación sale en el orden del modelo de Josuar", () => {
  const { filas } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);
  const estructura = labels(filas).filter(
    (l) => l.startsWith("ACTIVIDAD") || l.startsWith("►") || l.startsWith("Total ")
  );

  assert.deepEqual(estructura, [
    "ACTIVIDAD DE OPERACIÓN",
    "Total ingresos operativos",
    "Total costos operativos",
    "► Utilidad Bruta operativa",
    "Total gastos operativos",
    "► Utilidad Operativa",
    "► Utilidad antes de impuesto sobre la renta",
    "► Utilidad Neta",
    "► Resultado del ejercicio",
  ]);
});

test("los bloques SIN cuentas no se muestran", () => {
  // Josuar hoy no tiene ninguna cuenta de inversión ni de financiamiento.
  const { filas } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);
  const ls = labels(filas);
  assert.ok(!ls.includes("ACTIVIDAD DE INVERSIÓN"), "no debería aparecer inversión");
  assert.ok(!ls.includes("ACTIVIDAD DE FINANCIAMIENTO"), "no debería aparecer financiamiento");
});

test("el bloque de inversión aparece en cuanto hay una cuenta", () => {
  const { filas, totales } = buildEstadoResultadoNiif18([
    acc("400001", "income", "ingresos_operativos", -1000),
    acc("450001", "income", "ingresos_inversion", -300),
    acc("650001", "expense", "gastos_inversion", 50),
  ]);
  const ls = labels(filas);
  assert.ok(ls.includes("ACTIVIDAD DE INVERSIÓN"));
  assert.ok(ls.includes("► Resultado de actividades de inversión"));
  assertMoney(totales.resultadoInversion, -250, "Resultado de inversión");
  assertMoney(totales.utilidadAntesImpuesto, -1250, "Utilidad antes de impuesto");
});

test("un grupo vacío dentro de un bloque tampoco imprime su subtotal", () => {
  // Bloque de operación con ingresos y gastos pero SIN costos.
  const { filas, totales } = buildEstadoResultadoNiif18([
    acc("400001", "income", "ingresos_operativos", -1000),
    acc("600001", "expense", "gastos_operativos", 400),
  ]);
  const ls = labels(filas);
  assert.ok(!ls.includes("Total costos operativos"), "no debe haber subtotal de costos");
  // Pero la Utilidad Bruta SÍ, porque es estructura del reporte.
  assert.ok(ls.includes("► Utilidad Bruta operativa"));
  assertMoney(totales.utilidadBrutaOperativa, -1000, "Bruta = ingresos cuando no hay costos");
});

// ===========================================================================
// 4) Tarea 4 — sociedad civil
// ===========================================================================

test("sociedad civil: el ejercicio cierra en CERO", () => {
  const { filas, totales, distribucionAplicada } =
    buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);

  assert.equal(distribucionAplicada, true, "por defecto Integra reparte");
  assertMoney(totales.utilidadNeta, -244476.91, "Utilidad Neta");
  assertMoney(totales.distribucionSocias, 244476.91, "Distribución a socias");
  assertMoney(totales.resultadoDelEjercicio, 0, "Resultado del ejercicio");

  const dist = valor(filas, "► Resultado del ejercicio");
  assertMoney(dist.monto, 0, "impreso");
  assert.equal(dist.entreParentesis, false);
});

test("la distribución se imprime restando y por el código configurado", () => {
  const { filas } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);
  const linea = filas.find((f) => f.kind === "cuenta" && f.code === "300004");
  assert.ok(linea && linea.kind === "cuenta", "debe estar la cuenta de distribución");
  assertMoney(linea.valor.monto, 244476.91, "monto distribuido");
  assert.equal(linea.valor.entreParentesis, true, "la distribución RESTA");
});

test("el código de la cuenta de distribución es parametrizable", () => {
  // Josuar todavía tiene que confirmarlo: puede pedir un pasivo en vez de una
  // cuenta de patrimonio. Cambiarlo no debe obligar a tocar el código.
  const { filas } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS, {
    cuentaDistribucion: "210001",
    nombreDistribucion: "Por pagar a socias",
  });
  const linea = filas.find((f) => f.kind === "cuenta" && f.code === "210001");
  assert.ok(linea && linea.kind === "cuenta");
  assert.equal(linea.name, "Por pagar a socias");
});

test("sociedad anónima (distribución OFF): el resultado NO cierra en cero", () => {
  const { filas, totales } = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS, {
    distribucionASocias: false,
    isrRate: 0.25,
  });
  const ls = labels(filas);
  assert.ok(!ls.includes("DISTRIBUCIÓN A SOCIAS"), "no debe haber sección de reparto");
  assert.ok(!ls.includes("► Resultado del ejercicio"));
  assertMoney(totales.impuesto, 61119.23, "ISR al 25%");
  assertMoney(totales.utilidadNeta, -183357.68, "Utilidad Neta");
  assertMoney(totales.resultadoDelEjercicio, -183357.68, "queda la utilidad neta");
});

test("con PÉRDIDA: no hay impuesto y la distribución la absorbe igual", () => {
  const er = buildEstadoResultadoNiif18([
    acc("400001", "income", "ingresos_operativos", -100),
    acc("600001", "expense", "gastos_operativos", 500),
  ]);
  assertMoney(er.totales.utilidadAntesImpuesto, 400, "pérdida (positiva en balanza)");
  assert.equal(er.isr.huboUtilidad, false, "una pérdida no se grava");
  assertMoney(er.totales.impuesto, 0, "ISR");

  const neta = valor(er.filas, "► Utilidad Neta");
  assert.equal(neta.entreParentesis, true, "una PÉRDIDA sí va entre paréntesis");
  assertMoney(neta.monto, 400, "monto de la pérdida");

  assertMoney(er.totales.resultadoDelEjercicio, 0, "cierra en cero igual");
});

// ===========================================================================
// 5) ISR como parámetro
// ===========================================================================

test("ISR: por defecto 0 y el renglón lo explica", () => {
  const er = buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);
  assertMoney(er.totales.impuesto, 0, "impuesto");
  assert.equal(er.isr.rate, 0);
  const f = fila(er.filas, "Impuesto sobre la renta");
  assert.ok("nota" in f && /sociedad civil/i.test(f.nota), "la nota debe explicar por qué es 0");
});

test("ISR: con tasa explícita se aplica sobre la utilidad ANTES de impuesto", () => {
  const er = buildEstadoResultadoNiif18(
    [
      acc("400001", "income", "ingresos_operativos", -1000),
      acc("450001", "income", "ingresos_inversion", -200),
    ],
    { isrRate: 0.25, distribucionASocias: false }
  );
  // Grava 1200 (operación + inversión), no solo los 1000 de operación.
  assertMoney(er.totales.utilidadAntesImpuesto, -1200, "antes de impuesto");
  assertMoney(er.totales.impuesto, 300, "ISR 25% de 1200");
  assertMoney(er.totales.utilidadNeta, -900, "Utilidad Neta");
});

// ===========================================================================
// 6) Bordes
// ===========================================================================

test("sin cuentas: todo en cero y no se rompe", () => {
  const er = buildEstadoResultadoNiif18([]);
  assertMoney(er.totales.utilidadOperativa, 0, "Utilidad Operativa");
  assertMoney(er.totales.resultadoDelEjercicio, 0, "Resultado del ejercicio");
  assert.ok(!labels(er.filas).includes("ACTIVIDAD DE OPERACIÓN"), "sin bloque de operación");
});

test("una cuenta de resultado SIN clasificar no se evapora", () => {
  // El CHECK de BD lo impide en cuentas activas, pero el armado puro no debe
  // depender de eso: si aparece, se muestra y suma.
  const er = buildEstadoResultadoNiif18([
    acc("400001", "income", "ingresos_operativos", -1000),
    acc("690001", "expense", null, 250),
  ]);
  assert.equal(er.sinClasificar.length, 1);
  // La etiqueta cambió el 02/09/2026: "SIN CLASIFICAR" no decía POR QUÉ esas
  // cuentas estaban ahí ni que SÍ entran al resultado.
  assert.ok(
    labels(er.filas).includes("CUENTAS SIN CATEGORÍA NIIF 18 ASIGNADA"),
    "falta el bloque visible de cuentas sin categoría"
  );
  assertMoney(er.totales.utilidadAntesImpuesto, -750, "la cuenta huérfana suma igual");
});

test("las cuentas de BALANCE no entran al Estado de Resultado", () => {
  const er = buildEstadoResultadoNiif18([
    acc("400001", "income", "ingresos_operativos", -1000),
    acc("100001", "asset", "activo_corriente", 5000),
    acc("200001", "liability", "pasivo_corriente", -2000),
  ]);
  assertMoney(er.totales.utilidadAntesImpuesto, -1000, "solo cuentas de resultado");
  assert.equal(er.sinClasificar.length, 0, "un activo no es una cuenta sin clasificar");
});

test("los centavos no se arrastran", () => {
  const er = buildEstadoResultadoNiif18([
    acc("600001", "expense", "gastos_operativos", 0.1),
    acc("600002", "expense", "gastos_operativos", 0.2),
  ]);
  assert.equal(er.totales.gastosOperativos, 0.3, "0.1 + 0.2 debe dar 0.3");
});

/**
 * Líneas de gasto — validador y totales.
 *
 * Lo que estos tests protegen, en orden de importancia:
 *
 *   1. **La cuenta es obligatoria al crear**, aunque la columna sea NULLABLE.
 *      El `NOT NULL` no está en la base a propósito (las líneas del backfill
 *      histórico quedan sin clasificar), así que el validador es la ÚNICA
 *      defensa que impide que una línea nueva nazca sin cuenta.
 *   2. Los totales cuadran al centavo con el caso real de tres cuentas que
 *      motivó todo el modelo.
 *   3. Una línea sin tocar se descarta en silencio, no reclama campos.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CUENTA_TRAMITE_DEFAULT,
  cuentaLabel,
  haySinClasificar,
  impuestoSugerido,
  LABEL_SIN_CLASIFICAR,
  tasaLabel,
  totalesDeLineas,
} from "@/lib/finanzas/types/expense-line";
import {
  lineaEstaVacia,
  lineaVacia,
  validarLineas,
  MAX_LINEAS,
} from "@/lib/finanzas/validators/expense-line";
import type { ExpenseLineDraft } from "@/lib/finanzas/types/expense-line";

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

function draft(over: Partial<ExpenseLineDraft> = {}): ExpenseLineDraft {
  return {
    key: "k1",
    description: "Timbres fiscales",
    chart_account_code: CUENTA_TRAMITE_DEFAULT,
    amount: "100.00",
    tax_rate: "0",
    tax_amount: "0",
    ...over,
  };
}

// ===========================================================================
// 1. LA CUENTA ES OBLIGATORIA AL CREAR
// ===========================================================================

test("una línea nueva SIN cuenta se rechaza — el NOT NULL vive acá, no en la base", () => {
  const r = validarLineas([draft({ chart_account_code: "" })]);
  assert.equal(r.ok, false);
  assert.equal(
    r.errors?.["lineas.0.chart_account_code"],
    "Elija la cuenta contable de esta línea",
    "si este test se rompe, una línea nueva puede nacer sin clasificar y postearse mal"
  );
});

test("la cuenta en blanco no se salva con espacios", () => {
  const r = validarLineas([draft({ chart_account_code: "   " })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors?.["lineas.0.chart_account_code"]);
});

test("la línea nueva arranca con 130003 precargada, que es el default del acta", () => {
  assert.equal(lineaVacia("k").chart_account_code, CUENTA_TRAMITE_DEFAULT);
  assert.equal(CUENTA_TRAMITE_DEFAULT, "130003");
});

test("el default es precarga, no imposición: otra cuenta se acepta", () => {
  // Regla de Rose: ningún campo de cuenta se cierra por completo. El gasto del
  // 15/03 necesita 500005 en una de sus líneas.
  const r = validarLineas([draft({ chart_account_code: "500005" })]);
  assert.equal(r.ok, true);
  assert.equal(r.data?.lineas[0].chart_account_code, "500005");
});

// ===========================================================================
// 2. LOS TOTALES — el caso real que motivó el modelo
// ===========================================================================

test("el gasto del 15/03 con sus tres cuentas cuadra al centavo", () => {
  // Es el caso del fixture: se muestra como "Honorarios Profesionales 1.497,85"
  // y su asiento lo parte en tres. Descubrirlo el 02/09 es lo que obligó a
  // pasar de "una cuenta por gasto" a líneas.
  const r = validarLineas([
    draft({ key: "a", description: "Útiles de oficina", chart_account_code: "610001", amount: "412.35" }),
    draft({ key: "b", description: "Honorario externo", chart_account_code: "500005", amount: "900.00" }),
    draft({ key: "c", description: "Mensajería", chart_account_code: "610002", amount: "185.50" }),
  ]);

  assert.equal(r.ok, true);
  assert.equal(r.data?.lineas.length, 3);
  assert.equal(r.data?.totales.base, 1497.85);
  assert.equal(r.data?.totales.impuesto, 0);
  assert.equal(r.data?.totales.total, 1497.85);
});

test("line_order se asigna 1..n en el orden en que llegan", () => {
  const r = validarLineas([
    draft({ key: "a", amount: "10" }),
    draft({ key: "b", amount: "20" }),
    draft({ key: "c", amount: "30" }),
  ]);
  assert.deepEqual(r.data?.lineas.map((l) => l.line_order), [1, 2, 3]);
});

test("los totales se redondean al final, no línea por línea", () => {
  // Tres líneas de 0.005 dan 0.015. Redondeando cada una daría 0.00 + 0.00 +
  // 0.00 = 0; redondeando la suma da 0.02. La base calcula `SUM(line_total)`
  // sobre columnas generadas, así que tiene que coincidir con lo segundo.
  const t = totalesDeLineas([
    { amount: 0.005, tax_amount: 0 },
    { amount: 0.005, tax_amount: 0 },
    { amount: 0.005, tax_amount: 0 },
  ]);
  assert.equal(t.base, 0.02);
});

test("el impuesto suma aparte de la base y el total es la suma de los dos", () => {
  const t = totalesDeLineas([
    { amount: 100, tax_amount: 7 },
    { amount: 200, tax_amount: 14 },
  ]);
  assert.deepEqual(t, { base: 300, impuesto: 21, total: 321 });
});

test("sin líneas los tres totales son 0, no NaN", () => {
  assert.deepEqual(totalesDeLineas([]), { base: 0, impuesto: 0, total: 0 });
});

// ===========================================================================
// 3. LÍNEAS VACÍAS
// ===========================================================================

test("una línea recién agregada y sin tocar se descarta en silencio", () => {
  const r = validarLineas([draft({ amount: "50" }), lineaVacia("k2")]);
  assert.equal(r.ok, true, "no debería reclamar campos de una línea que nadie tocó");
  assert.equal(r.data?.lineas.length, 1);
});

test("la cuenta precargada NO cuenta como 'tocada'", () => {
  // Si contara, apretar "agregar línea" y arrepentirse dejaría el form inválido.
  assert.equal(lineaEstaVacia(lineaVacia("k")), true);
});

test("si TODAS las líneas están vacías, pide al menos una con monto", () => {
  const r = validarLineas([lineaVacia("a"), lineaVacia("b")]);
  assert.equal(r.ok, false);
  assert.equal(r.errors?.["lineas"], "Agregue al menos una línea con monto");
});

test("un gasto sin ninguna línea se rechaza", () => {
  assert.equal(validarLineas([]).ok, false);
});

// ===========================================================================
// Montos, tasas e impuesto
// ===========================================================================

test("el monto acepta coma decimal, que es como se teclea en Panamá", () => {
  const r = validarLineas([draft({ amount: "1.497,85" })]);
  assert.equal(r.ok, true);
  assert.equal(r.data?.lineas[0].amount, 1497.85);
});

test("el monto acepta también el formato con punto decimal", () => {
  const r = validarLineas([draft({ amount: "1,497.85" })]);
  assert.equal(r.ok, true);
  assert.equal(r.data?.lineas[0].amount, 1497.85);
});

test("un monto de 0 o negativo se rechaza", () => {
  assert.ok(validarLineas([draft({ amount: "0" })]).errors?.["lineas.0.amount"]);
  assert.ok(validarLineas([draft({ amount: "-5" })]).errors?.["lineas.0.amount"]);
});

test("el impuesto del comprobante se acepta dentro de la tolerancia", () => {
  // 100 × 7% = 7.00, pero el proveedor imprimió 7.01. Manda el comprobante.
  const r = validarLineas([draft({ amount: "100", tax_rate: "0.07", tax_amount: "7.01" })]);
  assert.equal(r.ok, true);
  assert.equal(r.data?.lineas[0].tax_amount, 7.01);
});

test("un impuesto que no se parece a la tasa se rechaza, y el mensaje dice cuánto sería", () => {
  const r = validarLineas([draft({ amount: "100", tax_rate: "0.07", tax_amount: "70" })]);
  assert.equal(r.ok, false);
  assert.match(r.errors?.["lineas.0.tax_amount"] ?? "", /7\.00/);
});

test("con tasa 0 el impuesto tiene que ser 0 — espejo del CHECK de la base", () => {
  const r = validarLineas([draft({ amount: "100", tax_rate: "0", tax_amount: "7" })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors?.["lineas.0.tax_amount"]);
});

test("una tasa fuera de [0,1] se rechaza — se guarda decimal, no porcentaje", () => {
  const r = validarLineas([draft({ tax_rate: "7" })]);
  assert.equal(r.ok, false);
  assert.match(r.errors?.["lineas.0.tax_rate"] ?? "", /decimal/);
});

test("la tasa NO está limitada a la whitelist de compras", () => {
  // `business_expenses` fija [0, 0.07, 0.10, 0.15] en el código. Acá no: Rose
  // pidió no fijar el ITBMS porque el sistema se puede vender a otra empresa.
  const r = validarLineas([draft({ amount: "100", tax_rate: "0.05", tax_amount: "5.00" })]);
  assert.equal(r.ok, true);
});

test("una descripción demasiado corta se rechaza", () => {
  assert.ok(validarLineas([draft({ description: "ab" })]).errors?.["lineas.0.description"]);
});

test("más de MAX_LINEAS líneas se rechaza con un mensaje de documento", () => {
  const muchas = Array.from({ length: MAX_LINEAS + 1 }, (_, i) =>
    draft({ key: `k${i}`, amount: "1" })
  );
  const r = validarLineas(muchas);
  assert.equal(r.ok, false);
  assert.match(r.errors?.["lineas"] ?? "", new RegExp(String(MAX_LINEAS)));
});

// ===========================================================================
// Presentación
// ===========================================================================

test("una línea sin cuenta se muestra 'Sin clasificar', no con un guion", () => {
  // El guion se leería como "no aplica". Acá aplica y falta: es un estado que
  // alguien tiene que resolver.
  assert.equal(
    cuentaLabel({ chart_account_code: null, chart_account_name: null }),
    LABEL_SIN_CLASIFICAR
  );
  assert.notEqual(LABEL_SIN_CLASIFICAR, "—");
});

test("con cuenta se muestra código y nombre", () => {
  assert.equal(
    cuentaLabel({ chart_account_code: "130003", chart_account_name: "Fondo Legales de Clientes" }),
    "130003 · Fondo Legales de Clientes"
  );
});

test("con cuenta pero sin nombre resuelto se muestra solo el código", () => {
  assert.equal(cuentaLabel({ chart_account_code: "130003", chart_account_name: null }), "130003");
});

test("haySinClasificar detecta las líneas del backfill histórico", () => {
  assert.equal(haySinClasificar([{ chart_account_code: "130003" }]), false);
  assert.equal(
    haySinClasificar([{ chart_account_code: "130003" }, { chart_account_code: null }]),
    true
  );
});

test("la tasa se muestra como porcentaje", () => {
  assert.equal(tasaLabel(0.07), "7%");
  assert.equal(tasaLabel(0), "0%");
  assert.equal(tasaLabel(0.075), "7.50%");
});

test("impuestoSugerido redondea a centavos y no explota con basura", () => {
  assert.equal(impuestoSugerido(100, 0.07), 7);
  assert.equal(impuestoSugerido(412.35, 0.07), 28.86);
  assert.equal(impuestoSugerido(NaN, 0.07), 0);
});

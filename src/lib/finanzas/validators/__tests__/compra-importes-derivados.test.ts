/**
 * LOS IMPORTES DEL ENCABEZADO DE UNA COMPRA SALEN DE LAS LÍNEAS.
 *
 * Hasta el 09/09/2026 el formulario de Gastos del Bufete tenía tres campos
 * editables en el encabezado —subtotal, tasa de ITBMS y monto de ITBMS— que
 * convivían con las líneas sin estar conectados a ellas.
 *
 * Eso no era sólo doble carga: `business_expenses_tax_consistency_check` acopla
 * los tres campos, y con la tasa tipeada a mano rechazaba compras legítimas. Los
 * dos casos de abajo se MIDIERON contra staging ese día, insertando filas de
 * verdad dentro de una transacción con ROLLBACK:
 *
 *   · Todas las líneas exentas + tasa de encabezado en 7% (el valor por DEFECTO
 *     del formulario)                                        → la base rechazaba
 *   · Líneas mixtas + tasa de encabezado en 0%               → la base rechazaba
 *
 * La regla que arregla los dos: el encabezado se DERIVA.
 *
 *   subtotal   = Σ amount de las líneas
 *   tax_amount = Σ tax_amount de las líneas
 *   tax_rate   = 0 si no hay ITBMS; si hay, la tasa más alta entre las líneas
 *                que efectivamente lo pagan
 *
 * ⚠️ Este test fija la REGLA, no el formulario. La misma derivación está en tres
 * lugares (pantalla, validador y `api/business-expenses.ts`) porque cada uno la
 * necesita por un motivo distinto —mostrar sin esperar, validar, y no confiar en
 * la red—. Si alguna vez divergen, la compra se guarda con un encabezado que no
 * es la suma de sus partes y el asiento deja de cuadrar contra su propio
 * documento.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateCreateBusinessExpense } from "@/lib/finanzas/validators/business-expense";

/**
 * Un id de código de impuesto plausible. Desde la migración `045` cada línea de
 * compra lo lleva; acá el validador solo mira la forma (uuid) — que exista y
 * qué tasa tiene lo resuelve el servidor contra `tax_codes`.
 */
const TAX_CODE_ID = "44444444-4444-4444-4444-444444444444";

/** Una compra mínima válida. Los importes del encabezado NO se pasan a propósito. */
function compra(lineasSinCodigo: {
  description: string;
  chart_account_code: string;
  amount: number;
  tax_rate: number;
  tax_amount: number;
}[]) {
  const lineas = lineasSinCodigo.map((l) => ({ ...l, tax_code_id: TAX_CODE_ID }));
  return {
    expense_date: "2026-09-09",
    due_date: null,
    supplier_id: null,
    supplier_name: "Proveedor de prueba",
    supplier_ruc: null,
    supplier_invoice_number: null,
    description: "Compra de prueba",
    lineas,
    status: "pagado",
    payment_date: "2026-09-09",
    payment_method: "transferencia",
    notes: null,
  } as unknown as Parameters<typeof validateCreateBusinessExpense>[0];
}

const GRAVADA = {
  description: "Internet de agosto",
  chart_account_code: "610005",
  amount: 25,
  tax_rate: 0.07,
  tax_amount: 1.75,
};
const EXENTA = {
  description: "Tasa municipal",
  chart_account_code: "610001",
  amount: 10,
  tax_rate: 0,
  tax_amount: 0,
};

test("mixta (una gravada + una exenta): es el caso de la factura del internet de Josuarth", () => {
  const r = validateCreateBusinessExpense(compra([GRAVADA, EXENTA]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data!.subtotal, 35);
  assert.equal(r.data!.tax_amount, 1.75);
  // La tasa del encabezado es la de la línea que SÍ paga ITBMS. Con 0 acá, la
  // base rechazaría la fila entera.
  assert.equal(r.data!.tax_rate, 0.07);
});

test("todas exentas: la tasa del encabezado cae a 0 sola", () => {
  const r = validateCreateBusinessExpense(compra([EXENTA, { ...EXENTA, amount: 25 }]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data!.subtotal, 35);
  assert.equal(r.data!.tax_amount, 0);
  // 🔴 Éste es el caso que el valor por defecto del formulario (7%) rompía.
  assert.equal(r.data!.tax_rate, 0);
});

test("todas gravadas a la misma tasa: se comporta igual que antes del cambio", () => {
  const r = validateCreateBusinessExpense(compra([GRAVADA, { ...GRAVADA, amount: 75, tax_amount: 5.25 }]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data!.subtotal, 100);
  assert.equal(r.data!.tax_amount, 7);
  assert.equal(r.data!.tax_rate, 0.07);
});

test("los importes del encabezado que mande el cliente se IGNORAN", () => {
  const inflada = {
    ...(compra([GRAVADA, EXENTA]) as unknown as Record<string, unknown>),
    subtotal: 99999,
    tax_rate: 0.15,
    tax_amount: 88888,
  } as unknown as Parameters<typeof validateCreateBusinessExpense>[0];
  const r = validateCreateBusinessExpense(inflada);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data!.subtotal, 35);
  assert.equal(r.data!.tax_amount, 1.75);
  assert.equal(r.data!.tax_rate, 0.07);
});

test("tasas distintas entre líneas gravadas: manda la más alta", () => {
  const r = validateCreateBusinessExpense(
    compra([GRAVADA, { ...GRAVADA, tax_rate: 0.1, amount: 100, tax_amount: 10 }])
  );
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data!.tax_amount, 11.75);
  assert.equal(r.data!.tax_rate, 0.1);
});

test("una tasa de línea fuera de 0..1 se rechaza nombrando la línea", () => {
  const r = validateCreateBusinessExpense(compra([{ ...GRAVADA, tax_rate: 7 }]));
  assert.equal(r.ok, false);
  assert.match(r.errors!["lineas.0.tax_rate"] ?? "", /Línea 1/);
});

test("ITBMS sin ninguna línea que declare tasa: se corta con mensaje propio", () => {
  const r = validateCreateBusinessExpense(compra([{ ...GRAVADA, tax_rate: 0, tax_amount: 1.75 }]));
  assert.equal(r.ok, false);
  assert.match(r.errors!.tax_amount ?? "", /ninguna línea tiene tasa/);
});

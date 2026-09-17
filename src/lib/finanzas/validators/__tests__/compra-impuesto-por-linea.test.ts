/**
 * EL IMPUESTO DE UNA LÍNEA DE COMPRA ES UN CÓDIGO DEL CATÁLOGO, NO UN NÚMERO.
 *
 * Desde la migración `045` `expense_lines` tiene `tax_code_id`, y en una línea
 * de COMPRA es obligatorio: es lo que permite que el desplegable salga de
 * `tax_codes` (si Rose cambia la tasa en Configuración → Impuestos, compras la
 * sigue) y que `EXENTO` e `ITBMS_0` dejen de ser indistinguibles.
 *
 * Este archivo fija tres cosas del validador puro:
 *   1. Una línea de compra sin `tax_code_id` se rechaza, nombrando la línea.
 *   2. El ITBMS tecleado se verifica con tolerancia contra `amount × tax_rate`
 *      (±0,02, el mismo margen que trámite). Hasta el 16/09/2026 compras NO lo
 *      hacía: cualquier importe pasaba.
 *   3. En TRÁMITE el código es opcional: las líneas históricas quedaron en NULL
 *      y el ITBMS de un adelanto es pass-through. Pero si viene, tiene forma
 *      de uuid.
 *
 * Que el código exista, sea del bufete y esté activo NO se prueba acá: eso lo
 * resuelve el servidor contra la base (`business-expense-gate.test.ts`).
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateCreateBusinessExpense } from "@/lib/finanzas/validators/business-expense";
import { lineaVacia, validarLineas } from "@/lib/finanzas/validators/expense-line";
import { CUENTA_TRAMITE_DEFAULT } from "@/lib/finanzas/types/expense-line";

const ITBMS_7 = "44444444-4444-4444-4444-444444444444";
const EXENTO = "55555555-5555-5555-5555-555555555555";

function compra(lineas: Record<string, unknown>[]) {
  return {
    expense_date: "2026-09-16",
    due_date: null,
    supplier_id: null,
    supplier_name: "Cable & Wireless",
    supplier_ruc: null,
    supplier_invoice_number: null,
    description: "Internet de agosto",
    lineas,
    status: "pagado",
    payment_date: "2026-09-16",
    payment_method: "transferencia",
    notes: null,
  } as unknown as Parameters<typeof validateCreateBusinessExpense>[0];
}

const LINEA_OK = {
  description: "Internet de agosto",
  chart_account_code: "610005",
  amount: 25,
  tax_code_id: ITBMS_7,
  tax_rate: 0.07,
  tax_amount: 1.75,
};

// ---------------------------------------------------------------------------
// Compras: obligatorio
// ---------------------------------------------------------------------------

test("🔴 una línea de compra sin código de impuesto se rechaza, nombrando la línea", () => {
  const r = validateCreateBusinessExpense(
    compra([LINEA_OK, { ...LINEA_OK, description: "Tasa municipal", tax_code_id: "" }])
  );
  assert.equal(r.ok, false);
  assert.equal(r.errors?.["lineas.0.tax_code_id"], undefined, "la primera está bien");
  assert.match(r.errors?.["lineas.1.tax_code_id"] ?? "", /Línea 2/);
  assert.match(r.errors?.["lineas.1.tax_code_id"] ?? "", /impuesto/);
});

test("un tax_code_id que no tiene forma de uuid se rechaza igual que uno vacío", () => {
  const r = validateCreateBusinessExpense(compra([{ ...LINEA_OK, tax_code_id: "ITBMS_7" }]));
  assert.equal(r.ok, false);
  assert.ok(r.errors?.["lineas.0.tax_code_id"]);
});

test("con código en todas las líneas, la compra mixta del internet valida", () => {
  const r = validateCreateBusinessExpense(
    compra([
      LINEA_OK,
      { description: "Tasa municipal (exenta)", chart_account_code: "610001", amount: 10, tax_code_id: EXENTO, tax_rate: 0, tax_amount: 0 },
    ])
  );
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(
    r.data?.lineas.map((l) => l.tax_code_id),
    [ITBMS_7, EXENTO],
    "cada línea conserva su código"
  );
  assert.equal(r.data?.subtotal, 35);
  assert.equal(r.data?.tax_amount, 1.75);
});

// ---------------------------------------------------------------------------
// Compras: el ITBMS se verifica contra la tasa, con tolerancia
// ---------------------------------------------------------------------------

test("🔴 un ITBMS que no calza con base × tasa se rechaza y el mensaje dice cuánto sería", () => {
  const r = validateCreateBusinessExpense(compra([{ ...LINEA_OK, tax_amount: 7 }]));
  assert.equal(r.ok, false);
  assert.match(r.errors?.["lineas.0.tax_amount"] ?? "", /1\.75/);
});

test("un redondeo distinto del proveedor (±0,02) se acepta: el comprobante manda", () => {
  const r = validateCreateBusinessExpense(compra([{ ...LINEA_OK, tax_amount: 1.77 }]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data?.lineas[0].tax_amount, 1.77, "se guarda el del comprobante, no el calculado");
});

// ---------------------------------------------------------------------------
// Trámite: opcional
// ---------------------------------------------------------------------------

test("en trámite el código es OPCIONAL: sin él la línea valida y queda en null", () => {
  const r = validarLineas([
    { ...lineaVacia("l0", CUENTA_TRAMITE_DEFAULT), description: "Timbres fiscales", amount: "100" },
  ]);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data?.lineas[0].tax_code_id, null);
});

test("en trámite, si el código viene, tiene que tener forma de uuid", () => {
  const r = validarLineas([
    {
      ...lineaVacia("l0", CUENTA_TRAMITE_DEFAULT),
      description: "Timbres fiscales",
      amount: "100",
      tax_code_id: "EXENTO",
    },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors?.["lineas.0.tax_code_id"]);
});

test("lineaVacia() precarga el impuesto por defecto: id Y snapshot de la tasa", () => {
  const l = lineaVacia("l0", "", { id: ITBMS_7, rate: 0.07 });
  assert.equal(l.tax_code_id, ITBMS_7);
  assert.equal(l.tax_rate, "0.07");
  // Sin default, arranca sin impuesto elegido y con tasa 0 — lo que había antes.
  const sin = lineaVacia("l1");
  assert.equal(sin.tax_code_id, "");
  assert.equal(sin.tax_rate, "0");
});

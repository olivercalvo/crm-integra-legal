/**
 * UNA COMPRA NUEVA NACE «PENDIENTE DE PAGO» (05/10/2026).
 *
 * El formulario de Gastos del Bufete arrancaba en «Pagado», y en el alta
 * «pagado» no es un estado: es la orden de registrar un PAGO por el total
 * (048). Quien cargaba una factura del proveedor sin mirar el botón terminaba
 * con un CE-/PA- y un asiento contra el banco que nadie pidió. La base decía lo
 * mismo (DEFAULT 'pagado' desde la 010) y el guard de la 048 rechaza ese valor
 * al crear, así que un INSERT que no nombraba la columna fallaba.
 *
 * Tres puertas, la misma regla (ESTADO_INICIAL_DE_COMPRA):
 *   · la pantalla arranca en «Pendiente de pago»;
 *   · la API toma un body SIN `status` como pendiente (no como error ni pagado);
 *   · la base, desde la 093, tiene DEFAULT 'pendiente_pago'.
 * La importación de compras no existe (la de Excel es de asientos, 067).
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateCreateBusinessExpense,
  ESTADO_INICIAL_DE_COMPRA,
} from "@/lib/finanzas/validators/business-expense";

const ROOT = resolve(__dirname, "../../../../..");
const leer = (ruta: string) => readFileSync(resolve(ROOT, ruta), "utf8").replace(/\r\n/g, "\n");

function compra(extra: Record<string, unknown>) {
  return {
    expense_date: "2026-10-05",
    due_date: null,
    supplier_id: "d2222222-2222-2222-2222-222222222222",
    supplier_name: null,
    supplier_ruc: null,
    supplier_invoice_number: "F-1",
    description: "Compra de prueba",
    lineas: [
      {
        description: "Papelería",
        chart_account_code: "610005",
        amount: 10,
        tax_code_id: "44444444-4444-4444-4444-444444444444",
        tax_rate: 0.07,
        tax_amount: 0.7,
      },
    ],
    payment_method: null,
    notes: null,
    ...extra,
  } as unknown as Parameters<typeof validateCreateBusinessExpense>[0];
}

test("el estado inicial es pendiente_pago", () => {
  assert.equal(ESTADO_INICIAL_DE_COMPRA, "pendiente_pago");
});

test("🔴 API: sin `status` la compra queda pendiente, sin pago y sin pedir banco", () => {
  const r = validateCreateBusinessExpense(compra({}));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.data?.status, "pendiente_pago");
  assert.equal(r.data?.payment_date, null);
  assert.equal(r.data?.payment_account_code ?? null, null);
});

test("API: `status` vacío o null, lo mismo", () => {
  for (const status of ["", null]) {
    const r = validateCreateBusinessExpense(compra({ status }));
    assert.equal(r.data?.status, "pendiente_pago", `status=${JSON.stringify(status)}`);
  }
});

test("API: «pagado» sigue siendo una decisión explícita, y pide el banco", () => {
  const r = validateCreateBusinessExpense(compra({ status: "pagado", payment_date: "2026-10-05" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors?.payment_account_code, "sin banco no se registra el pago");
});

test("API: un estado inventado se sigue rechazando", () => {
  const r = validateCreateBusinessExpense(compra({ status: "parcialmente_pagado" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors?.status);
});

test("🔴 pantalla: el formulario arranca en ESTADO_INICIAL_DE_COMPRA, nunca en «pagado»", () => {
  const form = leer("src/app/finanzas/gastos-bufete/_components/business-expense-form.tsx");
  assert.match(form, /useState<BusinessExpenseStatus>\(init\?\.status \?\? ESTADO_INICIAL_DE_COMPRA\)/);
  assert.doesNotMatch(form, /useState<BusinessExpenseStatus>\([^)]*"pagado"/);
});

test("🔴 alta en el servidor: el INSERT manda pendiente_pago (el guard de la 048 rechaza otra cosa)", () => {
  const api = leer("src/lib/finanzas/api/business-expenses.ts");
  const insert = api.slice(api.indexOf('.from("business_expenses")\n    .insert('));
  assert.match(insert.slice(0, 2500), /status: "pendiente_pago"/);
});

test("base: la 093 cambia el DEFAULT a pendiente_pago", () => {
  const sql = leer("sql/pending/093_compra_nace_pendiente.sql");
  assert.match(sql, /ALTER COLUMN status SET DEFAULT 'pendiente_pago'/);
});

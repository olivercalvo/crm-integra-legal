/**
 * Validador del pago a proveedor (Bloque 3): banco obligatorio, monto > 0,
 * método de la lista, uuid de la compra. El cap por saldo es del servidor.
 * Y "pagado" en el ALTA de la compra exige banco (validators/business-expense).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateCreateSupplierPayment } from "@/lib/finanzas/validators/supplier-payment";
import { validateCreateBusinessExpense } from "@/lib/finanzas/validators/business-expense";

const COMPRA = "55555555-5555-5555-5555-555555555555";
const base = {
  business_expense_id: COMPRA,
  payment_date: "2026-09-21",
  amount: 400.004,
  method: "transferencia",
  payment_account_code: "100001",
  reference: "  ref  ",
  notes: null,
};

test("caso feliz: redondea el monto y limpia la referencia", () => {
  const r = validateCreateSupplierPayment(base as never);
  assert.equal(r.ok, true);
  assert.equal(r.data?.amount, 400);
  assert.equal(r.data?.reference, "ref");
  assert.equal(r.data?.payment_account_code, "100001");
});

test("🔴 sin banco → error: el banco vive en el pago y no se deduce", () => {
  const r = validateCreateSupplierPayment({ ...base, payment_account_code: "" } as never);
  assert.equal(r.ok, false);
  assert.match(r.errors?.payment_account_code ?? "", /cuenta bancaria de donde salió el pago/);
});

test("monto cero o negativo, método inválido, compra inválida, fecha inválida", () => {
  const r = validateCreateSupplierPayment({ ...base, amount: 0, method: "trueque", business_expense_id: "x", payment_date: "ayer" } as never);
  assert.equal(r.ok, false);
  assert.ok(r.errors?.amount);
  assert.ok(r.errors?.method);
  assert.ok(r.errors?.business_expense_id);
  assert.ok(r.errors?.payment_date);
});

test("en el alta de la compra, 'pagado' sin banco se rechaza; 'parcialmente_pagado' nunca se manda", () => {
  const compra = {
    expense_date: "2026-09-21",
    description: "Insumos de septiembre",
    supplier_name: "PROVEEDOR, S.A.",
    lineas: [{ description: "Papel", chart_account_code: "610001", amount: 100, tax_code_id: "11111111-1111-1111-1111-111111111111" }],
    status: "pagado",
    payment_date: "2026-09-21",
    payment_method: "transferencia",
    notes: null,
  };
  const sinBanco = validateCreateBusinessExpense(compra as never);
  assert.equal(sinBanco.ok, false);
  assert.match(sinBanco.errors?.payment_account_code ?? "", /cuenta bancaria/);

  const parcial = validateCreateBusinessExpense({ ...compra, status: "parcialmente_pagado", payment_account_code: "100001" } as never);
  assert.equal(parcial.ok, false);
  assert.ok(parcial.errors?.status, "lo deriva el trigger; no es un valor de entrada");

  const pendiente = validateCreateBusinessExpense({ ...compra, status: "pendiente_pago", payment_date: null, payment_method: null } as never);
  assert.equal(pendiente.errors?.payment_account_code, undefined, "pendiente no pide banco");
});

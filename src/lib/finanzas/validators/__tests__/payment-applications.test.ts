/**
 * El validador del cobro con VARIAS facturas (Parte B del Bloque 2, 21/09/2026).
 *
 * Lo que fija:
 *   · una o varias aplicaciones, sin repetir, cada monto > 0 (el CHECK de la
 *     tabla lo prohíbe: una fila en 0 se saca, no se manda);
 *   · `amount` ≥ suma de las aplicaciones. Desde la 074 (Oliver, 01/10/2026) el
 *     EXCEDENTE se permite: queda como saldo a favor del cliente. Lo que se
 *     sigue rechazando es aplicar más de lo que entró.
 *   · La referencia es OBLIGATORIA (074).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateCreatePayment, MAX_APPLICATIONS } from "@/lib/finanzas/validators/payment";

const F1 = "11111111-1111-1111-1111-111111111111";
const F2 = "11111111-1111-1111-1111-222222222222";

const base = {
  payment_date: "2026-09-21",
  method: "transferencia",
  payment_account_code: "100001",
  reference: "TRF-001",
  notes: null,
};

test("una factura: igual que siempre", () => {
  const r = validateCreatePayment({ ...base, amount: 250, applications: [{ invoice_id: F1, amount: 250 }] } as never);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data?.applications, [{ invoice_id: F1, amount: 250 }]);
});

test("dos facturas cuya suma es el total: pasa, con montos redondeados", () => {
  const r = validateCreatePayment({
    ...base,
    amount: 1500,
    applications: [
      { invoice_id: F1, amount: 1070 },
      { invoice_id: F2, amount: 430.004 },
    ],
  } as never);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data?.applications.map((a) => a.amount), [1070, 430]);
});

test("🟢 074: excedente: la transferencia supera la suma → PASA (el resto queda a favor del cliente)", () => {
  const r = validateCreatePayment({
    ...base,
    amount: 1500,
    applications: [{ invoice_id: F1, amount: 1355 }],
  } as never);
  assert.equal(r.ok, true);
  assert.equal(r.data?.amount, 1500);
  assert.deepEqual(r.data?.applications, [{ invoice_id: F1, amount: 1355 }]);
});

test("🔴 074: sin referencia → rechazo (es lo que concilia contra el banco)", () => {
  for (const reference of [null, "", "   "]) {
    const r = validateCreatePayment({ ...base, reference, amount: 250, applications: [{ invoice_id: F1, amount: 250 }] } as never);
    assert.equal(r.ok, false);
    assert.match(r.errors?.reference ?? "", /obligatoria/);
  }
});

test("faltante: lo aplicado supera el total → rechazo", () => {
  const r = validateCreatePayment({
    ...base,
    amount: 1000,
    applications: [
      { invoice_id: F1, amount: 700 },
      { invoice_id: F2, amount: 400 },
    ],
  } as never);
  assert.equal(r.ok, false);
  assert.match(r.errors?.amount ?? "", /sobran B\/\. 100\.00/);
});

test("sin aplicaciones → error", () => {
  const r = validateCreatePayment({ ...base, amount: 100, applications: [] } as never);
  assert.equal(r.ok, false);
  assert.match(r.errors?.applications ?? "", /al menos una factura/);
});

test("factura repetida → error", () => {
  const r = validateCreatePayment({
    ...base,
    amount: 200,
    applications: [
      { invoice_id: F1, amount: 100 },
      { invoice_id: F1, amount: 100 },
    ],
  } as never);
  assert.equal(r.ok, false);
  assert.match(r.errors?.applications ?? "", /dos veces/);
});

test("un monto en cero → error (el CHECK de la tabla lo prohíbe)", () => {
  const r = validateCreatePayment({
    ...base,
    amount: 100,
    applications: [
      { invoice_id: F1, amount: 100 },
      { invoice_id: F2, amount: 0 },
    ],
  } as never);
  assert.equal(r.ok, false);
  assert.match(r.errors?.applications ?? "", /línea 2/);
});

test("uuid inválido → error", () => {
  const r = validateCreatePayment({ ...base, amount: 100, applications: [{ invoice_id: "x", amount: 100 }] } as never);
  assert.equal(r.ok, false);
  assert.match(r.errors?.applications ?? "", /Factura inválida/);
});

test(`más de ${MAX_APPLICATIONS} facturas → error`, () => {
  const apps = Array.from({ length: MAX_APPLICATIONS + 1 }, (_, i) => ({
    invoice_id: `11111111-1111-1111-1111-${String(i).padStart(12, "0")}`,
    amount: 1,
  }));
  const r = validateCreatePayment({ ...base, amount: apps.length, applications: apps } as never);
  assert.equal(r.ok, false);
});

test("los errores de aplicaciones no producen además un error de monto engañoso", () => {
  const r = validateCreatePayment({ ...base, amount: 100, applications: [{ invoice_id: "x", amount: 50 }] } as never);
  assert.equal(r.ok, false);
  assert.equal(r.errors?.amount, undefined);
});

/**
 * El validador del cobro con VARIAS facturas (Parte B del Bloque 2, 21/09/2026).
 *
 * Lo que fija:
 *   · una o varias aplicaciones, sin repetir, cada monto > 0 (el CHECK de la
 *     tabla lo prohíbe: una fila en 0 se saca, no se manda);
 *   · `amount` == suma de las aplicaciones. El EXCEDENTE se rechaza —no hay
 *     dónde ponerlo hasta que Josuarth defina anticipos— y el mensaje dice los
 *     dos montos y la salida (SOP-027): otra factura del mismo cliente por el
 *     resto, o ajustar el monto. El faltante también se rechaza.
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
  reference: null,
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

test("🔴 excedente: la transferencia supera la suma → rechazo que nombra los dos montos y la salida", () => {
  const r = validateCreatePayment({
    ...base,
    amount: 1500,
    applications: [{ invoice_id: F1, amount: 1355 }],
  } as never);
  assert.equal(r.ok, false);
  const msg = r.errors?.amount ?? "";
  assert.match(msg, /1,500\.00/);
  assert.match(msg, /1,355\.00/);
  assert.match(msg, /145\.00/, "dice cuánto falta aplicar");
  assert.match(msg, /otra factura pendiente del mismo cliente/);
  assert.match(msg, /ajuste el monto/);
  assert.match(msg, /concili/, "explica por qué: la conciliación bancaria");
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

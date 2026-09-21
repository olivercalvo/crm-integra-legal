/**
 * El reparto por antigüedad (Parte B del Bloque 2): de la más vieja a la más
 * nueva, llenando cada saldo; y la validación que dice si lo repartido —o lo
 * corregido a mano— cierra contra la transferencia.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ordenarPorAntiguedad,
  repartirPorAntiguedad,
  validarReparto,
  aplicacionesParaEnviar,
  sumaAplicada,
} from "@/lib/finanzas/cobros/repartir-por-antiguedad";

const MAYO = { id: "mayo", invoice_number: "FAC-HON-000002", issue_date: "2026-05-20", balance_due: 1605 };
const JULIO = { id: "julio", invoice_number: "FAC-HON-000005", issue_date: "2026-07-05", balance_due: 500 };
const SEPT = { id: "sept", invoice_number: "FAC-HON-000009", issue_date: "2026-09-10", balance_due: 107 };

test("ordena por fecha y, a igual fecha, por número", () => {
  const mismoDia = { ...SEPT, id: "sept-b", invoice_number: "FAC-HON-000008" };
  assert.deepEqual(
    ordenarPorAntiguedad([SEPT, MAYO, mismoDia, JULIO]).map((f) => f.id),
    ["mayo", "julio", "sept-b", "sept"]
  );
});

test("la suma exacta de tres facturas: cada una queda saldada, cero tecleo", () => {
  const r = repartirPorAntiguedad(2212, [SEPT, JULIO, MAYO]);
  assert.deepEqual(r, [
    { invoice_id: "mayo", amount: 1605 },
    { invoice_id: "julio", amount: 500 },
    { invoice_id: "sept", amount: 107 },
  ]);
  assert.equal(validarReparto(2212, r, [SEPT, JULIO, MAYO]).ok, true);
});

test("menos que la suma: llena la más vieja, la siguiente queda parcial, la última en 0", () => {
  const r = repartirPorAntiguedad(1800, [SEPT, JULIO, MAYO]);
  assert.deepEqual(r, [
    { invoice_id: "mayo", amount: 1605 },
    { invoice_id: "julio", amount: 195 },
    { invoice_id: "sept", amount: 0 },
  ]);
  const v = validarReparto(1800, r, [SEPT, JULIO, MAYO]);
  assert.equal(v.ok, true, "un pago parcial de la última es válido");
  // La fila en 0 no viaja: el CHECK de la tabla la prohíbe.
  assert.deepEqual(aplicacionesParaEnviar(r).map((a) => a.invoice_id), ["mayo", "julio"]);
});

test("🔴 más que la suma: el resto NO se reparte y la validación lo rechaza con la salida", () => {
  const r = repartirPorAntiguedad(2500, [MAYO, JULIO]);
  assert.equal(sumaAplicada(r), 2105);
  const v = validarReparto(2500, r, [MAYO, JULIO]);
  assert.equal(v.ok, false);
  assert.equal(v.diferencia, 395);
  assert.match(v.mensaje ?? "", /2,500\.00/);
  assert.match(v.mensaje ?? "", /2,105\.00/);
  assert.match(v.mensaje ?? "", /395\.00/);
  assert.match(v.mensaje ?? "", /otra factura pendiente del mismo cliente/);
  assert.match(v.mensaje ?? "", /ajuste el monto/);
});

test("corregido a mano: mover plata de mayo a julio cierra igual", () => {
  const r = [
    { invoice_id: "mayo", amount: 1000 },
    { invoice_id: "julio", amount: 500 },
  ];
  assert.equal(validarReparto(1500, r, [MAYO, JULIO]).ok, true);
});

test("corregido a mano por encima del saldo de una factura → error en esa factura", () => {
  const r = [
    { invoice_id: "mayo", amount: 1000 },
    { invoice_id: "julio", amount: 600 },
  ];
  const v = validarReparto(1600, r, [MAYO, JULIO]);
  assert.equal(v.ok, false);
  assert.match(v.porFactura.julio, /Supera el saldo de FAC-HON-000005/);
  assert.match(v.porFactura.julio, /500\.00/);
});

test("aplicado por encima del total → 'sobran' (faltante)", () => {
  const r = [
    { invoice_id: "mayo", amount: 1000 },
    { invoice_id: "julio", amount: 500 },
  ];
  const v = validarReparto(1200, r, [MAYO, JULIO]);
  assert.equal(v.ok, false);
  assert.match(v.mensaje ?? "", /sobran B\/\. 300\.00/);
});

test("centavos: no acumula error de redondeo", () => {
  const a = { ...MAYO, balance_due: 0.1 };
  const b = { ...JULIO, balance_due: 0.2 };
  const r = repartirPorAntiguedad(0.3, [a, b]);
  assert.deepEqual(r.map((x) => x.amount), [0.1, 0.2]);
  assert.equal(validarReparto(0.3, r, [a, b]).ok, true);
});

test("total en cero o negativo: nada aplicado y mensaje", () => {
  const v = validarReparto(0, repartirPorAntiguedad(0, [MAYO]), [MAYO]);
  assert.equal(v.ok, false);
  assert.match(v.mensaje ?? "", /por lo menos una factura/);
});

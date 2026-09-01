/**
 * Tests de la verificación de `invoices.amount_paid` contra sus pagos.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 *   El guard T4b (migración 032) impide que `amount_paid` se escriba a mano, y
 *   los dos seeds corren esta verificación al terminar. Pero los seeds solo
 *   corren cuando alguien los corre: sin un test, la lógica que detecta el
 *   desfase podría romperse y nadie se enteraría hasta la próxima siembra.
 *
 *   El caso 2 es, literalmente, el bug del 28/08/2026: FAC-REI-000001 con
 *   `amount_paid = 150.00` y cero aplicaciones de pago.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/integridad/__tests__/amount-paid-derivado.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  desfasesDeAmountPaid,
  formatearDesfases,
} from "@/lib/finanzas/integridad/amount-paid-derivado";

const factura = (
  id: string,
  invoice_number: string,
  amount_paid: number | string,
  status = "emitida"
) => ({ id, invoice_number, status, amount_paid });

const aplicacion = (invoice_id: string, amount_applied: number | string) => ({
  invoice_id,
  amount_applied,
});

test("una factura cuyo amount_paid coincide con su pago no es un desfase", () => {
  const desfases = desfasesDeAmountPaid(
    [factura("i1", "FAC-HON-000001", 1070, "pagada")],
    [aplicacion("i1", 1070)]
  );
  assert.deepEqual(desfases, []);
});

test("EL BUG DEL 28/08: amount_paid > 0 sin ninguna aplicación de pago", () => {
  const desfases = desfasesDeAmountPaid(
    [factura("i1", "FAC-REI-000001", 150, "pagada")],
    []
  );
  assert.equal(desfases.length, 1);
  assert.deepEqual(desfases[0], {
    invoice_number: "FAC-REI-000001",
    status: "pagada",
    amount_paid: 150,
    suma_aplicada: 0,
    diferencia: 150,
  });
});

test("una factura sin pagos y en cero está bien: es el estado normal de una emitida", () => {
  const desfases = desfasesDeAmountPaid([factura("i1", "FAC-HON-000003", 0)], []);
  assert.deepEqual(desfases, []);
});

test("varias aplicaciones sobre la misma factura se suman antes de comparar", () => {
  const desfases = desfasesDeAmountPaid(
    [factura("i1", "FAC-HON-000002", 1500, "parcialmente_pagada")],
    [aplicacion("i1", 1000), aplicacion("i1", 500)]
  );
  assert.deepEqual(desfases, []);
});

test("el desfase también se detecta al revés: pago aplicado que no se reflejó", () => {
  const desfases = desfasesDeAmountPaid(
    [factura("i1", "FAC-HON-000002", 0)],
    [aplicacion("i1", 1000)]
  );
  assert.equal(desfases.length, 1);
  assert.equal(desfases[0].diferencia, -1000);
  assert.equal(desfases[0].suma_aplicada, 1000);
});

test("las aplicaciones de OTRA factura no se cuentan en esta", () => {
  const desfases = desfasesDeAmountPaid(
    [factura("i1", "FAC-HON-000001", 0), factura("i2", "FAC-HON-000002", 500)],
    [aplicacion("i2", 500)]
  );
  assert.deepEqual(desfases, []);
});

test("acepta los numéricos como strings, que es como los devuelve PostgREST", () => {
  // `numeric(12,2)` llega como "1070.00", no como 1070. Si la comparación fuera
  // con === sobre el valor crudo, TODAS las facturas darían desfase.
  const desfases = desfasesDeAmountPaid(
    [factura("i1", "FAC-HON-000001", "1070.00", "pagada")],
    [aplicacion("i1", "1070.00")]
  );
  assert.deepEqual(desfases, []);
});

test("tolera el ruido de punto flotante, no una diferencia real de un centavo", () => {
  const ruido = desfasesDeAmountPaid(
    [factura("i1", "FAC-HON-000001", 1070.001)],
    [aplicacion("i1", 1070)]
  );
  assert.deepEqual(ruido, [], "0.001 es ruido de coma flotante, no un desfase");

  const centavo = desfasesDeAmountPaid(
    [factura("i1", "FAC-HON-000001", 1070.01)],
    [aplicacion("i1", 1070)]
  );
  assert.equal(centavo.length, 1, "un centavo de verdad SÍ es un desfase");
  assert.equal(centavo[0].diferencia, 0.01);
});

test("varios desfases salen ordenados por número de factura", () => {
  const desfases = desfasesDeAmountPaid(
    [factura("i2", "FAC-REI-000001", 150), factura("i1", "FAC-HON-000009", 99)],
    []
  );
  assert.deepEqual(
    desfases.map((d) => d.invoice_number),
    ["FAC-HON-000009", "FAC-REI-000001"]
  );
});

test("el mensaje nombra la factura y dice qué hacer, no solo que está mal", () => {
  const mensaje = formatearDesfases(
    desfasesDeAmountPaid([factura("i1", "FAC-REI-000001", 150, "pagada")], [])
  );
  assert.match(mensaje, /FAC-REI-000001/);
  assert.match(mensaje, /SEED_PAYMENTS/, "tiene que decir dónde se agrega el pago que falta");
  assert.match(mensaje, /T4b/, "tiene que explicar por qué no alcanza con escribir la columna");
});

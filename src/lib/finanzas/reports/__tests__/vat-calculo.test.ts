/**
 * 🔒 EL RESUMEN DE ITBMS RESTA LAS NOTAS DE CRÉDITO (25/09/2026).
 *
 *   npm test
 *
 * Hasta hoy el resumen no leía `credit_notes`: una NC de venta no restaba
 * ITBMS. Regla de Oliver: débito = facturas autorizadas − NC autorizadas y
 * vigentes del período; las anuladas no cuentan; la NC cuenta en SU mes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  comprasDelPeriodo,
  cuentaLaNotaDeVenta,
  ventasDelPeriodo,
  type FacturaParaItbms,
  type NotaDeVentaParaItbms,
} from "../vat-calculo";

const factura = (over: Partial<FacturaParaItbms> = {}): FacturaParaItbms => ({
  status: "emitida",
  issue_date: "2026-09-10",
  subtotal_total: 1000,
  tax_total: 70,
  ...over,
});

const nc = (over: Partial<NotaDeVentaParaItbms> = {}): NotaDeVentaParaItbms => ({
  status: "emitida",
  fe_estado: "authorized",
  factura_status: "emitida",
  issue_date: "2026-09-20",
  subtotal_total: 1000,
  tax_total: 70,
  ...over,
});

test("período con una NC TOTAL: el ITBMS débito de esa factura queda en cero", () => {
  const r = ventasDelPeriodo([factura()], [nc()], "2026-09");
  assert.deepEqual(r, { ventas: 0, gravadas: 0, itbms: 0 });
});

test("período con una NC PARCIAL: resta sólo lo acreditado", () => {
  const r = ventasDelPeriodo(
    [factura({ subtotal_total: 2000, tax_total: 140 })],
    [nc({ subtotal_total: 500, tax_total: 35 })],
    "2026-09"
  );
  assert.deepEqual(r, { ventas: 1500, gravadas: 1500, itbms: 105 });
});

test("período con una NC ANULADA (reversada): no resta nada", () => {
  const r = ventasDelPeriodo([factura()], [nc({ status: "anulada", fe_estado: "canceled" })], "2026-09");
  assert.deepEqual(r, { ventas: 1000, gravadas: 1000, itbms: 70 });
});

test("NC de un mes distinto al de su factura: cuenta en el mes DE LA NC", () => {
  const facturas = [factura({ issue_date: "2026-08-15" })];
  const notas = [nc({ issue_date: "2026-09-05", subtotal_total: 400, tax_total: 28 })];

  // Agosto: la factura entera, la NC todavía no.
  assert.deepEqual(ventasDelPeriodo(facturas, notas, "2026-08"), { ventas: 1000, gravadas: 1000, itbms: 70 });
  // Septiembre: sólo la NC, en negativo.
  assert.deepEqual(ventasDelPeriodo(facturas, notas, "2026-09"), { ventas: -400, gravadas: -400, itbms: -28 });
});

test("una factura ANULADA no cuenta, y la NC de su anulación tampoco resta", () => {
  const r = ventasDelPeriodo(
    [factura({ status: "anulada" }), factura({ subtotal_total: 300, tax_total: 21 })],
    // La NC total de la anulación: emitida, interna, factura anulada.
    [nc({ fe_estado: "no_emitida", factura_status: "anulada" })],
    "2026-09"
  );
  assert.deepEqual(r, { ventas: 300, gravadas: 300, itbms: 21 });
});

test("una NC interna (no autorizada por la DGI) no resta", () => {
  assert.equal(cuentaLaNotaDeVenta({ status: "emitida", fe_estado: "no_emitida", factura_status: "emitida" }), false);
  assert.equal(cuentaLaNotaDeVenta({ status: "emitida", fe_estado: "authorized", factura_status: "pagada" }), true);
});

test("borradores y canceladas antes de emitir no cuentan", () => {
  const r = ventasDelPeriodo(
    [factura({ status: "borrador" }), factura({ status: "cancelada_pre_emision" }), factura({ status: "pagada" })],
    [],
    "2026-09"
  );
  assert.equal(r.itbms, 70);
});

test("compras: el crédito fiscal resta las NC de compra vigentes", () => {
  const r = comprasDelPeriodo(
    [{ subtotal: 1000, tax_amount: 70, base_gravada: 1000 }],
    [
      { status: "emitida", subtotal_total: 200, tax_total: 14, base_gravada: 200 },
      { status: "anulada", subtotal_total: 999, tax_total: 99 },
    ]
  );
  assert.deepEqual(r, { compras: 800, gravadas: 800, itbms: 56 });
});

test("🔒 el reporte usa estas funciones, no una suma propia", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const src = readFileSync(path.resolve(__dirname, "../vat-summary.ts"), "utf8");
  assert.match(src, /ventasDelPeriodo\(/);
  assert.match(src, /comprasDelPeriodo\(/);
  assert.match(src, /from\("credit_notes"\)/, "el reporte lee las notas de crédito");
  assert.doesNotMatch(src, /taxCollectedPos|taxCollectedNeg/, "no queda la suma vieja");
});

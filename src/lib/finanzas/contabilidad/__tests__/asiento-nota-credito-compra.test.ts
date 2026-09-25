/**
 * 🔒 NC DE COMPRA (3.5): montos, topes y asiento.
 *
 *   npm test
 *
 * El asiento es el de la compra sobre lo acreditado, AL REVÉS. Nada restado a
 * mano. La base (066) calcula los mismos montos y verifica el asiento.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  calcularNcDeCompra,
  construirAsientoDeNotaDeCompra,
  itbmsDeLineaDeNc,
  type LineaDeCompraParaNc,
} from "../asiento-nota-credito-compra";
import { construirAsientoDeCompra } from "../asiento-compra";

const linea = (over: Partial<LineaDeCompraParaNc> = {}): LineaDeCompraParaNc => ({
  id: "l1",
  line_order: 1,
  description: "Papelería",
  chart_account_code: "600001",
  amount: 100,
  tax_rate: 0.07,
  tax_amount: 7,
  acreditado_base: 0,
  acreditado_itbms: 0,
  cuenta_valida: true,
  ...over,
});
const COMPRA = { id: "c1", description: "Insumos de oficina", supplier_name: "Proveedor S.A.", supplier_id: "p1" };
const HOY = "2026-09-25";

test("NC parcial: ITBMS por la tasa de la línea", () => {
  const r = calcularNcDeCompra([linea()], [{ expense_line_id: "l1", amount: 40 }], 107);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual([r.subtotal, r.itbms, r.total], [40, 2.8, 42.8]);
});

test("NC de TODO lo que queda: el ITBMS es el remanente exacto, no el recalculado", () => {
  // La compra se cargó con 7.01 de ITBMS (tolerancia ±0,02): recalcular daría 7.00
  // y dejaría un centavo de saldo que nadie debe.
  const l = linea({ tax_amount: 7.01 });
  assert.equal(itbmsDeLineaDeNc(l, 100), 7.01);
  const r = calcularNcDeCompra([l], [{ expense_line_id: "l1", amount: 100 }], 107.01);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.total, 107.01);
});

test("🔴 tope por línea: no se acredita más de lo que queda de la base", () => {
  const r = calcularNcDeCompra(
    [linea({ acreditado_base: 70, acreditado_itbms: 4.9 })],
    [{ expense_line_id: "l1", amount: 40 }],
    107
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /hasta B\/\. 30\.00 de base/);
});

test("🔴 tope del documento: no más que lo que falta pagar (J-3)", () => {
  const r = calcularNcDeCompra([linea()], [{ expense_line_id: "l1", amount: 100 }], 50);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /supera lo que falta pagar/);
});

test("una línea que no es de la compra se rechaza", () => {
  const r = calcularNcDeCompra([linea()], [{ expense_line_id: "otra", amount: 1 }], 107);
  assert.equal(r.ok, false);
});

test("🔒 el asiento de una NC TOTAL es exactamente el de la compra al revés", () => {
  const lineas = [linea(), linea({ id: "l2", line_order: 2, chart_account_code: "600002", amount: 50, tax_amount: 0, tax_rate: 0 })];
  const calc = calcularNcDeCompra(lineas, [{ expense_line_id: "l1", amount: 100 }, { expense_line_id: "l2", amount: 50 }], 157);
  assert.ok(calc.ok);
  if (!calc.ok) return;
  const nc = construirAsientoDeNotaDeCompra(COMPRA, HOY, calc);
  const compra = construirAsientoDeCompra({
    id: "c1", expense_date: HOY, description: COMPRA.description, total: 157, supplier_name: COMPRA.supplier_name,
    lineas: lineas.map((l) => ({ line_order: l.line_order, description: l.description, amount: l.amount, tax_amount: l.tax_amount, chart_account_code: l.chart_account_code, cuenta_valida: true })),
  });
  assert.ok(nc.ok && compra.ok);
  if (!nc.ok || !compra.ok) return;
  const par = (ls: { account_code: string; debit: number; credit: number }[]) =>
    ls.map((l) => `${l.account_code}:${l.debit}:${l.credit}`).sort();
  const invertida = compra.asiento.lines.map((l) => ({ account_code: l.account_code, debit: l.credit, credit: l.debit }));
  assert.deepEqual(par(nc.asiento.lines), par(invertida));
  assert.equal(nc.asiento.source_type, "nota_credito_proveedor");
});

test("el asiento: DEBE 200001 con el proveedor, HABER 200003 y la cuenta de la línea; cuadra", () => {
  const calc = calcularNcDeCompra([linea()], [{ expense_line_id: "l1", amount: 40 }], 107);
  assert.ok(calc.ok);
  if (!calc.ok) return;
  const r = construirAsientoDeNotaDeCompra(COMPRA, HOY, calc);
  assert.ok(r.ok);
  if (!r.ok) return;
  const cxp = r.asiento.lines.find((l) => l.account_code === "200001");
  const itbms = r.asiento.lines.find((l) => l.account_code === "200003");
  const gasto = r.asiento.lines.find((l) => l.account_code === "600001");
  assert.deepEqual([cxp?.debit, cxp?.supplier_id], [42.8, "p1"]);
  assert.equal(itbms?.credit, 2.8);
  assert.equal(gasto?.credit, 40);
  const d = r.asiento.lines.reduce((s, l) => s + l.debit, 0);
  const c = r.asiento.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(d * 100), Math.round(c * 100));
  assert.equal(r.asiento.transaction_date, HOY, "la NC se registra con la fecha de hoy (J-2)");
});

test("una cuenta inactiva en la línea: rechaza con el mensaje de la compra", () => {
  const calc = calcularNcDeCompra([linea({ cuenta_valida: false })], [{ expense_line_id: "l1", amount: 10 }], 107);
  assert.ok(calc.ok);
  if (!calc.ok) return;
  const r = construirAsientoDeNotaDeCompra(COMPRA, HOY, calc);
  assert.equal(r.ok, false);
});

test("🔒 una sola implementación: la pantalla y el servidor usan calcularNcDeCompra", () => {
  const raiz = path.resolve(__dirname, "../../../../..");
  const pantalla = readFileSync(path.join(raiz, "src/app/finanzas/gastos-bufete/_components/supplier-credit-notes-section.tsx"), "utf8");
  const api = readFileSync(path.join(raiz, "src/lib/finanzas/api/supplier-credit-notes.ts"), "utf8");
  assert.match(pantalla, /calcularNcDeCompra\(/);
  assert.match(api, /calcularNcDeCompra\(/);
  assert.match(api, /construirAsientoDeNotaDeCompra\(/);
  assert.match(api, /construirAsientoDeReversion\(/, "la reversión usa la misma función que el resto del libro");
  assert.doesNotMatch(pantalla, /\* *0\.07|tax_rate \*/, "la pantalla no calcula el ITBMS por su cuenta");
});

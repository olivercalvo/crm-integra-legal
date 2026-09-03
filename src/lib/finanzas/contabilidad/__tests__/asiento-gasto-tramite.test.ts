/**
 * El asiento de un gasto de trámite.
 *
 * Lo que protege, en orden de importancia:
 *
 *   1. 🔴 **Una línea sin cuenta NO se postea.** Es la razón de ser del NULL: sin
 *      este rechazo, el NULL sería solo una columna vacía. Con él, impide que un
 *      gasto que nadie clasificó entre al libro contra una cuenta inventada — en
 *      un libro que después no se puede corregir.
 *   2. La forma del asiento del acta: N débitos contra un crédito único a
 *      `200001`, cuadrando por construcción.
 *   3. El ITBMS va al débito de su línea y NO a una cuenta de crédito fiscal.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  construirAsientoDeGastoTramite,
  descripcionDelAsiento,
  SOURCE_TYPE_GASTO_TRAMITE,
  type GastoParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-gasto-tramite";
import { CUENTA_POR_PAGAR } from "@/lib/finanzas/types/expense-line";
import type { ExpenseLineRow } from "@/lib/finanzas/types/expense-line";

const GASTO: GastoParaAsiento = {
  id: "e1",
  date: "2026-03-15",
  concept: "Trámites Registro Público",
  case_code: "CIV-014",
  supplier_legal_name: "MICROSISTEMAS S.A.",
};

function linea(over: Partial<ExpenseLineRow> = {}): ExpenseLineRow {
  const amount = over.amount ?? 100;
  const tax = over.tax_amount ?? 0;
  return {
    id: "l" + Math.random(),
    line_order: 1,
    description: "Timbres fiscales",
    chart_account_code: "130003",
    chart_account_name: "Fondo Legales de Clientes",
    amount,
    tax_rate: 0,
    tax_amount: tax,
    line_total: amount + tax,
    ...over,
  };
}

// ===========================================================================
// 1. 🔴 EL RECHAZO QUE JUSTIFICA EL NULL
// ===========================================================================

test("una línea SIN cuenta contable NO produce asiento", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1, chart_account_code: null, chart_account_name: null }),
  ]);

  assert.equal(
    r.ok,
    false,
    "\n🔴 Se armó un asiento con una línea sin clasificar.\n" +
      "   Ese rechazo es la razón de ser del NULL: sin él, un gasto que nadie\n" +
      "   clasificó entra al libro contra una cuenta inventada, y el libro no se\n" +
      "   puede corregir después.\n"
  );
  if (!r.ok) assert.equal(r.motivo, "sin_clasificar");
});

test("el mensaje dice CUÁNTAS y CUÁLES líneas faltan", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1 }),
    linea({ line_order: 2, chart_account_code: null }),
    linea({ line_order: 3, chart_account_code: null }),
  ]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.lineasSinCuenta, [2, 3]);
  assert.match(r.mensaje, /2 líneas sin cuenta contable/);
  assert.match(r.mensaje, /2, 3/);
  assert.match(r.mensaje, /Clasifíquelas antes de registrarlo en el libro/);
});

test("con UNA sola línea sin cuenta, el mensaje va en singular", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1 }),
    linea({ line_order: 2, chart_account_code: null }),
  ]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.mensaje, /1 línea sin cuenta contable/);
  assert.match(r.mensaje, /Clasifíquela antes/);
});

test("basta UNA línea sin cuenta entre varias clasificadas para rechazar todo", () => {
  // El asiento es atómico: no se postea "la parte que se puede".
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1, amount: 400 }),
    linea({ line_order: 2, amount: 500, chart_account_code: null }),
    linea({ line_order: 3, amount: 600 }),
  ]);
  assert.equal(r.ok, false);
});

// ===========================================================================
// 2. LA FORMA DEL ASIENTO
// ===========================================================================

test("el gasto del 15/03 con sus tres cuentas: 3 débitos + 1 crédito a 200001", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1, description: "Útiles", chart_account_code: "610001", amount: 412.35 }),
    linea({ line_order: 2, description: "Honorario", chart_account_code: "500005", amount: 900 }),
    linea({ line_order: 3, description: "Mensajería", chart_account_code: "610002", amount: 185.5 }),
  ]);

  assert.equal(r.ok, true);
  if (!r.ok) return;

  const debitos = r.asiento.lines.filter((l) => l.debit > 0);
  const creditos = r.asiento.lines.filter((l) => l.credit > 0);

  assert.equal(debitos.length, 3);
  assert.equal(creditos.length, 1, "un solo crédito, por la suma");
  assert.equal(creditos[0].account_code, CUENTA_POR_PAGAR);
  assert.equal(creditos[0].account_code, "200001");
  assert.equal(creditos[0].credit, 1497.85);

  assert.deepEqual(
    debitos.map((d) => [d.account_code, d.debit]),
    [
      ["610001", 412.35],
      ["500005", 900],
      ["610002", 185.5],
    ]
  );
});

test("cuadra: la suma de débitos es igual a la de créditos", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1, amount: 412.35 }),
    linea({ line_order: 2, amount: 900 }),
    linea({ line_order: 3, amount: 185.5 }),
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const d = r.asiento.lines.reduce((s, l) => s + l.debit, 0);
  const c = r.asiento.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(d * 100), Math.round(c * 100));
});

test("cada línea del asiento es débito O crédito, nunca las dos ni ninguna", () => {
  // Lo exige el RPC. Si se rompe acá, el error vuelve desde Postgres.
  const r = construirAsientoDeGastoTramite(GASTO, [linea(), linea({ line_order: 2 })]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  for (const l of r.asiento.lines) {
    const esDebito = l.debit > 0 && l.credit === 0;
    const esCredito = l.credit > 0 && l.debit === 0;
    assert.ok(esDebito !== esCredito ? true : false, `línea ambigua: ${JSON.stringify(l)}`);
  }
});

test("dos líneas con la MISMA cuenta NO se consolidan", () => {
  // A propósito: cada renglón conserva su descripción, que es lo que Josuarth
  // pidió ver en el mayor ("se abren las fracciones").
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1, description: "Timbres", amount: 100 }),
    linea({ line_order: 2, description: "Mensajería", amount: 50 }),
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const debitos = r.asiento.lines.filter((l) => l.debit > 0);
  assert.equal(debitos.length, 2, "no se agrupan por cuenta");
  assert.deepEqual(debitos.map((d) => d.description), ["Timbres", "Mensajería"]);
});

test("la cuenta por pagar es un parámetro, no un literal regado", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [linea()], "299999");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.asiento.lines.find((l) => l.credit > 0)?.account_code, "299999");
});

// ===========================================================================
// 3. EL ITBMS
// ===========================================================================

test("el ITBMS va al débito de SU línea, no a una cuenta de crédito fiscal", () => {
  // En un gasto de trámite el impuesto es pass-through: el bufete paga 107 por
  // cuenta del cliente y le refactura 107 exento. Es lo que hace que este bloque
  // NO dependa de la consulta pendiente al contador sobre el crédito fiscal.
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1, amount: 100, tax_rate: 0.07, tax_amount: 7, line_total: 107 }),
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const debitos = r.asiento.lines.filter((l) => l.debit > 0);
  assert.equal(debitos.length, 1, "el impuesto no abre una línea propia");
  assert.equal(debitos[0].debit, 107, "el débito es base + ITBMS");
  assert.equal(debitos[0].account_code, "130003");

  assert.ok(
    !r.asiento.lines.some((l) => l.account_code === "200003"),
    "🔴 el ITBMS de un gasto de trámite NO toca 200003: esa es la cuenta del ITBMS que el bufete COBRÓ y le debe a la DGI"
  );
});

// ===========================================================================
// 4. Metadatos del asiento
// ===========================================================================

test("source_type es `gasto_tramite` y NO `gasto`", () => {
  // `gasto` ya está tomado por business_expenses, y destino-documento.ts lo usa
  // para decidir a qué pantalla lleva el ícono del mayor.
  const r = construirAsientoDeGastoTramite(GASTO, [linea()]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.asiento.source_type, SOURCE_TYPE_GASTO_TRAMITE);
  assert.equal(r.asiento.source_type, "gasto_tramite");
  assert.notEqual(r.asiento.source_type, "gasto");
});

test("source_id es el id del gasto — es lo que hace valer el UNIQUE de la 034", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [linea()]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.asiento.source_id, "e1");
});

test("la fecha del asiento es la del GASTO, no la de hoy", () => {
  // Art. 5.1: la fecha de la operación define el período contable. La de
  // registro la pone el RPC por su cuenta (doble fecha, Art. 13a).
  const r = construirAsientoDeGastoTramite(GASTO, [linea()]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.asiento.transaction_date, "2026-03-15");
});

test("la descripción nombra el caso, el concepto y el proveedor (Art. 5.5)", () => {
  const d = descripcionDelAsiento(GASTO);
  assert.match(d, /CIV-014/);
  assert.match(d, /Trámites Registro Público/);
  assert.match(d, /MICROSISTEMAS/);
});

test("sin proveedor ni caso, la descripción sigue siendo legible", () => {
  const d = descripcionDelAsiento({
    ...GASTO,
    case_code: null,
    supplier_legal_name: null,
  });
  assert.match(d, /Gasto de trámite/);
  assert.match(d, /Trámites Registro Público/);
  assert.ok(!d.includes("null"));
});

// ===========================================================================
// 5. Casos límite
// ===========================================================================

test("sin líneas no hay asiento", () => {
  const r = construirAsientoDeGastoTramite(GASTO, []);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "sin_lineas");
});

test("un total de cero no se postea", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ amount: 0, tax_amount: 0, line_total: 0 }),
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "monto_cero");
});

test("los centavos se redondean una vez, al armar cada línea", () => {
  const r = construirAsientoDeGastoTramite(GASTO, [
    linea({ line_order: 1, amount: 0.005, tax_amount: 0, line_total: 0.005 }),
    linea({ line_order: 2, amount: 10, tax_amount: 0, line_total: 10 }),
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const d = r.asiento.lines.reduce((s, l) => s + l.debit, 0);
  const c = r.asiento.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(d * 100), Math.round(c * 100), "tiene que cuadrar igual");
});

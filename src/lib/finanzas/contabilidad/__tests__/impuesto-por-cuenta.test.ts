/**
 * 🔒 CADA TASA CON SU CUENTA (Bloque 1, punto 6, migración 073).
 *
 *   1. Una factura con dos tasas de cuentas distintas genera DOS líneas de
 *      impuesto, una por cuenta, y sigue cuadrando.
 *   2. La compra debita las MISMAS cuentas (P-6a: la misma para ventas y
 *      compras), y la NC de venta, que invierte la factura, también.
 *   3. Con una sola cuenta el asiento es idéntico al de antes (200003, mismo
 *      texto): lo existente no cambia.
 *   4. UNA implementación: los dos constructores agrupan con `lineasDeImpuesto`
 *      y ninguno escribe la cuenta del impuesto en duro.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { lineasDeImpuesto, CUENTA_IMPUESTO_SIN_TASA } from "@/lib/finanzas/contabilidad/impuesto-por-cuenta";
import { construirAsientoDeFactura, type FacturaParaAsiento } from "@/lib/finanzas/contabilidad/asiento-factura";
import { construirAsientoDeCompra, type CompraParaAsiento } from "@/lib/finanzas/contabilidad/asiento-compra";
import { construirAsientoDeNotaDeCredito } from "@/lib/finanzas/contabilidad/asiento-nota-credito";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const FACTURA: FacturaParaAsiento = {
  id: "f1",
  invoice_number: "FAC-HON-000099",
  issue_date: "2026-10-01",
  accounting_date: "2026-10-01",
  grand_total: 217, // 100 + 7 (ITBMS_7 → 200003) + 100 + 10 (ITBMS_10 → 200005)
  client_name: "Cliente",
  client_id: "c1",
  lineas: [
    { line_order: 1, description: "Servicio A", subtotal: 100, tax_amount: 7, tax_account: "200003", tax_code: "ITBMS_7",
      service_code: "HON-A", revenue_account: "400001", cuenta_valida: true },
    { line_order: 2, description: "Servicio B", subtotal: 100, tax_amount: 10, tax_account: "200005", tax_code: "ITBMS_10",
      service_code: "HON-B", revenue_account: "400001", cuenta_valida: true },
  ],
};

test("lineasDeImpuesto agrupa por cuenta, ordena por cuenta y no deja líneas en cero", () => {
  const l = lineasDeImpuesto(
    [
      { tax_amount: 7, tax_account: "200003", tax_code: "ITBMS_7" },
      { tax_amount: 0, tax_account: "200009", tax_code: "EXENTO" },
      { tax_amount: 3.5, tax_account: "200003", tax_code: "ITBMS_7" },
      { tax_amount: 10, tax_account: "200005", tax_code: "ITBMS_10" },
    ],
    "credit",
    "ITBMS facturado"
  );
  assert.deepEqual(
    l.map((x) => [x.account_code, x.credit, x.description]),
    [
      ["200003", 10.5, "ITBMS facturado · ITBMS_7"],
      ["200005", 10, "Impuesto facturado · ITBMS_10"],
    ]
  );
});

test("una línea con impuesto y SIN tasa va a 200003, como siempre", () => {
  const l = lineasDeImpuesto([{ tax_amount: 7 }], "debit", "ITBMS de compras (crédito fiscal)");
  assert.equal(l[0].account_code, CUENTA_IMPUESTO_SIN_TASA);
  assert.equal(l[0].description, "ITBMS de compras (crédito fiscal)", "con una sola cuenta, el texto de siempre");
});

test("factura con dos tasas de cuentas distintas: dos líneas de impuesto y cuadra", () => {
  const r = construirAsientoDeFactura(FACTURA);
  assert.ok(r.ok);
  if (!r.ok) return;
  const imp = r.asiento.lines.filter((l) => l.account_code.startsWith("2000"));
  assert.deepEqual(imp.map((l) => [l.account_code, l.credit]), [["200003", 7], ["200005", 10]]);
  const d = r.asiento.lines.reduce((s, l) => s + l.debit, 0);
  const c = r.asiento.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(d * 100), Math.round(c * 100));
});

test("con una sola tasa el asiento es el de antes: 200003 y «ITBMS facturado»", () => {
  const r = construirAsientoDeFactura({
    ...FACTURA,
    grand_total: 107,
    lineas: [FACTURA.lineas[0]],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const imp = r.asiento.lines.find((l) => l.account_code === "200003");
  assert.equal(imp?.credit, 7);
  assert.equal(imp?.description, "ITBMS facturado");
});

test("la NC de venta debita las MISMAS cuentas que la factura acreditó", () => {
  const r = construirAsientoDeNotaDeCredito({
    id: "nc1",
    credit_note_number: "NC-000099",
    issue_date: "2026-10-02",
    accounting_date: "2026-10-02",
    grand_total: 217,
    client_id: "c1",
    invoice_number: FACTURA.invoice_number,
    client_name: "Cliente",
    lineas: FACTURA.lineas,
  } as never);
  assert.ok(r.ok);
  if (!r.ok) return;
  const imp = r.asiento.lines.filter((l) => l.account_code.startsWith("2000"));
  assert.deepEqual(imp.map((l) => [l.account_code, l.debit]), [["200003", 7], ["200005", 10]]);
});

test("la compra debita la cuenta de cada tasa (la misma de ventas, P-6a)", () => {
  const compra: CompraParaAsiento = {
    id: "c1",
    expense_date: "2026-10-01",
    accounting_date: "2026-10-01",
    description: "Insumos",
    total: 110,
    supplier_name: "PROV",
    supplier_id: "p1",
    lineas: [
      { line_order: 1, description: "Papel", amount: 100, tax_amount: 10, tax_account: "200005", tax_code: "ITBMS_10",
        chart_account_code: "610008", cuenta_valida: true },
    ],
  };
  const r = construirAsientoDeCompra(compra);
  assert.ok(r.ok);
  if (!r.ok) return;
  const imp = r.asiento.lines.find((l) => l.account_code === "200005");
  assert.equal(imp?.debit, 10);
  assert.equal(r.asiento.lines.some((l) => l.account_code === "200003"), false);
});

test("🔒 una sola implementación: los constructores usan lineasDeImpuesto y no escriben la cuenta en duro", () => {
  for (const f of ["asiento-factura.ts", "asiento-compra.ts"]) {
    const src = leer(`src/lib/finanzas/contabilidad/${f}`);
    assert.match(src, /lineasDeImpuesto\(/, `${f} no agrupa con lineasDeImpuesto`);
    assert.doesNotMatch(src, /account_code: CUENTA_ITBMS/, `${f} vuelve a escribir la cuenta del impuesto en duro`);
  }
  for (const f of ["factura-para-asiento.ts", "compra-para-asiento.ts"]) {
    assert.match(leer(`src/lib/finanzas/queries/${f}`), /cuentasDeTasas\(/, `${f} no resuelve la cuenta de la tasa`);
  }
  assert.match(leer("src/lib/finanzas/api/supplier-credit-notes.ts"), /cuentasDeTasas\(/, "la NC de compra no resuelve la cuenta de la tasa");
});

test("recorrido 01/10: una tasa con cuenta propia no se rotula «ITBMS»", () => {
  const l = lineasDeImpuesto([{ tax_amount: 10, tax_account: "200005", tax_code: "ISC_5_PRUEBA" }], "credit", "ITBMS facturado");
  assert.equal(l[0].description, "Impuesto facturado · ISC_5_PRUEBA");
});


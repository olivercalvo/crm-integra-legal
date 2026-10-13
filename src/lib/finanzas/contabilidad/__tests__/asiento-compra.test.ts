/**
 * COMPRA → ASIENTO.
 *
 * Lo que se fija acá:
 *
 *   1. **Que NO exista una cuenta por defecto.** Es la regla que más fácil se
 *      "arregla" después.
 *   2. Que el ITBMS de compras vaya al **DÉBITO** de `200003`, la MISMA cuenta
 *      que las ventas acreditan. Si alguien introduce una cuenta de crédito
 *      fiscal separada, este test falla — y tiene que fallar, porque eso
 *      deshace una decisión del contador.
 *   3. Que el mensaje nombre la línea y la cuenta.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUENTA_ITBMS,
  CUENTA_POR_PAGAR,
  SOURCE_TYPE_COMPRA,
  claveIdempotenteDeCompra,
  construirAsientoDeCompra,
  type CompraParaAsiento,
  type LineaCompraParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-compra";

const COMPRA_ID = "33333333-3333-3333-3333-333333333333";

function linea(p: Partial<LineaCompraParaAsiento> = {}): LineaCompraParaAsiento {
  return {
    line_order: 1,
    description: "Útiles de oficina",
    amount: 100,
    tax_amount: 7,
    chart_account_code: "610008",
    cuenta_valida: true,
    ...p,
  };
}

function compra(p: Partial<CompraParaAsiento> = {}): CompraParaAsiento {
  return {
    id: COMPRA_ID,
    expense_date: "2026-09-04",
    accounting_date: "2026-09-04",
    description: "Insumos de septiembre",
    total: 107,
    supplier_name: "DISTRIBUIDORA OFIPLUS, S.A.",
    supplier_id: "d2222222-2222-2222-2222-222222222222",
    lineas: [linea()],
    ...p,
  };
}

// ---------------------------------------------------------------------------
// Caso feliz
// ---------------------------------------------------------------------------

test("compra con ITBMS: DEBE gasto, DEBE ITBMS, HABER CxP", () => {
  const r = construirAsientoDeCompra(compra());
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.asiento.source_type, SOURCE_TYPE_COMPRA);
  assert.equal(r.asiento.source_id, COMPRA_ID);
  assert.equal(r.asiento.transaction_date, "2026-09-04");

  assert.deepEqual(
    r.asiento.lines.map((l) => [l.account_code, l.debit, l.credit]),
    [
      ["610008", 100, 0],
      [CUENTA_ITBMS, 7, 0],
      [CUENTA_POR_PAGAR, 0, 107],
    ]
  );
});

test("🔴 el ITBMS de compras va al DÉBITO de 200003 — una sola cuenta", () => {
  assert.equal(
    CUENTA_ITBMS,
    "200003",
    "es la misma cuenta que acreditan las ventas: Josuarth, 25/08"
  );
  const r = construirAsientoDeCompra(compra());
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const itbms = r.asiento.lines.filter((l) => l.account_code === CUENTA_ITBMS);
  assert.equal(itbms.length, 1, "no se parte en dos cuentas");
  assert.ok(itbms[0].debit > 0, "va al DÉBITO, no al crédito");
  assert.equal(itbms[0].credit, 0);
});

test("compra exenta: sin línea de ITBMS", () => {
  const r = construirAsientoDeCompra(
    compra({
      total: 1850,
      lineas: [linea({ description: "Alquiler", amount: 1850, tax_amount: 0, chart_account_code: "610001" })],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(!r.asiento.lines.some((l) => l.account_code === CUENTA_ITBMS));
  assert.deepEqual(
    r.asiento.lines.map((l) => l.account_code),
    ["610001", CUENTA_POR_PAGAR]
  );
});

test("tres líneas contra UNA sola cuenta por pagar — el caso de la compra #3", () => {
  const r = construirAsientoDeCompra(
    compra({
      description: "Compra consolidada de insumos y servicios",
      total: 1497.85,
      lineas: [
        linea({ line_order: 1, amount: 412.35, tax_amount: 0, chart_account_code: "610008" }),
        linea({ line_order: 2, amount: 900, tax_amount: 0, chart_account_code: "610002" }),
        linea({ line_order: 3, amount: 185.5, tax_amount: 0, chart_account_code: "500003" }),
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const debitos = r.asiento.lines.filter((l) => l.debit > 0);
  const creditos = r.asiento.lines.filter((l) => l.credit > 0);
  assert.equal(debitos.length, 3);
  assert.equal(creditos.length, 1);
  assert.equal(creditos[0].account_code, CUENTA_POR_PAGAR);
  assert.equal(creditos[0].credit, 1497.85);
});

test("E2: dos líneas con la misma cuenta van en DOS líneas del libro, cada una con su descripción", () => {
  // Hasta E2 se agrupaban por cuenta. Josuarth (28/09, punto 3) pidió ver en el
  // Mayor la descripción de cada línea del documento.
  const r = construirAsientoDeCompra(
    compra({
      total: 214,
      lineas: [
        linea({ line_order: 1, amount: 100, tax_amount: 7, description: "Resmas de papel" }),
        linea({ line_order: 2, amount: 100, tax_amount: 7, description: "Tóner" }),
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const gasto = r.asiento.lines.filter((l) => l.account_code === "610008");
  assert.deepEqual(gasto.map((l) => [l.debit, l.description]), [[100, "Resmas de papel"], [100, "Tóner"]]);
  // El total por cuenta no cambia.
  assert.equal(gasto.reduce((s, l) => s + l.debit, 0), 200);
});

test("E2: el proveedor va en la línea de 200001, y sólo ahí", () => {
  const r = construirAsientoDeCompra(compra());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const control = r.asiento.lines.filter((l) => l.account_code === "200001");
  assert.equal(control.length, 1);
  assert.equal(control[0].supplier_id, "d2222222-2222-2222-2222-222222222222");
  assert.ok(r.asiento.lines.filter((l) => l.account_code !== "200001").every((l) => !l.supplier_id && !l.client_id));
});

test("🔴 E3: una compra sin ficha de proveedor NO se registra (200001 nunca sin tercero)", () => {
  const r = construirAsientoDeCompra(compra({ supplier_id: null }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_proveedor");
  assert.match(r.mensaje, /Cuentas por pagar \(200001\)/);
});

// ---------------------------------------------------------------------------
// 🔴 Los rechazos
// ---------------------------------------------------------------------------

test("🔴 NO hay cuenta por defecto: una cuenta inválida nunca postea a un genérico", () => {
  const r = construirAsientoDeCompra(
    compra({ lineas: [linea({ chart_account_code: "4101", cuenta_valida: false })] })
  );
  assert.equal(r.ok, false, "una cuenta inválida NO se resuelve con una genérica");
});

test("cuenta inválida: el mensaje nombra la LÍNEA y la CUENTA", () => {
  const r = construirAsientoDeCompra(
    compra({
      lineas: [
        linea({ line_order: 1 }),
        linea({ line_order: 2, chart_account_code: "9999", cuenta_valida: false }),
      ],
    })
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "cuenta_invalida");
  assert.match(r.mensaje, /línea 2/);
  assert.match(r.mensaje, /9999/);
});

test("línea sin cuenta → RECHAZA nombrando la línea", () => {
  const r = construirAsientoDeCompra(
    compra({
      lineas: [linea({ line_order: 3, description: "Algo", chart_account_code: null })],
    })
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_cuenta");
  assert.match(r.mensaje, /línea 3/);
});

test("compra sin líneas → RECHAZA", () => {
  const r = construirAsientoDeCompra(compra({ lineas: [] }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_lineas");
});

test("total que no coincide con las líneas → RECHAZA sin postear", () => {
  const r = construirAsientoDeCompra(compra({ total: 500 }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "no_cuadra");
  assert.match(r.mensaje, /500\.00/);
  assert.match(r.mensaje, /107\.00/);
});

// ---------------------------------------------------------------------------
// Idempotencia y forma
// ---------------------------------------------------------------------------

test("source_type es 'gasto', no 'compra'", () => {
  assert.equal(
    SOURCE_TYPE_COMPRA,
    "gasto",
    "'compra' no está en el CHECK de journal_entries y 'gasto' ya significa business_expenses"
  );
});

test("las dos llaves salen del mismo id", () => {
  assert.equal(claveIdempotenteDeCompra(COMPRA_ID), `compra:${COMPRA_ID}`);
  const r = construirAsientoDeCompra(compra());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.asiento.source_id, COMPRA_ID);
  assert.equal(r.asiento.idempotency_key, `compra:${COMPRA_ID}`);
});

test("centavos: tres líneas con decimales cuadran", () => {
  const r = construirAsientoDeCompra(
    compra({
      total: 107,
      lineas: [
        linea({ line_order: 1, amount: 33.33, tax_amount: 2.33 }),
        linea({ line_order: 2, amount: 33.33, tax_amount: 2.33, chart_account_code: "610002" }),
        linea({ line_order: 3, amount: 33.34, tax_amount: 2.34, chart_account_code: "500003" }),
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const d = r.asiento.lines.reduce((s, l) => s + l.debit, 0);
  const c = r.asiento.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(d * 100), Math.round(c * 100));
});

test("E1: el asiento lleva la fecha de REGISTRO, no la del documento", () => {
  const r = construirAsientoDeCompra(compra({ expense_date: "2026-09-28", accounting_date: "2026-10-01" }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.asiento.transaction_date, "2026-10-01");
});

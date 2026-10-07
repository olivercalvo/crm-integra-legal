/**
 * 🔒 POSTEO DE DOCUMENTOS EXISTENTES, POR MES (097).
 *
 *   npm test
 *
 * Lo que fija:
 *   1. El rango de un mes (incluido febrero bisiesto) y el orden cronológico.
 *   2. Los totales por cuenta del Excel en seco.
 *   3. Las dos facturas sin DGI que se listan aparte, y que las duplicadas sí
 *      postean (no están en la lista).
 *   4. Leyendo el código: cada asiento sale del MISMO constructor que usa la
 *      app al emitir o registrar (no hay un segundo armado que algún día
 *      discrepe), el lote va por el RPC de la 097 (una transacción), los
 *      documentos de prueba quedan fuera y los cobros de Legal ni se leen.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  FACTURAS_SIN_DGI_EXCLUIDAS,
  ordenarItems,
  rangoDelMes,
  totalesPorCuenta,
  type ItemPlan,
} from "../posteo-retroactivo";

const fuente = readFileSync(path.join(process.cwd(), "src/lib/finanzas/contabilidad/posteo-retroactivo.ts"), "utf8").replace(/\r\n/g, "\n");

function item(tipo: ItemPlan["tipo"], numero: string, fecha: string, lineas: [string, number, number][]): ItemPlan {
  return {
    tipo,
    documentoId: numero,
    numero,
    fecha,
    fechaDocumento: fecha,
    asiento: {
      transaction_date: fecha,
      description: numero,
      source_type: tipo,
      source_id: numero,
      lines: lineas.map(([account_code, debit, credit]) => ({ account_code, debit, credit, description: null })),
    } as unknown as ItemPlan["asiento"],
  };
}

test("rangoDelMes: primer y último día, febrero bisiesto, y formato inválido", () => {
  assert.deepEqual(rangoDelMes("2026-07"), { desde: "2026-07-01", hasta: "2026-07-31" });
  assert.deepEqual(rangoDelMes("2026-09"), { desde: "2026-09-01", hasta: "2026-09-30" });
  assert.deepEqual(rangoDelMes("2028-02"), { desde: "2028-02-01", hasta: "2028-02-29" });
  assert.throws(() => rangoDelMes("2026-13"));
  assert.throws(() => rangoDelMes("07/2026"));
});

test("ordenarItems: por fecha; el mismo día, factura antes que su cobro", () => {
  const r = ordenarItems([
    item("cobro", "CO-1", "2026-07-10", []),
    item("factura", "FAC-2", "2026-07-11", []),
    item("factura", "FAC-1", "2026-07-10", []),
    item("compra", "FAC-CO-1", "2026-07-01", []),
  ]);
  assert.deepEqual(r.map((x) => x.numero), ["FAC-CO-1", "FAC-1", "CO-1", "FAC-2"]);
});

test("totalesPorCuenta: suma por cuenta, redondeada, en orden de código", () => {
  const t = totalesPorCuenta([
    item("factura", "A", "2026-07-01", [["100004", 10.1, 0], ["400001", 0, 10.1]]),
    item("factura", "B", "2026-07-02", [["100004", 0.2, 0], ["400001", 0, 0.2]]),
  ]);
  assert.deepEqual(t, [
    { cuenta: "100004", debito: 10.3, credito: 0 },
    { cuenta: "400001", debito: 0, credito: 10.3 },
  ]);
});

test("las facturas sin DGI que se listan aparte son exactamente dos; las duplicadas sí postean", () => {
  assert.deepEqual([...FACTURAS_SIN_DGI_EXCLUIDAS].sort(), ["FAC-HON-000496", "FAC-HON-000508"]);
  for (const dup of ["FAC-HON-000489", "FAC-HON-000503", "FAC-HON-000463"]) {
    assert.ok(!FACTURAS_SIN_DGI_EXCLUIDAS.includes(dup), `${dup} tiene que postear`);
  }
});

test("cada asiento sale del constructor de la app, no de uno propio", () => {
  for (const f of [
    "construirAsientoDeFactura",
    "construirAsientoDeNotaDeCredito",
    "construirAsientoDeCobro",
    "construirAsientoDeCompra",
    "construirAsientoDeGastoTramite",
    "construirAsientoDePagoProveedor",
    "construirAsientoDeReversion",
  ]) {
    assert.match(fuente, new RegExp(`${f}\\(`), `falta ${f}`);
  }
  // Ninguna línea armada a mano con una cuenta literal.
  assert.doesNotMatch(fuente, /account_code:\s*["']\d{6}["']/);
});

test("el lote va por el RPC de la 097, nunca por post_journal_entry suelto", () => {
  assert.match(fuente, /rpc\("post_documentos_existentes"/);
  assert.doesNotMatch(fuente, /rpc\("post_journal_entry"/);
});

test("documentos de prueba fuera y cobros de Legal ni se leen", () => {
  for (const t of ["invoices", "credit_notes", "payments", "expenses"]) {
    assert.match(fuente, new RegExp(`from\\("${t}"\\)`));
  }
  assert.ok((fuente.match(/de_prueba\)/g) ?? []).length >= 4, "cada tipo con marca de prueba la mira");
  assert.doesNotMatch(fuente, /from\("client_payments"\)/);
});

test("las listas del plan se leen por páginas (PostgREST corta en 1000)", () => {
  // Cada lectura es paginada, o es de UNA fila, una escritura o una lista acotada por ids.
  const sinPaginar: string[] = [];
  const re = /\.from\("([a-z_]+)"\)/g;
  for (const m of Array.from(fuente.matchAll(re))) {
    const antes = fuente.slice(Math.max(0, m.index! - 80), m.index!);
    const sentencia = fuente.slice(m.index!, fuente.indexOf(";", m.index!));
    if (/paginado\(\(a, b\) =>\s*(db)?\s*$/.test(antes)) continue;
    if (/maybeSingle|\.single\(|\.update\(|\.in\("(id|code)"/.test(sentencia)) continue;
    if (m[1] === "accounting_periods") continue; // doce filas por año
    sinPaginar.push(`${m[1]}: ${sentencia.slice(0, 80)}`);
  }
  assert.deepEqual(sinPaginar, []);
});

test("098: el número del gasto se relee después de numerar (dos corridas a la vez no lo cambian)", () => {
  const i = fuente.indexOf("allocatePurchaseNumber(db");
  const tramo = fuente.slice(i, i + 1500);
  assert.match(tramo, /\.is\("purchase_number", null\)/);
  assert.match(tramo, /select\("purchase_number"\)/);
});

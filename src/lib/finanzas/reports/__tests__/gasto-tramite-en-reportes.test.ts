/**
 * El GASTO DE TRÁMITE en los reportes (Bloque 4, commit 5 — D4 y FND-010):
 *
 *   1. Mayor: el asiento `gasto_tramite` ofrece "Abrir el documento" hacia
 *      `/finanzas/gastos-tramite/{id}` (faltaba en DIRECTOS: 1.7 de la
 *      auditoría del 21/09) y su tipo se rotula "Gasto de trámite".
 *   2. Diario: la columna Documento lleva el CONCEPTO del gasto, truncado (D4
 *      de Oliver: el concepto, no el proveedor).
 *   3. Antigüedad por pagar: los gastos de trámite EN EL LIBRO entran al
 *      auxiliar con su saldo (`amount − amount_paid`), agrupados por su
 *      proveedor o como "(sin proveedor)"; los que no tienen asiento NO entran
 *      (no están en 200001); pagados y anulados tampoco. Es lo que cierra
 *      FND-010.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadDestinosDeOrigen } from "@/lib/finanzas/reports/libro-mayor-source";
import { tipoTransaccionLabel } from "@/lib/finanzas/reports/libro-mayor";
import { truncarDocumento } from "@/lib/finanzas/reports/diario-general-source";
import { loadAntiguedad } from "@/lib/finanzas/reports/antiguedad-source";

const TENANT = "t1";

/** Fake mínimo: cada tabla devuelve su lista completa; la lógica filtra. */
function fakeDb(datos: Record<string, unknown[]>) {
  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const op of ["select", "eq", "neq", "in", "not", "order", "is"]) q[op] = self;
    q.maybeSingle = async () => ({ data: (datos[nombre] ?? [])[0] ?? null, error: null });
    q.then = (r: (v: unknown) => unknown) => r({ data: datos[nombre] ?? [], error: null });
    return q;
  };
  return { from: tabla };
}

test("Mayor: el asiento de un gasto de trámite abre el gasto, y su tipo se rotula", async () => {
  const db = fakeDb({ expenses: [{ id: "t1" }], payment_applications: [], payment_reversals: [], payments: [], supplier_payments: [] });
  const destinos = await loadDestinosDeOrigen(db as never, TENANT, [
    { source_type: "gasto_tramite", source_id: "t1" },
    { source_type: "gasto_tramite", source_id: "t-borrado" },
  ] as never);
  assert.equal(destinos.get("t1"), "/finanzas/gastos-tramite/t1");
  assert.equal(destinos.has("t-borrado"), false, "un gasto que no existe no se enlaza");
  assert.equal(tipoTransaccionLabel("gasto_tramite"), "Gasto de trámite");
});

test("Diario: el concepto se trunca por palabra, con puntos suspensivos", () => {
  assert.equal(truncarDocumento("Timbres", 40), "Timbres");
  assert.equal(
    truncarDocumento("Trámite Registro Público — aumento de capital (demostración)", 40),
    "Trámite Registro Público — aumento de…"
  );
  assert.equal(truncarDocumento("x".repeat(60), 40).length, 40, "sin espacios corta seco en el máximo");
});

test("🔒 Antigüedad por pagar: entran las compras y los gastos de trámite EN EL LIBRO, con su saldo y su tercero", async () => {
  const db = fakeDb({
    chart_of_accounts: [{ id: "cta-200001", code: "200001", name: "Cuentas por pagar", saldo_inicial: 0 }],
    journal_entry_lines: [],
    journal_entries: [],
    business_expenses: [
      { id: "c1", supplier_id: "prov-1", supplier_name: null, description: "Alquiler", expense_date: "2026-02-01", due_date: "2026-03-01", total: 1000, amount_paid: 400 },
    ],
    // El loader filtra por posted_entry_id/status en la base; el fake devuelve
    // todo y acá se comprueba que el saldo y el tercero salen bien.
    expenses: [
      { id: "t1", supplier_id: "prov-1", concept: "Timbres fiscales", date: "2026-09-01", due_date: null, amount: 300, amount_paid: 100, status: "parcialmente_pagado", posted_entry_id: "je-1" },
      { id: "t2", supplier_id: null, concept: "Mensajería", date: "2026-09-10", due_date: "2026-10-10", amount: 50, amount_paid: 0, status: "pendiente_pago", posted_entry_id: "je-2" },
    ],
    suppliers: [{ id: "prov-1", legal_name: "REGISTRO PÚBLICO", trade_name: null }],
    supplier_payments: [],
  });
  const { documentos } = await loadAntiguedad(db as never, TENANT, "pagar");
  const porId = new Map(documentos.map((d) => [d.id, d]));

  assert.equal(porId.get("c1")?.saldo, 600, "la compra: total − pagado");
  assert.equal(porId.get("t1")?.saldo, 200, "el trámite: amount − amount_paid");
  assert.equal(porId.get("t1")?.sourceType, "gasto_tramite");
  assert.equal(porId.get("t1")?.tercero, "REGISTRO PÚBLICO", "agrupa por la ficha del proveedor");
  assert.equal(porId.get("t2")?.tercero, "(sin proveedor)", "sin ficha se nombra, no se esconde (D2)");
  assert.equal(porId.get("t2")?.fechaReferencia, "2026-10-10", "la antigüedad cuenta desde el vencimiento");
});

test("🔒 Antigüedad por pagar: la consulta de trámite exige asiento y excluye pagados y anulados", () => {
  // Es el filtro que cierra FND-010 sin inventar deudas: se lee del código
  // porque el fake no filtra.
  const src = readFileSync(`${process.cwd()}/src/lib/finanzas/reports/antiguedad-source.ts`, "utf8");
  const fn = src.slice(src.indexOf("async function gastosTramitePendientes"), src.indexOf("LOS DOCUMENTOS QUE TODAVÍA NO LLEGAN AL MAYOR"));
  assert.match(fn, /\.not\("posted_entry_id", "is", null\)/, "solo los que están en el libro (en 200001)");
  assert.match(fn, /\.in\("status", \["pendiente_pago", "parcialmente_pagado"\]\)/, "ni pagados ni anulados");
});

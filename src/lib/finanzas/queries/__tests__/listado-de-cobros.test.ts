/**
 * Las dos consultas del módulo de cobros (Bloque 2, 21/09/2026), con una base
 * falsa que registra QUÉ filtros se aplican. No prueba Postgres; prueba que
 * la pantalla pida lo que `createPayment` va a aceptar:
 *
 *   · `listInvoicesCobrables` ofrece SOLO emitida / parcialmente_pagada con
 *     saldo > 0 — el mismo gate del servidor, para no ofrecer lo que después
 *     se rechaza.
 *   · `listPayments` trae la factura de un cobro reversado desde
 *     `payment_reversals` (la 046 borra las aplicaciones) y NO ofrece el
 *     asiento de un cobro anulado (no se reversa dos veces).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { listInvoicesCobrables, listPayments } from "@/lib/finanzas/queries/payments";

const TENANT = "a0000000-0000-0000-0000-000000000001";

type Llamada = { tabla: string; op: string; args: unknown[] };

function fakeDb(datos: Record<string, unknown[]>) {
  const llamadas: Llamada[] = [];
  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const reg = (op: string) => (...args: unknown[]) => {
      llamadas.push({ tabla: nombre, op, args });
      return q;
    };
    for (const op of ["select", "eq", "neq", "in", "gt", "gte", "lte", "ilike", "order", "range"]) {
      q[op] = reg(op);
    }
    q.then = (r: (v: unknown) => unknown) =>
      r({ data: datos[nombre] ?? [], error: null, count: (datos[nombre] ?? []).length });
    return q;
  };
  return { db: { from: tabla }, llamadas };
}

const filtros = (llamadas: Llamada[], tabla: string) =>
  llamadas.filter((l) => l.tabla === tabla && l.op !== "select" && l.op !== "order" && l.op !== "range");

test("listInvoicesCobrables: emitida/parcialmente_pagada, saldo > 0, del tenant — y del cliente si se pide", async () => {
  const { db, llamadas } = fakeDb({
    invoices: [
      {
        id: "i1", invoice_number: "FAC-HON-000002", invoice_kind: "HONORARIOS", client_id: "c1",
        issue_date: "2026-05-20", due_date: "2026-06-19", status: "parcialmente_pagada",
        grand_total: "1605.00", amount_paid: "250.00", balance_due: "1355.00",
        client: { name: "INVERSIONES TOCUMEN REAL, S.A.", client_number: "CLI-004" },
      },
    ],
  });
  const filas = await listInvoicesCobrables(db as never, TENANT, "c1");
  assert.deepEqual(
    filtros(llamadas, "invoices").map((l) => [l.op, ...l.args]),
    [
      ["eq", "tenant_id", TENANT],
      ["in", "status", ["emitida", "parcialmente_pagada"]],
      ["gt", "balance_due", 0],
      ["eq", "client_id", "c1"],
    ]
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0].balance_due, 1355, "los importes vuelven como número");
  assert.equal(filas[0].client_name, "INVERSIONES TOCUMEN REAL, S.A.");
});

test("listInvoicesCobrables sin cliente: todo el bufete (para el alta)", async () => {
  const { db, llamadas } = fakeDb({ invoices: [] });
  await listInvoicesCobrables(db as never, TENANT);
  assert.ok(!filtros(llamadas, "invoices").some((l) => l.op === "eq" && l.args[0] === "client_id"));
});

test("listPayments: filtros de fecha, cliente y estado, y búsqueda por REC-", async () => {
  const { db, llamadas } = fakeDb({ payments: [] });
  await listPayments(db as never, TENANT, {
    search: "REC-0000",
    client_id: "c1",
    from: "2026-09-01",
    to: "2026-09-30",
    estado: "reversados",
  });
  assert.deepEqual(
    filtros(llamadas, "payments").map((l) => [l.op, ...l.args]),
    [
      ["eq", "tenant_id", TENANT],
      ["eq", "client_id", "c1"],
      ["gte", "payment_date", "2026-09-01"],
      ["lte", "payment_date", "2026-09-30"],
      ["eq", "status", "anulado"],
      ["ilike", "payment_number", "%REC-0000%"],
    ]
  );
});

test("listPayments: 'vigentes' excluye anulados", async () => {
  const { db, llamadas } = fakeDb({ payments: [] });
  await listPayments(db as never, TENANT, { estado: "vigentes" });
  assert.ok(filtros(llamadas, "payments").some((l) => l.op === "neq" && l.args[1] === "anulado"));
});

test("listPayments: el reversado trae su factura desde payment_reversals y SIN asiento para reversar", async () => {
  const base = {
    client_id: "c1", currency: "USD", method: "transferencia", reference: null, notes: null,
    created_at: "2026-09-03T20:55:19Z", created_by: "u1", amount_unapplied: "0",
    client: { name: "Cliente S.A.", client_number: "CLI-001" },
  };
  const { db } = fakeDb({
    payments: [
      { ...base, id: "p4", payment_number: "REC-000004", payment_date: "2026-09-21", amount: "250.00", status: "registrado" },
      { ...base, id: "p3", payment_number: "REC-000003", payment_date: "2026-06-15", amount: "1000.00", status: "anulado" },
    ],
    payment_applications: [
      { payment_id: "p4", invoice_id: "i1", amount_applied: "250.00", invoice: { invoice_number: "FAC-HON-000002" } },
    ],
    payment_reversals: [
      {
        payment_id: "p3", invoice_id: "i1", amount_applied: "1000.00", reason: "Cheque devuelto",
        reversed_at: "2026-09-17T18:00:00Z", reversed_by: "u2",
        invoice: { invoice_number: "FAC-HON-000002" }, reversal: { entry_number: 21 }, reversed: { entry_number: 10 },
      },
    ],
    journal_entries: [
      { id: "je22", entry_number: 22, transaction_date: "2026-09-21", description: "Cobro", reference: "FAC-HON-000002", source_id: "p4" },
      { id: "je10", entry_number: 10, transaction_date: "2026-06-15", description: "Cobro", reference: "FAC-HON-000002", source_id: "p3" },
    ],
    journal_entry_lines: [],
    users: [
      { id: "u1", full_name: "Ileana Barrios" },
      { id: "u2", full_name: "Contador" },
    ],
  });

  const r = await listPayments(db as never, TENANT);
  assert.equal(r.total, 2);

  const vigente = r.rows.find((p) => p.id === "p4")!;
  assert.equal(vigente.facturas[0].invoice_number, "FAC-HON-000002");
  assert.equal(vigente.asiento?.entry_number, 22, "el vigente ofrece su asiento (→ Reversar)");
  assert.equal(vigente.reversion, null);
  assert.equal(vigente.created_by_name, "Ileana Barrios");

  const reversado = r.rows.find((p) => p.id === "p3")!;
  assert.equal(reversado.facturas[0].invoice_number, "FAC-HON-000002", "la factura sale de payment_reversals");
  assert.equal(reversado.asiento, null, "un cobro anulado no se reversa de nuevo");
  assert.equal(reversado.reversion?.entry_number, 21);
  assert.equal(reversado.reversion?.reversed_entry_number, 10);
  assert.equal(reversado.reversion?.reversed_by_name, "Contador");
});

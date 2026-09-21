/**
 * Reversar un GASTO DE TRÁMITE (Bloque 4, commit 2): `reverseExpenseTramite`
 * → RPC `reverse_expense_tramite` (050).
 *
 *   1. Gates del helper, con la base simulada: 404 sin gasto; 409 anulado; 409
 *      con pagos registrados (primero los pagos); 409 sin asiento; el RPC
 *      recibe las líneas de `construirAsientoDeReversion` (el espejo exacto) y
 *      la fecha de hoy; un error del RPC sale como 422.
 *   2. Una sola implementación del espejo, como en cobros y pagos: el helper y
 *      la ruta no intercambian débito/crédito; el RPC de la 050 verifica con
 *      EXCEPT ALL y no construye líneas.
 *   3. Roles: la ruta declara los MISMOS que reversar un pago a proveedor
 *      (admin, abogada, contador), y la pantalla los repite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { reverseExpenseTramite } from "@/lib/finanzas/api/expense-tramite";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const GASTO = "77777777-7777-7777-7777-777777777777";
const USER = "22222222-2222-2222-2222-222222222222";

interface Guion {
  gasto?: { status: string; amount_paid: number } | null;
  asiento?: boolean;
  rpc?: "ok" | { message: string };
}

function fake(g: Guion) {
  const reg = { rpc: null as { name: string; args: Record<string, unknown> } | null };

  const filaAsiento = {
    id: "e1",
    entry_number: 33,
    transaction_date: "2026-09-20",
    description: "Gasto de trámite: Timbres",
    reference: null,
    source_id: GASTO,
  };
  const lineas = [
    { entry_id: "e1", line_order: 1, debit: 300, credit: 0, line_description: "Timbres", chart_of_accounts: { code: "130003", name: "Fondo Legales" } },
    { entry_id: "e1", line_order: 2, debit: 0, credit: 300, line_description: "Cuentas por pagar", chart_of_accounts: { code: "200001", name: "Cuentas por pagar" } },
  ];

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const op of ["select", "eq", "in", "order"]) q[op] = self;
    q.maybeSingle = async () => {
      if (nombre === "expenses") return { data: g.gasto === null ? null : { id: GASTO, ...(g.gasto ?? { status: "pendiente_pago", amount_paid: 0 }) }, error: null };
      return { data: null, error: null };
    };
    // Las consultas de lista (journal_entries / journal_entry_lines) se
    // resuelven al hacer await sobre el builder.
    q.then = (r: (v: unknown) => unknown) => {
      if (nombre === "journal_entries") return r({ data: g.asiento === false ? [] : [filaAsiento], error: null });
      if (nombre === "journal_entry_lines") return r({ data: lineas, error: null });
      return r({ data: [], error: null });
    };
    return q;
  };

  const db = { from: tabla };
  const ledger = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      reg.rpc = { name, args };
      if (g.rpc && g.rpc !== "ok") return { data: null, error: { message: g.rpc.message } };
      return {
        data: { entry_id: "e2", entry_number: 34, reversed_entry_number: 33, transaction_date: args.p_transaction_date, expense: { id: GASTO, status: "anulado" } },
        error: null,
      };
    },
  };
  return { db, ledger, reg };
}

async function status(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { status: number }).status;
  }
}

test("gasto inexistente → 404", async () => {
  const f = fake({ gasto: null });
  assert.equal(await status(reverseExpenseTramite(f.db as never, f.ledger as never, TENANT, USER, GASTO, "motivo válido")), 404);
});

test("gasto ya anulado → 409, sin tocar el RPC", async () => {
  const f = fake({ gasto: { status: "anulado", amount_paid: 0 } });
  assert.equal(await status(reverseExpenseTramite(f.db as never, f.ledger as never, TENANT, USER, GASTO, "motivo válido")), 409);
  assert.equal(f.reg.rpc, null);
});

test("🔒 gasto con pagos registrados → 409: primero los pagos", async () => {
  const f = fake({ gasto: { status: "parcialmente_pagado", amount_paid: 100 } });
  const err = await reverseExpenseTramite(f.db as never, f.ledger as never, TENANT, USER, GASTO, "motivo válido").catch((e) => e);
  assert.equal(err.status, 409);
  assert.match(err.message, /Primero elimine/);
  assert.equal(f.reg.rpc, null);
});

test("gasto sin asiento → 409", async () => {
  const f = fake({ asiento: false });
  assert.equal(await status(reverseExpenseTramite(f.db as never, f.ledger as never, TENANT, USER, GASTO, "motivo válido")), 409);
});

test("el RPC recibe el espejo exacto de construirAsientoDeReversion, con la fecha de hoy y el gasto como source", async () => {
  const f = fake({});
  const r = await reverseExpenseTramite(f.db as never, f.ledger as never, TENANT, USER, GASTO, "Gasto cargado al caso equivocado");
  assert.equal(r.entry_number, 34);
  assert.equal(r.reversed_entry_number, 33);
  assert.equal(r.expense.status, "anulado");
  assert.ok(f.reg.rpc);
  assert.equal(f.reg.rpc.name, "reverse_expense_tramite");
  const a = f.reg.rpc.args;
  assert.equal(a.p_tenant_id, TENANT);
  assert.equal(a.p_expense_id, GASTO);
  assert.equal(a.p_transaction_date, new Date().toISOString().slice(0, 10));
  assert.equal(a.p_reason, "Gasto cargado al caso equivocado");
  const lines = a.p_lines as { account_code: string; debit: number; credit: number }[];
  assert.deepEqual(
    lines.map((l) => [l.account_code, l.debit, l.credit]),
    [["130003", 0, 300], ["200001", 300, 0]],
    "débito y crédito intercambiados por la función pura"
  );
});

test("un error del RPC sale como 422 con su mensaje", async () => {
  const f = fake({ rpc: { message: "El asiento 33 ya fue reversado por el asiento 34." } });
  const err = await reverseExpenseTramite(f.db as never, f.ledger as never, TENANT, USER, GASTO, "motivo válido").catch((e) => e);
  assert.equal(err.status, 422);
  assert.match(err.message, /ya fue reversado/);
});

// ---------------------------------------------------------------------------
// Estructura: una sola implementación del espejo, y los roles
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const HELPER = "src/lib/finanzas/api/expense-tramite.ts";
const RUTA = "src/app/api/expenses/[id]/reverse/route.ts";
const MIGRACION = "sql/pending/050_reversion_de_gasto_de_tramite.sql";
const PANTALLA = "src/app/finanzas/gastos-tramite/[id]/page.tsx";
const REIMPLEMENTACION = /\b(debit|debe)\s*:\s*[\w.]*\b(credit|haber)\b|\b(credit|haber)\s*:\s*[\w.]*\b(debit|debe)\b/;

test("el helper postea lo que devuelve construirAsientoDeReversion, sin reimplementar", () => {
  const src = leer(HELPER);
  assert.match(src, /import\s*\{[^}]*\bconstruirAsientoDeReversion\b[^}]*\}\s*from\s*"@\/lib\/finanzas\/contabilidad\/reversion"/);
  assert.match(src, /p_lines:\s*armado\.asiento\.lines/);
  assert.match(src, /p_description:\s*armado\.asiento\.description/);
  assert.match(src, /p_transaction_date:\s*armado\.asiento\.transaction_date/);
  assert.doesNotMatch(src, REIMPLEMENTACION);
});

test("la ruta delega en reverseExpenseTramite y saca el tenant del contexto", () => {
  const src = leer(RUTA);
  assert.match(src, /reverseExpenseTramite\(/);
  assert.match(src, /ctx\.tenantId/);
  assert.doesNotMatch(src, /tenant_id/, "el tenant nunca sale del body");
  assert.doesNotMatch(src, REIMPLEMENTACION);
});

test("el RPC de la 050 verifica el espejo (EXCEPT ALL), no lo construye", () => {
  const sql = leer(MIGRACION);
  const cuerpo = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.reverse_expense_tramite"));
  assert.match(cuerpo, /EXCEPT ALL/);
  assert.doesNotMatch(cuerpo, /jsonb_build_object\([^)]*'debit'/);
  assert.match(cuerpo, /post_journal_entry\(\s*p_tenant_id,\s*p_transaction_date,\s*p_description,\s*'reversion',\s*p_lines/);
  assert.match(cuerpo, /finanzas\.tramite_anular/, "anula con la llave que el guard de la 049 reconoce");
  assert.match(cuerpo, /status = 'registrado'[\s\S]*Primero elimine/, "rechaza con pagos registrados");
});

const rolesDe = (src: string, nombre: string): string[] => {
  const m = src.match(new RegExp("const " + nombre + " = \\[([^\\]]+)\\]"));
  assert.ok(m, `no se encontró ${nombre}`);
  return m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
};

test("roles: la ruta = reversar un pago a proveedor; la pantalla repite la lista", () => {
  const ruta = rolesDe(leer(RUTA), "MUTATING_ROLES");
  const pago = rolesDe(leer("src/app/api/finanzas/supplier-payments/[id]/reverse/route.ts"), "MUTATING_ROLES");
  const pantalla = rolesDe(leer(PANTALLA), "REVERSING_ROLES");
  assert.deepEqual(ruta, pago);
  assert.deepEqual(pantalla, ruta);
  assert.deepEqual(ruta, ["admin", "abogada", "contador"]);
});

test("la pantalla oculta Reversar si hay pagos registrados o el gasto está anulado", () => {
  const src = leer(PANTALLA);
  assert.match(src, /const puedeReversar =[\s\S]*!anulado[\s\S]*gasto\.amount_paid <= 0/);
  assert.match(src, /variante="gasto"/);
});

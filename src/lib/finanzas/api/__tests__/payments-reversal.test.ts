/**
 * `reversePayment` — el helper que le habla al RPC `reverse_payment`.
 *
 * Lo que se prueba acá NO es la atomicidad (eso vive en la base y lo prueba
 * `sql/tests/verificacion-046-reversion-cobro.sql` forzando una falla después
 * del posteo). Acá se prueba el contrato del helper:
 *
 *   · manda al RPC EXACTAMENTE lo que devuelve `construirAsientoDeReversion`
 *     (espejo, fecha de hoy, motivo trimeado, tenant del argumento);
 *   · corta ANTES del RPC cuando el cobro no existe, ya está anulado o no
 *     tiene asiento — y con el código HTTP correcto;
 *   · traduce un rechazo del RPC a 422 con el mensaje del RPC, que ya viene
 *     redactado para un humano.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { reversePayment } from "@/lib/finanzas/api/payments";
import { MutationError } from "@/lib/finanzas/api/errors";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const PAGO = "44444444-4444-4444-4444-444444444444";
const USER = "22222222-2222-2222-2222-222222222222";
const ENTRY = "e0000000-0000-0000-0000-000000000010";

interface Guion {
  pago?: { status: string } | null;
  asiento?: boolean;
  rpc?: { data: unknown; error: null } | { data: null; error: { message: string } };
}

function fake(g: Guion) {
  const reg = { rpc: null as null | { fn: string; args: Record<string, unknown> } };

  function resolver(nombre: string) {
    switch (nombre) {
      case "payments":
        return { data: g.pago === undefined ? { id: PAGO, status: "registrado" } : g.pago, error: null };
      case "journal_entries":
        return {
          data: g.asiento === false
            ? []
            : [{
                id: ENTRY,
                entry_number: 10,
                transaction_date: "2026-06-15",
                description: "Cobro de FAC-HON-000002 — Corporación Andes",
                reference: "FAC-HON-000002",
                source_id: PAGO,
              }],
          error: null,
        };
      case "journal_entry_lines":
        return {
          data: [
            { entry_id: ENTRY, line_order: 1, debit: "1000.00", credit: "0.00", line_description: "Cobro FAC-HON-000002", chart_of_accounts: { code: "100001", name: "Banco General Operativa" } },
            { entry_id: ENTRY, line_order: 2, debit: "0.00", credit: "1000.00", line_description: "Corporación Andes", chart_of_accounts: { code: "100004", name: "Cuentas por Cobrar" } },
          ],
          error: null,
        };
      default:
        return { data: [], error: null };
    }
  }

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.in = self;
    q.order = self;
    q.maybeSingle = async () => resolver(nombre);
    q.then = (r: (v: unknown) => unknown) => r(resolver(nombre));
    return q;
  };

  const db = { from: tabla } as unknown as Parameters<typeof reversePayment>[0];
  const ledger = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      reg.rpc = { fn, args };
      return g.rpc ?? {
        data: {
          entry_id: "e0000000-0000-0000-0000-000000000021",
          entry_number: 21,
          reversed_entry_number: 10,
          transaction_date: args.p_transaction_date,
          invoices: [{ invoice_id: "i", invoice_number: "FAC-HON-000002", status: "emitida", amount_paid: "0.00" }],
        },
        error: null,
      };
    },
  } as unknown as Parameters<typeof reversePayment>[1];

  return { db, ledger, reg };
}

async function falla(p: Promise<unknown>): Promise<MutationError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof MutationError, `esperaba MutationError, llegó ${String(e)}`);
    return e;
  }
  assert.fail("debía fallar");
}

test("manda al RPC el espejo exacto, con la fecha de hoy, el motivo trimeado y el tenant del argumento", async () => {
  const { db, ledger, reg } = fake({});
  const hoy = new Date().toISOString().slice(0, 10);

  const r = await reversePayment(db, ledger, TENANT, USER, PAGO, "  Cheque devuelto por el banco  ");

  assert.ok(reg.rpc);
  assert.equal(reg.rpc.fn, "reverse_payment");
  const a = reg.rpc.args;
  assert.equal(a.p_tenant_id, TENANT);
  assert.equal(a.p_payment_id, PAGO);
  assert.equal(a.p_created_by, USER);
  assert.equal(a.p_reason, "Cheque devuelto por el banco");
  assert.equal(a.p_transaction_date, hoy);
  assert.match(String(a.p_description), /^Reversión del asiento 10 — /);
  assert.deepEqual(
    (a.p_lines as { account_code: string; debit: number; credit: number }[]).map((l) => [l.account_code, l.debit, l.credit]),
    [
      ["100001", 0, 1000],
      ["100004", 1000, 0],
    ]
  );

  assert.equal(r.entry_number, 21);
  assert.equal(r.reversed_entry_number, 10);
  assert.equal(r.invoices[0].amount_paid, 0);
  assert.equal(typeof r.invoices[0].amount_paid, "number");
});

test("404 si el cobro no existe (o es de otro tenant), sin tocar el RPC", async () => {
  const { db, ledger, reg } = fake({ pago: null });
  const e = await falla(reversePayment(db, ledger, TENANT, USER, PAGO, "Cheque devuelto"));
  assert.equal(e.status, 404);
  assert.equal(reg.rpc, null);
});

test("409 si el cobro ya está anulado, sin tocar el RPC", async () => {
  const { db, ledger, reg } = fake({ pago: { status: "anulado" } });
  const e = await falla(reversePayment(db, ledger, TENANT, USER, PAGO, "Cheque devuelto"));
  assert.equal(e.status, 409);
  assert.equal(reg.rpc, null);
});

test("409 si el cobro no tiene asiento: no hay nada que reversar, se elimina", async () => {
  const { db, ledger, reg } = fake({ asiento: false });
  const e = await falla(reversePayment(db, ledger, TENANT, USER, PAGO, "Cheque devuelto"));
  assert.equal(e.status, 409);
  assert.match(e.message, /se elimina/);
  assert.equal(reg.rpc, null);
});

test("422 con el mensaje del RPC cuando la base rechaza (período cerrado, ya reversado…)", async () => {
  const { db, ledger } = fake({
    rpc: { data: null, error: { message: "El período 2026-09 está CERRADO: no admite asientos nuevos." } },
  });
  const e = await falla(reversePayment(db, ledger, TENANT, USER, PAGO, "Cheque devuelto"));
  assert.equal(e.status, 422);
  assert.match(e.message, /CERRADO/);
});

test("422 si el motivo es demasiado corto, antes del RPC", async () => {
  const { db, ledger, reg } = fake({});
  const e = await falla(reversePayment(db, ledger, TENANT, USER, PAGO, "no"));
  assert.equal(e.status, 422);
  assert.equal(reg.rpc, null);
});

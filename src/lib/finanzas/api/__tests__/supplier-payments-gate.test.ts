/**
 * EL GATE DEL PAGO A PROVEEDOR (Bloque 3, 048), con la base falsa del cobro:
 *
 *   · el cap es por el SALDO de la compra (total − amount_paid), no por el total:
 *     pago parcial (Josuarth, 21/09);
 *   · el número CE- se toma después de las validaciones y va dentro del INSERT;
 *     si el asiento falla, el pago se borra y el número queda consumido (hueco,
 *     mismo criterio que el recibo de caja);
 *   · una compra ya pagada o con saldo cero rechaza;
 *   · el banco es obligatorio y se valida antes de tocar la base;
 *   · eliminar un pago CON asiento → 409; sin asiento (incluido un saldo
 *     heredado) → se borra; reversar un saldo heredado → 409 que lo nombra.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSupplierPayment,
  deleteSupplierPayment,
  reverseSupplierPayment,
} from "@/lib/finanzas/api/supplier-payments";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const COMPRA = "55555555-5555-5555-5555-555555555555";
const PAGO = "66666666-6666-6666-6666-666666666666";
const USER = "22222222-2222-2222-2222-222222222222";

interface Guion {
  compra?: { status: string; total: number; amount_paid: number } | null;
  tieneAsiento?: boolean;
  postea?: "ok" | { code: string; message: string };
  bancoValido?: boolean;
  pagoExistente?: { kind: string; status: string } | null;
}

function fake(g: Guion) {
  const reg = {
    borrados: [] as string[],
    insertados: [] as string[],
    posteos: 0,
    correlativos: [] as string[],
    payloadPago: null as Record<string, unknown> | null,
    rpcs: [] as string[],
  };

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const op of ["select", "eq", "in", "order", "gt", "neq"]) q[op] = self;
    q.maybeSingle = async () => resolverUno(nombre);
    q.single = async () => resolverUno(nombre);
    q.insert = (payload?: Record<string, unknown>) => {
      reg.insertados.push(nombre);
      if (nombre === "supplier_payments" && payload) reg.payloadPago = payload;
      const res = resolverUno(nombre);
      return { select: () => ({ single: async () => res }), then: (r: (v: unknown) => unknown) => r({ error: null }) };
    };
    q.delete = () => ({
      eq: () => ({
        eq: async () => {
          reg.borrados.push(nombre);
          return { error: null };
        },
      }),
    });
    q.then = (r: (v: unknown) => unknown) => r(resolver(nombre));
    return q;
  };

  function resolverUno(nombre: string) {
    const r = resolver(nombre) as { data: unknown; error: unknown };
    return Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r;
  }

  function resolver(nombre: string) {
    switch (nombre) {
      case "business_expenses":
        return {
          data: g.compra === null ? null : { id: COMPRA, description: "Insumos", ...(g.compra ?? { status: "pendiente_pago", total: 1000, amount_paid: 0 }) },
          error: null,
        };
      case "journal_entries":
        return { data: g.tieneAsiento ? [{ id: "je-1", entry_number: 30, transaction_date: "2026-09-21", description: "Pago", reference: "CE-000004", source_id: PAGO }] : [], error: null };
      case "journal_entry_lines":
        return {
          data: g.tieneAsiento
            ? [
                { entry_id: "je-1", line_order: 1, debit: 400, credit: 0, line_description: null, chart_of_accounts: { code: "200001", name: "CxP" } },
                { entry_id: "je-1", line_order: 2, debit: 0, credit: 400, line_description: null, chart_of_accounts: { code: "100001", name: "Banco" } },
              ]
            : [],
          error: null,
        };
      case "supplier_payments":
        return {
          data: {
            id: PAGO,
            business_expense_id: COMPRA,
            kind: g.pagoExistente?.kind ?? "payment",
            payment_number: "CE-000004",
            payment_date: "2026-09-21",
            amount: 400,
            method: "transferencia",
            payment_account_code: "100001",
            reference: null,
            notes: null,
            status: g.pagoExistente?.status ?? "registrado",
            created_at: "2026-09-21T00:00:00Z",
            created_by: USER,
            compra: { id: COMPRA, description: "Insumos", supplier_name: "PROVEEDOR, S.A.", supplier_invoice_number: "F-1001" },
          },
          error: null,
        };
      case "chart_of_accounts":
        return {
          data: g.bancoValido === false ? null : { code: "100001", name: "Banco General Operativa", account_type: "asset", active: true },
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  }

  const db = {
    from: (n: string) => tabla(n),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      reg.rpcs.push(fn);
      if (fn === "post_journal_entry") {
        reg.posteos++;
        if (!g.postea || g.postea === "ok") return { data: "je-1", error: null };
        return { data: null, error: g.postea };
      }
      if (fn === "get_next_sequence_number") {
        reg.correlativos.push(String(args?.p_sequence_type));
        return { data: 4, error: null };
      }
      if (fn === "reverse_supplier_payment") {
        return { data: { entry_id: "je-2", entry_number: 31, reversed_entry_number: 30, transaction_date: "2026-09-21", expense: { id: COMPRA, status: "pendiente_pago", amount_paid: 0 } }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { db, reg };
}

const INPUT = {
  business_expense_id: COMPRA,
  payment_date: "2026-09-21",
  amount: 400,
  method: "transferencia" as const,
  payment_account_code: "100001",
  reference: null,
  notes: null,
};

test("caso feliz: pago parcial de 400 sobre 1000 → CE-000004, un insert, un asiento", async () => {
  const { db, reg } = fake({ postea: "ok" });
  const r = await createSupplierPayment(db as never, TENANT, USER, INPUT, db as never);
  assert.equal(r.payment_number, "CE-000004");
  assert.deepEqual(reg.correlativos, ["supplier_payment"]);
  assert.equal(reg.payloadPago?.payment_number, "CE-000004");
  assert.equal(reg.payloadPago?.kind, "payment");
  assert.equal(reg.payloadPago?.payment_account_code, "100001", "el banco vive en el PAGO");
  assert.equal(reg.posteos, 1);
  assert.deepEqual(reg.borrados, []);
});

test("🔴 el cap es por el SALDO: 400 sobre una compra de 1000 con 700 pagados → 400 nombrando el saldo", async () => {
  const { db, reg } = fake({ compra: { status: "parcialmente_pagado", total: 1000, amount_paid: 700 } });
  await assert.rejects(
    () => createSupplierPayment(db as never, TENANT, USER, INPUT, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /300\.00/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
  assert.deepEqual(reg.correlativos, [], "un rechazo no consume número");
});

test("compra ya pagada → 400, nada se toca", async () => {
  const { db, reg } = fake({ compra: { status: "pagado", total: 1000, amount_paid: 1000 } });
  await assert.rejects(() => createSupplierPayment(db as never, TENANT, USER, INPUT, db as never), /completamente pagada/);
  assert.deepEqual(reg.insertados, []);
});

test("sin banco → 400 antes de tocar la base", async () => {
  const { db, reg } = fake({});
  await assert.rejects(
    () => createSupplierPayment(db as never, TENANT, USER, { ...INPUT, payment_account_code: null }, db as never),
    /cuenta bancaria/
  );
  assert.deepEqual(reg.insertados, []);
  assert.deepEqual(reg.correlativos, []);
});

test("🔴 si el asiento falla, el pago se BORRA y el número queda consumido (hueco, SOP-031)", async () => {
  const { db, reg } = fake({ postea: { code: "P0001", message: "El período 2026-09 está cerrado" } });
  await assert.rejects(() => createSupplierPayment(db as never, TENANT, USER, INPUT, db as never), /período/);
  assert.deepEqual(reg.correlativos, ["supplier_payment"]);
  assert.deepEqual(reg.borrados, ["supplier_payments"]);
});

test("banco inválido → 422 y el pago se deshace", async () => {
  const { db, reg } = fake({ bancoValido: false });
  await assert.rejects(
    () => createSupplierPayment(db as never, TENANT, USER, INPUT, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 422);
      return true;
    }
  );
  assert.deepEqual(reg.borrados, ["supplier_payments"]);
});

test("eliminar un pago CON asiento → 409 nombrando el asiento", async () => {
  const { db, reg } = fake({ tieneAsiento: true });
  await assert.rejects(
    () => deleteSupplierPayment(db as never, TENANT, PAGO),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /asiento 30/);
      return true;
    }
  );
  assert.deepEqual(reg.borrados, []);
});

test("eliminar un saldo heredado (sin asiento) → se borra: es la corrección honesta", async () => {
  const { db, reg } = fake({ tieneAsiento: false, pagoExistente: { kind: "migrated_balance", status: "registrado" } });
  await deleteSupplierPayment(db as never, TENANT, PAGO);
  assert.deepEqual(reg.borrados, ["supplier_payments"]);
});

test("🔴 reversar un saldo heredado → 409 que lo nombra, sin llamar al RPC", async () => {
  const { db, reg } = fake({ pagoExistente: { kind: "migrated_balance", status: "registrado" } });
  await assert.rejects(
    () => reverseSupplierPayment(db as never, db as never, TENANT, USER, PAGO, "motivo largo"),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /saldo heredado/);
      return true;
    }
  );
  assert.ok(!reg.rpcs.includes("reverse_supplier_payment"));
});

test("reversar un pago con asiento: manda al RPC el espejo exacto y devuelve cómo quedó la compra", async () => {
  const { db, reg } = fake({ tieneAsiento: true });
  const r = await reverseSupplierPayment(db as never, db as never, TENANT, USER, PAGO, "Cheque devuelto");
  assert.ok(reg.rpcs.includes("reverse_supplier_payment"));
  assert.equal(r.entry_number, 31);
  assert.equal(r.reversed_entry_number, 30);
  assert.equal(r.expense.status, "pendiente_pago");
});

test("reversar un pago sin asiento → 409: se elimina", async () => {
  const { db } = fake({ tieneAsiento: false });
  await assert.rejects(
    () => reverseSupplierPayment(db as never, db as never, TENANT, USER, PAGO, "motivo largo"),
    /no está en el libro/
  );
});

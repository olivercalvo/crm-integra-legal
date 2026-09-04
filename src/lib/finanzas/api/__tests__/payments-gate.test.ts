/**
 * EL GATE CONTABLE DE COBROS, y el DELETE compensatorio.
 *
 * 🔴 **Por qué acá el gate importa más que en compras o facturas.** Borrar un
 * cobro contabilizado no solo deja el asiento huérfano: el CASCADE se lleva la
 * `payment_application`, T7a recalcula `amount_paid` y **la factura vuelve a
 * 'emitida'**. Medido contra staging el 04/09: FAC-HON-000001 pasaría de
 * `1070.00/pagada` a `0.00/emitida` mientras el asiento 7 sigue diciendo que
 * entró la plata al banco. Dos verdades opuestas, y solo una es corregible.
 *
 * Un cobro contabilizado se REVIERTE, no se borra. Que la reversión todavía no
 * exista hace el bloqueo visible en vez de silencioso.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPayment, deletePayment } from "@/lib/finanzas/api/payments";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const PAGO = "44444444-4444-4444-4444-444444444444";
const INVOICE = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

interface Guion {
  tieneAsiento?: boolean;
  postea?: "ok" | { code: string; message: string };
  bancoValido?: boolean;
  fallaApp?: boolean;
}

function fake(g: Guion) {
  const reg = { borrados: [] as string[], insertados: [] as string[], posteos: 0 };

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.in = self;
    q.order = () => resolver(nombre);
    q.maybeSingle = async () => resolverUno(nombre);
    q.single = async () => resolverUno(nombre);
    q.insert = () => {
      reg.insertados.push(nombre);
      if (nombre === "payment_applications" && g.fallaApp) {
        const res = { data: null, error: { message: "boom", code: "23514" } };
        return {
          select: () => ({ single: async () => res }),
          then: (r: (v: unknown) => unknown) => r(res),
        };
      }
      const res = resolverUno(nombre);
      return {
        select: () => ({ single: async () => res }),
        then: (r: (v: unknown) => unknown) => r({ error: null }),
      };
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
      case "journal_entries":
        return { data: g.tieneAsiento ? { entry_number: 7 } : null, error: null };
      case "invoices":
        return {
          data: {
            id: INVOICE,
            invoice_number: "FAC-HON-000001",
            status: "emitida",
            grand_total: 1070,
            amount_paid: 0,
            balance_due: 1070,
          },
          error: null,
        };
      case "payments":
        return {
          data: {
            id: PAGO,
            status: "registrado",
            payment_date: "2026-09-04",
            amount: 500,
            payment_account_code: "100002",
            client: { name: "Cliente S.A." },
          },
          error: null,
        };
      case "payment_applications":
        return { data: [{ invoice: { invoice_number: "FAC-HON-000001" } }], error: null };
      case "chart_of_accounts":
        return {
          data:
            g.bancoValido === false
              ? null
              : { code: "100002", name: "Banco General Inversiones", account_type: "asset", active: true },
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  }

  const db = {
    from: (n: string) => tabla(n),
    rpc: async (fn: string) => {
      if (fn === "post_journal_entry") {
        reg.posteos++;
        if (!g.postea || g.postea === "ok") return { data: "je-1", error: null };
        return { data: null, error: g.postea };
      }
      return { data: null, error: null };
    },
  };

  return { db, reg };
}

const INPUT = {
  invoice_id: INVOICE,
  payment_date: "2026-09-04",
  amount: 500,
  method: "transferencia" as const,
  payment_account_code: "100002",
  reference: null,
  notes: null,
};

// ---------------------------------------------------------------------------
// El gate
// ---------------------------------------------------------------------------

test("🔴 borrar un cobro CON asiento → 409, nombrando el asiento", async () => {
  const { db, reg } = fake({ tieneAsiento: true });
  await assert.rejects(
    () => deletePayment(db as never, TENANT, PAGO),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /asiento 7/);
      assert.match(e.message, /reversión/);
      return true;
    }
  );
  assert.deepEqual(reg.borrados, [], "no se borró nada");
});

test("borrar un cobro SIN asiento sí procede", async () => {
  const { db, reg } = fake({ tieneAsiento: false });
  await deletePayment(db as never, TENANT, PAGO);
  assert.ok(reg.borrados.includes("payments"));
});

// ---------------------------------------------------------------------------
// El banco
// ---------------------------------------------------------------------------

test("🔴 sin banco NO se registra, y ni siquiera se toca la base", async () => {
  const { db, reg } = fake({});
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, { ...INPUT, payment_account_code: null }, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /cuenta bancaria/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, [], "se corta antes de insertar");
  assert.equal(reg.posteos, 0);
});

test("banco que no sirve (no existe o no es activo) → se deshace el cobro", async () => {
  const { db, reg } = fake({ bancoValido: false });
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, INPUT, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 422);
      assert.match(e.message, /100002/);
      return true;
    }
  );
  assert.ok(reg.borrados.includes("payments"), "el cobro no queda registrado sin asiento");
});

// ---------------------------------------------------------------------------
// El DELETE compensatorio
// ---------------------------------------------------------------------------

test("caso feliz: se registra, se aplica, se postea, y no se deshace nada", async () => {
  const { db, reg } = fake({ postea: "ok" });
  const r = await createPayment(db as never, TENANT, USER, INPUT, db as never);
  assert.equal(r.id, PAGO);
  assert.equal(reg.posteos, 1);
  assert.deepEqual(reg.borrados, []);
});

test("🔴 si el posteo falla, el cobro se BORRA y el error sube", async () => {
  const { db, reg } = fake({
    postea: { code: "P0001", message: "El período 2026-09 está cerrado" },
  });
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, INPUT, db as never),
    (e: Error) => {
      assert.match(e.message, /período/);
      return true;
    }
  );
  assert.ok(reg.borrados.includes("payments"));
});

test("🔴 el compensatorio borra SOLO el payment — el CASCADE hace el resto", async () => {
  const { db, reg } = fake({
    postea: { code: "P0001", message: "cerrado" },
  });
  await assert.rejects(() =>
    createPayment(db as never, TENANT, USER, INPUT, db as never)
  );
  // Medido contra staging: los dos órdenes dan el mismo estado final, y se
  // eligió éste porque no puede dejar un pago sin aplicación a medio camino.
  assert.deepEqual(
    reg.borrados,
    ["payments"],
    "borrar la application aparte agregaría un paso que puede fallar solo"
  );
});

test("si falla la aplicación, también se deshace (comportamiento previo, intacto)", async () => {
  const { db, reg } = fake({ fallaApp: true });
  await assert.rejects(() => createPayment(db as never, TENANT, USER, INPUT, db as never));
  assert.ok(reg.borrados.includes("payments"));
  assert.equal(reg.posteos, 0, "no se postea un cobro que no se pudo aplicar");
});

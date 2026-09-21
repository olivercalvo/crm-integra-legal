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
  /** La secuencia 'payment' no existe (047 sin aplicar). */
  sinSecuencia?: boolean;
  /** Las facturas que "existen". Por defecto, la de siempre. */
  facturas?: FacturaFake[];
}

interface FacturaFake {
  id: string;
  invoice_number: string;
  client_id: string;
  status: string;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
}

const CLIENTE = "33333333-3333-3333-3333-333333333333";
const INVOICE_2 = "11111111-1111-1111-1111-222222222222";

const FACTURA_1: FacturaFake = {
  id: INVOICE,
  invoice_number: "FAC-HON-000001",
  client_id: CLIENTE,
  status: "emitida",
  grand_total: 1070,
  amount_paid: 0,
  balance_due: 1070,
};
const FACTURA_2: FacturaFake = {
  id: INVOICE_2,
  invoice_number: "FAC-HON-000002",
  client_id: CLIENTE,
  status: "parcialmente_pagada",
  grand_total: 1605,
  amount_paid: 250,
  balance_due: 1355,
};

function fake(g: Guion) {
  const reg = {
    borrados: [] as string[],
    insertados: [] as string[],
    posteos: 0,
    /** Cada `get_next_sequence_number`, con su tipo de secuencia. */
    correlativos: [] as string[],
    /** Lo que se insertó en `payments`, para mirar el `payment_number`. */
    payloadPago: null as Record<string, unknown> | null,
    /** Las filas insertadas en `payment_applications`. */
    aplicaciones: [] as Record<string, unknown>[],
  };

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.in = self;
    q.order = () => resolver(nombre);
    q.maybeSingle = async () => resolverUno(nombre);
    q.single = async () => resolverUno(nombre);
    q.insert = (payload?: Record<string, unknown> | Record<string, unknown>[]) => {
      reg.insertados.push(nombre);
      if (nombre === "payments" && payload && !Array.isArray(payload)) reg.payloadPago = payload;
      if (nombre === "payment_applications" && Array.isArray(payload)) reg.aplicaciones = payload;
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
        return { data: g.facturas ?? [FACTURA_1], error: null };
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
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "post_journal_entry") {
        reg.posteos++;
        if (!g.postea || g.postea === "ok") return { data: "je-1", error: null };
        return { data: null, error: g.postea };
      }
      if (fn === "get_next_sequence_number") {
        reg.correlativos.push(String(args?.p_sequence_type));
        if (g.sinSecuencia) {
          return {
            data: null,
            error: { code: "P0002", message: "Secuencia payment no existe para tenant" },
          };
        }
        return { data: 12, error: null };
      }
      return { data: null, error: null };
    },
  };

  return { db, reg };
}

const INPUT = {
  applications: [{ invoice_id: INVOICE, amount: 500 }],
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
  assert.equal(r.payment_number, "REC-000012");
  assert.equal(reg.posteos, 1);
  assert.deepEqual(reg.borrados, []);
});

// ---------------------------------------------------------------------------
// El número de recibo (047)
// ---------------------------------------------------------------------------

test("el correlativo sale de la secuencia 'payment' y va DENTRO del INSERT del cobro", async () => {
  const { db, reg } = fake({ postea: "ok" });
  await createPayment(db as never, TENANT, USER, INPUT, db as never);
  assert.deepEqual(reg.correlativos, ["payment"], "una sola vez, de la secuencia correcta");
  assert.equal(reg.payloadPago?.payment_number, "REC-000012");
  // No hay un UPDATE posterior que lo escriba: si el INSERT falla, el número no
  // queda colgado de ninguna fila.
  assert.equal(reg.insertados.indexOf("payments"), 0);
});

test("un pedido rechazado en validación NO consume número (sin banco)", async () => {
  const { db, reg } = fake({});
  await assert.rejects(() =>
    createPayment(db as never, TENANT, USER, { ...INPUT, payment_account_code: null }, db as never)
  );
  assert.deepEqual(reg.correlativos, [], "se corta antes del correlativo");
});

test("un monto sobre el saldo NO consume número", async () => {
  const { db, reg } = fake({});
  await assert.rejects(() =>
    createPayment(
      db as never,
      TENANT,
      USER,
      { ...INPUT, amount: 99999, applications: [{ invoice_id: INVOICE, amount: 99999 }] },
      db as never
    )
  );
  assert.deepEqual(reg.correlativos, []);
  assert.deepEqual(reg.insertados, []);
});

// ---------------------------------------------------------------------------
// Varias facturas en un recibo (Parte B, 21/09/2026)
// ---------------------------------------------------------------------------

const DOS = {
  ...INPUT,
  amount: 1500,
  applications: [
    { invoice_id: INVOICE, amount: 1070 },
    { invoice_id: INVOICE_2, amount: 430 },
  ],
};

test("dos facturas del mismo cliente: UN cobro, DOS aplicaciones en un solo insert, UN asiento", async () => {
  const { db, reg } = fake({ postea: "ok", facturas: [FACTURA_1, FACTURA_2] });
  const r = await createPayment(db as never, TENANT, USER, DOS, db as never);
  assert.equal(r.payment_number, "REC-000012");
  assert.equal(reg.payloadPago?.amount, 1500);
  assert.equal(reg.payloadPago?.client_id, CLIENTE);
  assert.deepEqual(
    reg.aplicaciones.map((a) => [a.invoice_id, a.amount_applied]),
    [
      [INVOICE, 1070],
      [INVOICE_2, 430],
    ]
  );
  assert.equal(reg.insertados.filter((t) => t === "payment_applications").length, 1, "un solo insert");
  assert.equal(reg.posteos, 1, "un solo asiento");
  assert.deepEqual(reg.correlativos, ["payment"], "un solo número");
});

test("🔴 facturas de clientes DISTINTOS → 400, y no se toca la base", async () => {
  const { db, reg } = fake({
    facturas: [FACTURA_1, { ...FACTURA_2, client_id: "99999999-9999-9999-9999-999999999999" }],
  });
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, DOS, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /clientes distintos/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
  assert.deepEqual(reg.correlativos, []);
});

test("una factura del lote no existe → 404 antes de insertar nada", async () => {
  const { db, reg } = fake({ facturas: [FACTURA_1] });
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, DOS, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 404);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
});

test("el cap es POR factura: 430 a una factura con saldo 300 → 400 nombrando la factura", async () => {
  const { db, reg } = fake({ facturas: [FACTURA_1, { ...FACTURA_2, balance_due: 300 }] });
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, DOS, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /FAC-HON-000002/);
      assert.match(e.message, /300\.00/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
  assert.deepEqual(reg.correlativos, [], "un rechazo no consume número");
});

test("una factura del lote ya está pagada → 400 nombrándola, nada se inserta", async () => {
  const { db, reg } = fake({ facturas: [FACTURA_1, { ...FACTURA_2, status: "pagada" }] });
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, DOS, db as never),
    (e: Error) => {
      assert.match(e.message, /FAC-HON-000002 ya está completamente pagada/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
});

test("🔴 si el asiento falla, el cobro se deshace pero el número YA se consumió: queda un HUECO (decisión consciente, SOP-031)", async () => {
  const { db, reg } = fake({ postea: { code: "P0001", message: "cerrado" } });
  await assert.rejects(() => createPayment(db as never, TENANT, USER, INPUT, db as never));
  assert.deepEqual(reg.correlativos, ["payment"], "el número se tomó antes del INSERT");
  assert.deepEqual(reg.borrados, ["payments"], "y el cobro se borró igual");
  // No hay forma de devolver el número: la secuencia no tiene rollback. Es el
  // mismo criterio que emitInvoice. Este test existe para que el hueco sea un
  // hecho documentado y no una sorpresa.
});

test("sin la secuencia 'payment' (047 sin aplicar) → 500 que nombra la migración, y no se inserta nada", async () => {
  const { db, reg } = fake({ sinSecuencia: true });
  await assert.rejects(
    () => createPayment(db as never, TENANT, USER, INPUT, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 500);
      assert.match(e.message, /047/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
  assert.equal(reg.posteos, 0);
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

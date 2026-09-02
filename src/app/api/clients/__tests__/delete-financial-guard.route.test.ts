/**
 * Tests del hard delete de cliente con registros financieros asociados.
 *
 * Bug original: invoices/quotes/credit_notes/payments referencian clients(id)
 * con RESTRICT, pero el handler no los chequeaba. El DELETE explotaba con el
 * error crudo de Postgres ("violates foreign key constraint
 * invoices_client_id_fkey") devuelto como 500 y mostrado tal cual en un alert().
 *
 * Y como los documentos se borraban ANTES del DELETE del cliente, cuando la FK
 * fallaba los documentos YA no existían y el cliente seguía vivo:
 * BORRADO PARCIAL con pérdida de datos.
 *
 * El aserto que importa en casi todos los tests de bloqueo es
 * `state.deleted.documents === false`: no alcanza con devolver 400, no se puede
 * haber tocado nada.
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/clients/__tests__/delete-financial-guard.route.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import {
  buildFinancialBlockMessage,
  isForeignKeyViolation,
  GENERIC_FK_BLOCK_MESSAGE,
} from "@/lib/clients/delete-guards";

// ---------------------------------------------------------------------------
// 1) Núcleo PURO
// ---------------------------------------------------------------------------

test("buildFinancialBlockMessage: sin registros → null (se puede borrar)", () => {
  assert.equal(buildFinancialBlockMessage({}), null);
  assert.equal(
    buildFinancialBlockMessage({ invoices: 0, quotes: 0, credit_notes: 0, payments: 0 }),
    null
  );
  assert.equal(buildFinancialBlockMessage({ invoices: null }), null);
});

test("buildFinancialBlockMessage: solo enumera los tipos con conteo > 0", () => {
  const msg = buildFinancialBlockMessage({ invoices: 3, quotes: 0, credit_notes: 0, payments: 2 });
  assert.equal(
    msg,
    "Este cliente tiene registros financieros y no se puede eliminar: 3 factura(s), 2 pago(s). Desactívalo en su lugar."
  );
  assert.equal(msg?.includes("cotización"), false);
  assert.equal(msg?.includes("nota(s) de crédito"), false);
});

test("buildFinancialBlockMessage: los 4 tipos, en orden estable", () => {
  assert.equal(
    buildFinancialBlockMessage({ invoices: 1, quotes: 2, credit_notes: 3, payments: 4 }),
    "Este cliente tiene registros financieros y no se puede eliminar: 1 factura(s), 2 cotización(es), 3 nota(s) de crédito, 4 pago(s). Desactívalo en su lugar."
  );
});

test("buildFinancialBlockMessage: tuteo, no voseo (CLAUDE.md)", () => {
  const msg = buildFinancialBlockMessage({ invoices: 1 })!;
  assert.ok(msg.includes("Desactívalo en su lugar."));
  assert.equal(msg.includes("Desactivalo"), false);
});

test("isForeignKeyViolation: solo 23503", () => {
  assert.equal(isForeignKeyViolation({ code: "23503" }), true);
  assert.equal(isForeignKeyViolation({ code: "23505" }), false);
  assert.equal(isForeignKeyViolation({}), false);
  assert.equal(isForeignKeyViolation(null), false);
  assert.equal(isForeignKeyViolation(undefined), false);
});

// ---------------------------------------------------------------------------
// 2) Handler real con un fake de Supabase.
//    Mismo harness que ruc-taxid-sync.route.test.ts.
// ---------------------------------------------------------------------------

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

type Counts = Record<string, number>;

const state: {
  user: { id: string } | null;
  profile: { tenant_id: string; role: string } | null;
  existingClient: Record<string, unknown> | null;
  counts: Counts;
  documents: { id: string; storage_key: string | null }[];
  clientDeleteError: { code?: string; message: string } | null;
  deleted: { documents: boolean; storage: string[] | null; client: boolean };
  auditLogged: boolean;
} = {
  user: { id: "u1" },
  profile: { tenant_id: "t1", role: "admin" },
  existingClient: null,
  counts: {},
  documents: [],
  clientDeleteError: null,
  deleted: { documents: false, storage: null, client: false },
  auditLogged: false,
};

function makeAdmin() {
  function builder(table: string) {
    const s: { table: string; op: "select" | "count" | "delete" | "insert" | null } = {
      table,
      op: null,
    };

    const resolve = () => {
      if (s.op === "count") {
        return { data: null, count: state.counts[s.table] ?? 0, error: null };
      }
      if (s.op === "delete") {
        if (s.table === "documents") state.deleted.documents = true;
        if (s.table === "clients") {
          if (state.clientDeleteError) return { data: null, error: state.clientDeleteError };
          state.deleted.client = true;
        }
        return { data: null, error: null };
      }
      if (s.table === "documents") return { data: state.documents, error: null };
      return { data: [], error: null };
    };

    const resolveSingle = () => {
      if (s.table === "users") {
        return { data: state.profile, error: state.profile ? null : { message: "not found" } };
      }
      if (s.table === "clients") {
        return {
          data: state.existingClient,
          error: state.existingClient ? null : { message: "not found" },
        };
      }
      return { data: {}, error: null };
    };

    const b: Record<string, unknown> = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        s.op = opts?.count ? "count" : "select";
        return b;
      },
      eq: () => b,
      delete: () => {
        s.op = "delete";
        return b;
      },
      insert: () => {
        if (s.table === "audit_log") state.auditLogged = true;
        s.op = "insert";
        return b;
      },
      single: async () => resolveSingle(),
      maybeSingle: async () => resolveSingle(),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onOk, onErr),
    };
    return b;
  }

  return {
    from: (t: string) => builder(t),
    storage: {
      from: () => ({
        remove: async (keys: string[]) => {
          state.deleted.storage = keys;
          return { data: null, error: null };
        },
      }),
    },
  };
}

if (MOCKS_ENABLED) {
  mock.module("@/lib/supabase/server", {
    namedExports: {
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: state.user } }) },
      }),
    },
  });
  mock.module("@/lib/supabase/admin", {
    namedExports: { createAdminClient: () => makeAdmin() },
  });
}

let POST: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import("@/app/api/clients/[id]/delete/route")) as unknown as {
    POST: typeof POST;
  });
});

const CLIENT_ID = "cli-1";

function reset() {
  state.user = { id: "u1" };
  state.profile = { tenant_id: "t1", role: "admin" };
  state.existingClient = {
    id: CLIENT_ID,
    name: "ACME, S.A.",
    client_number: "CLI-999",
  };
  state.counts = {};
  state.documents = [{ id: "doc-1", storage_key: "t1/clients/cli-1/contrato.pdf" }];
  state.clientDeleteError = null;
  state.deleted = { documents: false, storage: null, client: false };
  state.auditLogged = false;
}

const req = () => ({}) as unknown as NextRequest;
const call = () => POST(req(), { params: { id: CLIENT_ID } });

/** Ningún borrado ocurrió: ni documentos, ni storage, ni el cliente. */
function assertNadaBorrado() {
  assert.equal(state.deleted.documents, false, "NO debe borrar documentos");
  assert.equal(state.deleted.storage, null, "NO debe tocar storage");
  assert.equal(state.deleted.client, false, "NO debe borrar el cliente");
}

// ---- El caso del bug ----

test(
  "cliente CON facturas → 400, mensaje claro y NO borra nada",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.counts = { invoices: 2 };

    const res = await call();
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.equal(
      body.error,
      "Este cliente tiene registros financieros y no se puede eliminar: 2 factura(s). Desactívalo en su lugar."
    );
    assertNadaBorrado();
  }
);

test(
  "el mensaje NO filtra el error crudo de Postgres",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.counts = { invoices: 1 };

    const body = (await (await call()).json()) as { error: string };

    assert.equal(body.error.includes("foreign key"), false);
    assert.equal(body.error.includes("_fkey"), false);
    assert.equal(body.error.includes("violates"), false);
  }
);

test(
  "cliente con cotizaciones / NCs / pagos también bloquea",
  { skip: skipNoMocks },
  async () => {
    for (const [table, esperado] of [
      ["quotes", "1 cotización(es)"],
      ["credit_notes", "1 nota(s) de crédito"],
      ["payments", "1 pago(s)"],
    ] as const) {
      reset();
      state.counts = { [table]: 1 };

      const res = await call();
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400, `${table} debe bloquear`);
      assert.ok(body.error.includes(esperado), `${table}: "${body.error}"`);
      assertNadaBorrado();
    }
  }
);

test(
  "conteos mixtos → enumera solo los tipos presentes",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.counts = { invoices: 3, credit_notes: 1 };

    const body = (await (await call()).json()) as { error: string };

    assert.ok(body.error.includes("3 factura(s)"));
    assert.ok(body.error.includes("1 nota(s) de crédito"));
    assert.equal(body.error.includes("cotización"), false);
    assert.equal(body.error.includes("pago"), false);
  }
);

// ---- El chequeo de casos sigue intacto y sigue yendo primero ----

test(
  "cliente con casos → sigue bloqueando con su mensaje de siempre",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.counts = { cases: 4 };

    const res = await call();
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.equal(body.error, "Este cliente tiene 4 caso(s) asociado(s). Primero hay que eliminar los casos.");
    assertNadaBorrado();
  }
);

// ---- Camino feliz ----

test(
  "cliente SIN nada asociado → 200, borra documentos, storage, cliente y audita",
  { skip: skipNoMocks },
  async () => {
    reset();

    const res = await call();

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
    assert.equal(state.deleted.documents, true);
    assert.deepEqual(state.deleted.storage, ["t1/clients/cli-1/contrato.pdf"]);
    assert.equal(state.deleted.client, true);
    assert.equal(state.auditLogged, true);
  }
);

test(
  "conteos en cero explícito → borra igual",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.counts = { cases: 0, invoices: 0, quotes: 0, credit_notes: 0, payments: 0 };

    assert.equal((await call()).status, 200);
    assert.equal(state.deleted.client, true);
  }
);

// ---- Defensa en profundidad: FK no chequeada ----

test(
  "FK inesperada (23503) en el DELETE → 400 amigable, no 500 crudo",
  { skip: skipNoMocks },
  async () => {
    reset();
    // Pasa todos los chequeos, pero el DELETE choca con otra FK
    // (hoy: prospects.converted_client_id).
    state.clientDeleteError = {
      code: "23503",
      message:
        'update or delete on table "clients" violates foreign key constraint "prospects_converted_client_id_fkey" on table "prospects"',
    };

    const res = await call();
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.equal(body.error, GENERIC_FK_BLOCK_MESSAGE);
    assert.equal(body.error.includes("_fkey"), false);
    assert.equal(state.deleted.client, false);
  }
);

test(
  "error NO-FK en el DELETE → sigue siendo 500 (no se disfraza)",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.clientDeleteError = { code: "08006", message: "connection failure" };

    const res = await call();
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 500);
    assert.equal(body.error, "connection failure");
  }
);

// ---- Autorización intacta ----

test("sin sesión → 401 y no borra", { skip: skipNoMocks }, async () => {
  reset();
  state.user = null;

  assert.equal((await call()).status, 401);
  assertNadaBorrado();
});

test("rol asistente → 403 y no borra", { skip: skipNoMocks }, async () => {
  reset();
  state.profile = { tenant_id: "t1", role: "asistente" };

  assert.equal((await call()).status, 403);
  assertNadaBorrado();
});

test("cliente de otro tenant / inexistente → 404 y no borra", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = null;

  assert.equal((await call()).status, 404);
  assertNadaBorrado();
});

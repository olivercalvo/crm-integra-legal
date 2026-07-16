/**
 * Tests del handler POST /api/prospects/[id]/convert — client_type OBLIGATORIO.
 *
 * La tabla `prospects` (Kanban legal) NO tiene client_type, así que la
 * conversión debe CAPTURARLO en el body. Sin él, el cliente resultante entraría
 * con client_type NULL y rompería la emisión de FE ("Error interno").
 *
 * Vive fuera del directorio `[id]` porque el runner de node trata los corchetes
 * como glob (el import del route con `[id]` sí funciona: es un specifier exacto).
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/prospects/__tests__/convert-client-type.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

// Estado mutable que cada test ajusta antes de invocar el handler.
const state: {
  user: { id: string };
  profile: { tenant_id: string; role: string };
  prospect: Record<string, unknown> | null;
  captured: { insert: Record<string, unknown> | null };
} = {
  user: { id: "u1" },
  profile: { tenant_id: "t1", role: "abogada" },
  prospect: null,
  captured: { insert: null },
};

function makeAdmin() {
  function builder(table: string) {
    const s: { table: string; op: "insert" | "update" | null; payload: Record<string, unknown> | null } = {
      table,
      op: null,
      payload: null,
    };
    const resolve = () => {
      if (s.table === "users") return { data: state.profile, error: null };
      if (s.table === "prospects") {
        if (s.op === null) {
          return { data: state.prospect, error: state.prospect ? null : { message: "not found" } };
        }
        return { data: {}, error: null }; // update converted_client_id
      }
      if (s.table === "clients" && s.op === "insert") {
        state.captured.insert = s.payload;
        return { data: { id: "new-client-id", ...s.payload }, error: null };
      }
      return { data: {}, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      insert: (payload: Record<string, unknown>) => {
        s.op = "insert";
        s.payload = payload;
        return b;
      },
      update: (payload: Record<string, unknown>) => {
        s.op = "update";
        s.payload = payload;
        return b;
      },
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onOk, onErr),
    };
    return b;
  }
  return { from: (t: string) => builder(t) };
}

if (MOCKS_ENABLED) {
  mock.module("@/lib/supabase/server", {
    namedExports: {
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
      }),
    },
  });
  mock.module("@/lib/supabase/admin", {
    namedExports: { createAdminClient: () => makeAdmin() },
  });
  mock.module("@/lib/clients/numbering", {
    namedExports: { allocateClientNumber: async () => "CLI-CONV-001" },
  });
}

let POST: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import("@/app/api/prospects/[id]/convert/route")) as unknown as {
    POST: typeof POST;
  });
});

function req(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

function resetCaptured() {
  // Reasignar el objeto (no el campo) evita que TS estreche insert a `null`
  // — el handler lo muta dentro del closure del fake y TS no lo ve.
  state.captured = { insert: null };
}

function baseProspect() {
  return {
    id: "p1",
    tenant_id: "t1",
    name: "Prospecto Ganado",
    phone: "6000-0000",
    email: "p@x.com",
    notes: "interesado",
    converted_client_id: null,
  };
}

test("convert sin client_type → 400, no crea cliente", { skip: skipNoMocks }, async () => {
  state.prospect = baseProspect();
  resetCaptured();
  const res = await POST(req({}), { params: { id: "p1" } });
  const json = (await res.json()) as { error: string; fieldErrors?: Record<string, string> };
  assert.equal(res.status, 400);
  assert.match(json.error, /tipo de persona es requerido/i);
  assert.equal(json.fieldErrors?.client_type !== undefined, true);
  assert.equal(state.captured.insert, null, "no debe insertarse cliente");
});

test("convert con client_type inválido → 400", { skip: skipNoMocks }, async () => {
  state.prospect = baseProspect();
  resetCaptured();
  const res = await POST(req({ client_type: "empresa" }), { params: { id: "p1" } });
  assert.equal(res.status, 400);
  assert.equal(state.captured.insert, null);
});

test("convert con persona_juridica → 201 y cliente creado CON client_type", { skip: skipNoMocks }, async () => {
  state.prospect = baseProspect();
  resetCaptured();
  const res = await POST(req({ client_type: "persona_juridica" }), { params: { id: "p1" } });
  const json = (await res.json()) as { client: Record<string, unknown> };
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.client_type, "persona_juridica");
  assert.equal(json.client.client_type, "persona_juridica");
});

test("convert con persona_natural → 201 y persiste client_type", { skip: skipNoMocks }, async () => {
  state.prospect = baseProspect();
  resetCaptured();
  const res = await POST(req({ client_type: "persona_natural" }), { params: { id: "p1" } });
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.client_type, "persona_natural");
});

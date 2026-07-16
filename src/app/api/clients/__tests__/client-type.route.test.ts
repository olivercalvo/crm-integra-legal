/**
 * Tests del campo OBLIGATORIO client_type en la API de clientes.
 *
 * Causa raíz (2026-07): clientes creados desde /clientes/nuevo entraban con
 * client_type NULL porque el POST ni lo aceptaba. Al facturar, buildRucReceptor
 * (map-receptor.ts) lanzaba y la factura moría con "Error interno" (CLI-116 el
 * 13/07, CLI-121 el 16/07). Estos tests fijan el contrato en el servidor.
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/clients/__tests__/client-type.route.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import { validateClientType } from "@/lib/clients/fiscal-fields";

// ---------------------------------------------------------------------------
// 1) Validador puro — fuente única usada por POST y PATCH.
// ---------------------------------------------------------------------------

test("validateClientType: falta → error accionable", () => {
  assert.match(validateClientType(undefined) ?? "", /tipo de persona es requerido/i);
  assert.match(validateClientType(null) ?? "", /tipo de persona es requerido/i);
  assert.match(validateClientType("") ?? "", /tipo de persona es requerido/i);
});

test("validateClientType: valor inválido → error", () => {
  assert.notEqual(validateClientType("empresa"), null);
  assert.notEqual(validateClientType("Persona Jurídica"), null); // legacy `type`, no client_type
  assert.notEqual(validateClientType(1), null);
});

test("validateClientType: cada valor válido → null (ok)", () => {
  assert.equal(validateClientType("persona_natural"), null);
  assert.equal(validateClientType("persona_juridica"), null);
});

// ---------------------------------------------------------------------------
// 2) Handlers reales POST / PATCH con un fake de Supabase.
//
// Requiere --experimental-test-module-mocks para mock.module. Si el suite se
// corre SIN el flag, mock.module no existe: salteamos estos tests (no fallan)
// y quedan cubiertos los del validador puro de arriba.
// ---------------------------------------------------------------------------

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

// Estado mutable que cada test ajusta antes de invocar el handler.
const state: {
  user: { id: string };
  profile: { tenant_id: string; role: string };
  existingClient: Record<string, unknown> | null;
  captured: { insert: Record<string, unknown> | null; update: Record<string, unknown> | null };
} = {
  user: { id: "u1" },
  profile: { tenant_id: "t1", role: "admin" },
  existingClient: null,
  captured: { insert: null, update: null },
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
      if (s.table === "clients") {
        if (s.op === "insert") {
          state.captured.insert = s.payload;
          return { data: { id: "new-id", ...s.payload }, error: null };
        }
        if (s.op === "update") {
          state.captured.update = s.payload;
          return { data: { ...(state.existingClient ?? {}), ...s.payload, id: "existing-id" }, error: null };
        }
        return {
          data: state.existingClient,
          error: state.existingClient ? null : { message: "not found" },
        };
      }
      return { data: {}, error: null }; // audit_log u otros
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
        auth: { getUser: async () => ({ data: { user: state.user } }) },
      }),
    },
  });

  mock.module("@/lib/supabase/admin", {
    namedExports: { createAdminClient: () => makeAdmin() },
  });

  mock.module("@/lib/clients/numbering", {
    namedExports: {
      allocateClientNumber: async () => "CLI-TEST-001",
      previewNextClientNumber: async () => "CLI-TEST-001",
      formatClientNumber: (n: number) => `CLI-${n}`,
    },
  });
}

// Import de los handlers DESPUÉS de registrar los mocks (en un hook, para no
// usar top-level await — el archivo transpila a CJS).
let POST: (req: NextRequest) => Promise<Response>;
let PATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import("@/app/api/clients/route")) as unknown as { POST: typeof POST });
  ({ PATCH } = (await import("@/app/api/clients/[id]/route")) as unknown as { PATCH: typeof PATCH });
});

function req(body: unknown) {
  // Los handlers solo usan request.json(); un objeto plano basta en runtime.
  return { json: async () => body } as unknown as NextRequest;
}

function resetCaptured() {
  state.captured = { insert: null, update: null };
  state.existingClient = null;
}

test("POST sin client_type → 400 accionable, no inserta", { skip: skipNoMocks }, async () => {
  resetCaptured();
  const res = await POST(req({ name: "ACME S.A." }));
  const json = (await res.json()) as { error: string; fieldErrors?: Record<string, string> };
  assert.equal(res.status, 400);
  assert.match(json.error, /tipo de persona es requerido/i);
  assert.equal(json.fieldErrors?.client_type !== undefined, true);
  assert.equal(state.captured.insert, null, "no debe llegar al insert");
});

test("POST con persona_natural → 201 y persiste client_type", { skip: skipNoMocks }, async () => {
  resetCaptured();
  const res = await POST(req({ name: "Juan Pérez", client_type: "persona_natural" }));
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.client_type, "persona_natural");
  assert.equal(json.client_type, "persona_natural");
});

test("POST con persona_juridica → 201 y persiste client_type", { skip: skipNoMocks }, async () => {
  resetCaptured();
  const res = await POST(req({ name: "MEI TOWER 2B, S.A", client_type: "persona_juridica" }));
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.client_type, "persona_juridica");
});

test("PATCH cambiando client_type → 200 y persiste el nuevo valor", { skip: skipNoMocks }, async () => {
  resetCaptured();
  state.existingClient = {
    id: "existing-id",
    tenant_id: "t1",
    name: "Cliente Legacy",
    client_type: null, // el registro roto que causaba "Error interno"
    client_status: "active",
    tipo_receptor_fe: null,
    digito_verificador: null,
  };
  const res = await PATCH(req({ client_type: "persona_juridica" }), { params: { id: "existing-id" } });
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.client_type, "persona_juridica");
  assert.equal(json.client_type, "persona_juridica");
});

test("PATCH borrando client_type (null) → 400, no actualiza", { skip: skipNoMocks }, async () => {
  resetCaptured();
  state.existingClient = {
    id: "existing-id",
    tenant_id: "t1",
    name: "Cliente OK",
    client_type: "persona_natural",
    client_status: "active",
  };
  const res = await PATCH(req({ client_type: null }), { params: { id: "existing-id" } });
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(json.error, /tipo de persona es requerido/i);
  assert.equal(state.captured.update, null, "no debe actualizar");
});

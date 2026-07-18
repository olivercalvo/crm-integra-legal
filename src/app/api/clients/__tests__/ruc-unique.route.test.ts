/**
 * Tests de UNICIDAD DE RUC en la API de clientes (POST y PATCH).
 *
 * Causa raíz (2026-07): CLI-116 (INMOBILIARIA CAMAY) se creó con el mismo RUC
 * que CLI-104 sin ninguna alerta. El POST solo validaba client_number, nunca el
 * RUC. El RUC puede vivir en `ruc` (legacy) o `tax_id` (nuevos) → se chequea
 * contra AMBAS. Un RUC ya usado por un cliente ACTIVO no se puede reingresar.
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/clients/__tests__/ruc-unique.route.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import {
  findActiveClientMatch,
  normalizeRucKey,
  type ClientRucCandidate,
} from "@/lib/clients/ruc-lookup";

// ---------------------------------------------------------------------------
// 1) Núcleo PURO — misma lógica que usan POST, PATCH e importación.
// ---------------------------------------------------------------------------

const CANDIDATES: ClientRucCandidate[] = [
  { id: "c104", client_number: "CLI-104", name: "INMOBILIARIA CAMAY, S.A.", ruc: "155-104-2020", tax_id: null, client_status: "active" },
  { id: "c050", client_number: "CLI-050", name: "Cliente En TaxId", ruc: null, tax_id: "8-777-999", client_status: "active" },
  { id: "c009", client_number: "CLI-009", name: "Cliente Inactivo", ruc: "9-9-9", tax_id: null, client_status: "inactive" },
];

test("findActiveClientMatch: RUC de un activo (col ruc) → devuelve la ficha", () => {
  const m = findActiveClientMatch(CANDIDATES, "155-104-2020");
  assert.equal(m?.client_number, "CLI-104");
  assert.equal(m?.name, "INMOBILIARIA CAMAY, S.A.");
});

test("findActiveClientMatch: RUC guardado en tax_id → también matchea", () => {
  const m = findActiveClientMatch(CANDIDATES, "  8-777-999 "); // con espacios → trim
  assert.equal(m?.client_number, "CLI-050");
});

test("findActiveClientMatch: RUC nuevo → null (permitido)", () => {
  assert.equal(findActiveClientMatch(CANDIDATES, "111-222-333"), null);
});

test("findActiveClientMatch: RUC de un cliente INACTIVO → null (permitido)", () => {
  assert.equal(findActiveClientMatch(CANDIDATES, "9-9-9"), null);
});

test("findActiveClientMatch: excludeClientId ignora al propio registro", () => {
  assert.equal(findActiveClientMatch(CANDIDATES, "155-104-2020", "c104"), null);
  // pero sí bloquea si el mismo RUC lo usa OTRO id
  assert.equal(findActiveClientMatch(CANDIDATES, "155-104-2020", "cXXX")?.client_number, "CLI-104");
});

test("normalizeRucKey: null/vacío → '' (no comparable)", () => {
  assert.equal(normalizeRucKey(null), "");
  assert.equal(normalizeRucKey("  "), "");
  assert.equal(normalizeRucKey(" 12-3 "), "12-3");
});

// ---------------------------------------------------------------------------
// 2) Handlers reales POST / PATCH con un fake de Supabase.
//    Requiere --experimental-test-module-mocks. Sin el flag se saltean.
// ---------------------------------------------------------------------------

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

const state: {
  user: { id: string };
  profile: { tenant_id: string; role: string };
  existingClient: Record<string, unknown> | null;
  activeClients: ClientRucCandidate[]; // lo que devuelve el lookup de RUC
  captured: { insert: Record<string, unknown> | null; update: Record<string, unknown> | null };
} = {
  user: { id: "u1" },
  profile: { tenant_id: "t1", role: "admin" },
  existingClient: null,
  activeClients: [],
  captured: { insert: null, update: null },
};

function makeAdmin() {
  function builder(table: string) {
    const s: { table: string; op: "insert" | "update" | null; payload: Record<string, unknown> | null } = {
      table,
      op: null,
      payload: null,
    };
    // Resolución para consultas terminadas con .single()/.maybeSingle().
    const resolveSingle = () => {
      if (s.table === "users") return { data: state.profile, error: null };
      if (s.table === "clients") {
        if (s.op === "insert") {
          state.captured.insert = s.payload;
          return { data: { id: "new-id", client_number: "CLI-TEST-001", ...s.payload }, error: null };
        }
        if (s.op === "update") {
          state.captured.update = s.payload;
          return { data: { ...(state.existingClient ?? {}), ...s.payload, id: state.existingClient?.id ?? "existing-id" }, error: null };
        }
        return {
          data: state.existingClient,
          error: state.existingClient ? null : { message: "not found" },
        };
      }
      return { data: {}, error: null };
    };
    // Resolución para consultas awaited directamente (lookup de RUC → lista).
    const resolveList = () => {
      if (s.table === "clients") return { data: state.activeClients, error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      neq: () => b,
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
      single: async () => resolveSingle(),
      maybeSingle: async () => resolveSingle(),
      // Un insert/update awaited (audit_log) resuelve como single; un select
      // awaited (lookup de RUC) resuelve como lista.
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(s.op ? resolveSingle() : resolveList()).then(onOk, onErr),
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

let POST: (req: NextRequest) => Promise<Response>;
let PATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import("@/app/api/clients/route")) as unknown as { POST: typeof POST });
  ({ PATCH } = (await import("@/app/api/clients/[id]/route")) as unknown as { PATCH: typeof PATCH });
});

function req(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

function reset() {
  state.captured = { insert: null, update: null };
  state.existingClient = null;
  state.activeClients = [];
}

const CAMAY: ClientRucCandidate = {
  id: "c116",
  client_number: "CLI-116",
  name: "INMOBILIARIA CAMAY, S.A.",
  ruc: "155-104-2020",
  tax_id: null,
  client_status: "active",
};

// ---- POST ----

test("POST con RUC de un cliente ACTIVO → 409 nombrando la ficha, no inserta", { skip: skipNoMocks }, async () => {
  reset();
  state.activeClients = [CAMAY];
  const res = await POST(req({ name: "Nueva Camay", client_type: "persona_juridica", ruc: "155-104-2020" }));
  const json = (await res.json()) as {
    error: string;
    fieldErrors?: Record<string, string>;
    existingClient?: { id: string; client_number: string; name: string };
  };
  assert.equal(res.status, 409);
  assert.match(json.error, /CLI-116/);
  assert.match(json.error, /INMOBILIARIA CAMAY/);
  assert.equal(json.fieldErrors?.ruc !== undefined, true);
  assert.equal(json.existingClient?.id, "c116");
  assert.equal(json.existingClient?.client_number, "CLI-116");
  assert.equal(state.captured.insert, null, "no debe llegar al insert");
});

test("POST con RUC NUEVO → 201 (permitido)", { skip: skipNoMocks }, async () => {
  reset();
  state.activeClients = [CAMAY];
  const res = await POST(req({ name: "Cliente Fresco", client_type: "persona_natural", ruc: "111-222-333" }));
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.ruc, "111-222-333");
});

test("POST con RUC de un cliente INACTIVO → 201 (permitido, el inactivo libera el RUC)", { skip: skipNoMocks }, async () => {
  reset();
  state.activeClients = []; // el lookup solo trae NO-inactivos → el inactivo no aparece
  const res = await POST(req({ name: "Reuso RUC", client_type: "persona_juridica", ruc: "9-9-9" }));
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.ruc, "9-9-9");
});

test("POST sin RUC → 201 (no aplica unicidad)", { skip: skipNoMocks }, async () => {
  reset();
  state.activeClients = [CAMAY];
  const res = await POST(req({ name: "Sin RUC", client_type: "persona_natural" }));
  assert.equal(res.status, 201);
});

// ---- PATCH ----

test("PATCH poniendo el RUC de OTRO cliente activo → 409 accionable, no actualiza", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c200",
    tenant_id: "t1",
    name: "Cliente A Editar",
    ruc: "1-1-1",
    client_type: "persona_juridica",
    client_status: "active",
  };
  state.activeClients = [CAMAY]; // otro id (c116) usa 155-104-2020
  const res = await PATCH(req({ ruc: "155-104-2020" }), { params: { id: "c200" } });
  const json = (await res.json()) as {
    error: string;
    existingClient?: { id: string; client_number: string };
  };
  assert.equal(res.status, 409);
  assert.match(json.error, /CLI-116/);
  assert.equal(json.existingClient?.id, "c116");
  assert.equal(state.captured.update, null, "no debe actualizar");
});

test("PATCH sin cambiar el RUC (mismo valor, es el propio) → 200", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c116",
    tenant_id: "t1",
    name: "INMOBILIARIA CAMAY, S.A.",
    ruc: "155-104-2020",
    client_type: "persona_juridica",
    client_status: "active",
  };
  // El lookup trae al propio c116, pero excludeClientId lo ignora.
  state.activeClients = [CAMAY];
  const res = await PATCH(req({ ruc: "155-104-2020", name: "Camay (editado)" }), { params: { id: "c116" } });
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.name, "Camay (editado)");
  assert.equal(json.id, "c116");
});

test("PATCH que no toca el RUC → 200 (no dispara el chequeo)", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c200",
    tenant_id: "t1",
    name: "Cliente",
    ruc: "1-1-1",
    client_type: "persona_natural",
    client_status: "active",
  };
  state.activeClients = [CAMAY];
  const res = await PATCH(req({ phone: "6000-0000" }), { params: { id: "c200" } });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.phone, "6000-0000");
});

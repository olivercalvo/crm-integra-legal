/**
 * Tests del gate de rol en PATCH /api/cases/[id].
 *
 * HISTORIA. Este archivo nació cubriendo un gate DEPENDIENTE DE LA ACCIÓN:
 * change-status → [admin, abogada, asistente]; el resto → [admin, abogada].
 * El 24/08/2026 el cliente redujo el alcance del rol asistente — dentro de un
 * caso solo adjunta documentos y comenta — así que el gate se unificó en
 * [admin, abogada] para TODO el PATCH, change-status incluido.
 *
 * Los tests se mantienen (no se borran) porque siguen siendo la red que evita
 * que el permiso vuelva por accidente: ahora afirman lo contrario de lo que
 * afirmaban antes.
 *
 * Vive fuera del directorio `[id]` porque el runner de node trata los corchetes
 * como glob (el import del route con `[id]` sí funciona: es un specifier exacto).
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/cases/__tests__/patch-role-by-action.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

const state: {
  user: { id: string };
  profile: { tenant_id: string; role: string };
  existingCase: Record<string, unknown> | null;
  captured: { update: Record<string, unknown> | null };
} = {
  user: { id: "u1" },
  profile: { tenant_id: "t1", role: "asistente" },
  existingCase: null,
  captured: { update: null },
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
      if (s.table === "cases") {
        if (s.op === "update") {
          state.captured.update = s.payload;
          return { data: { id: "case-1", ...(state.existingCase ?? {}), ...s.payload }, error: null };
        }
        return { data: state.existingCase, error: state.existingCase ? null : { message: "not found" } };
      }
      if (s.table === "cat_statuses") return { data: { name: "EstadoX" }, error: null };
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
}

let PATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ PATCH } = (await import("@/app/api/cases/[id]/route")) as unknown as { PATCH: typeof PATCH });
});

function req(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

function reset(role: string) {
  state.profile = { tenant_id: "t1", role };
  state.existingCase = { id: "case-1", tenant_id: "t1", status_id: "old-status", classification_id: "c1" };
  state.captured = { update: null };
}

test("asistente + change-status → 403 y NO actualiza (alcance reducido 24/08/2026)", { skip: skipNoMocks }, async () => {
  reset("asistente");
  const res = await PATCH(
    req({ action: "change-status", status_id: "new-status" }),
    { params: { id: "case-1" } }
  );
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 403, "el asistente ya NO puede cambiar el estado de un caso");
  assert.equal(json.error, "Sin permiso");
  assert.equal(state.captured.update, null, "no debe actualizar el caso");
});

test("asistente + edición completa (sin action) → 403 y NO actualiza", { skip: skipNoMocks }, async () => {
  reset("asistente");
  const res = await PATCH(
    req({ description: "editado por asistente", classification_id: "c2" }),
    { params: { id: "case-1" } }
  );
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 403);
  assert.equal(json.error, "Sin permiso");
  assert.equal(state.captured.update, null, "no debe actualizar el caso");
});

test("contador + change-status → 403 (nunca accede a recursos legales)", { skip: skipNoMocks }, async () => {
  reset("contador");
  const res = await PATCH(
    req({ action: "change-status", status_id: "new-status" }),
    { params: { id: "case-1" } }
  );
  assert.equal(res.status, 403);
  assert.equal(state.captured.update, null);
});

test("abogada + change-status → 200 (no regresión del rol pleno)", { skip: skipNoMocks }, async () => {
  reset("abogada");
  const res = await PATCH(
    req({ action: "change-status", status_id: "new-status" }),
    { params: { id: "case-1" } }
  );
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.status_id, "new-status");
});

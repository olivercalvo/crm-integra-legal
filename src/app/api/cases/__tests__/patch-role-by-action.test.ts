/**
 * Tests del gate de rol DEPENDIENTE DE LA ACCIÓN en PATCH /api/cases/[id].
 *
 * Regresión (Fase 1 seguridad): restringimos todo el PATCH a [admin, abogada],
 * pero <CaseStatusChanger> se le renderiza al ASISTENTE sin gate y hace
 * PATCH con action="change-status". CLAUDE.md permite al asistente "actualizar
 * estado" de sus casos → recibía 403 y se le rompía el flujo diario. El fix
 * gatea por acción: change-status → [admin, abogada, asistente]; el resto de la
 * edición → [admin, abogada].
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

test("asistente + change-status → NO 403 (200) y persiste status_id", { skip: skipNoMocks }, async () => {
  reset("asistente");
  const res = await PATCH(
    req({ action: "change-status", status_id: "new-status" }),
    { params: { id: "case-1" } }
  );
  assert.notEqual(res.status, 403, "el asistente NO debe ser bloqueado al cambiar estado");
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.status_id, "new-status");
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

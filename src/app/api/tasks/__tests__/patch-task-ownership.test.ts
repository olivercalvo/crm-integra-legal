/**
 * Tests del guard de PROPIEDAD en PATCH /api/tasks/[id].
 *
 * Contexto (24/08/2026): el asistente pasó a ser un rol de solo lectura sobre
 * los casos, pero CUMPLIR tareas sigue siendo suyo — es su flujo diario. El
 * handler no puede bloquearlo por rol; lo que sí tiene que hacer es limitarlo a
 * las tareas asignadas A ÉL. Antes podía cerrar cualquier tarea del bufete,
 * incluidas las de las abogadas.
 *
 * Este caso NO se verifica en el navegador contra producción: todas las tareas
 * ajenas están pendientes, así que un guard roto cerraría una tarea real de las
 * licenciadas y no hay endpoint para revertirlo. De ahí que la cobertura viva
 * acá, con mocks.
 *
 * Vive fuera del directorio `[id]` porque el runner de node trata los corchetes
 * como glob (el import del route con `[id]` sí funciona: es un specifier exacto).
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/tasks/__tests__/patch-task-ownership.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

const HARRY = "user-asistente";
const DAVEIVA = "user-abogada";

const state: {
  user: { id: string };
  profile: { tenant_id: string; role: string };
  existingTask: Record<string, unknown> | null;
  captured: { update: Record<string, unknown> | null };
} = {
  user: { id: HARRY },
  profile: { tenant_id: "t1", role: "asistente" },
  existingTask: null,
  captured: { update: null },
};

function makeAdmin() {
  function builder(table: string) {
    const s: { table: string; op: "update" | null; payload: Record<string, unknown> | null } = {
      table,
      op: null,
      payload: null,
    };
    const resolve = () => {
      if (s.table === "users") return { data: state.profile, error: null };
      if (s.table === "tasks") {
        if (s.op === "update") {
          state.captured.update = s.payload;
          return { data: { id: "task-1", ...(state.existingTask ?? {}), ...s.payload }, error: null };
        }
        return { data: state.existingTask, error: state.existingTask ? null : { message: "not found" } };
      }
      return { data: {}, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
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
}

let PATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ PATCH } = (await import("@/app/api/tasks/[id]/route")) as unknown as { PATCH: typeof PATCH });
});

function req(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

function reset(role: string, assignedTo: string) {
  state.user = { id: HARRY };
  state.profile = { tenant_id: "t1", role };
  state.existingTask = {
    id: "task-1",
    tenant_id: "t1",
    status: "pendiente",
    assigned_to: assignedTo,
  };
  state.captured = { update: null };
}

test("asistente + tarea propia → 200 y la cierra (flujo diario, no romper)", { skip: skipNoMocks }, async () => {
  reset("asistente", HARRY);
  const res = await PATCH(req({ status: "cumplida" }), { params: { id: "task-1" } });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.status, "cumplida");
});

test("asistente + tarea AJENA → 403 y NO la toca", { skip: skipNoMocks }, async () => {
  reset("asistente", DAVEIVA);
  const res = await PATCH(req({ status: "cumplida" }), { params: { id: "task-1" } });
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 403, "el asistente no puede cerrar tareas de otros");
  assert.match(json.error, /asignadas a ti/);
  assert.equal(state.captured.update, null, "no debe actualizar la tarea");
});

test("abogada + tarea ajena → 200 (gestiona el trabajo del equipo)", { skip: skipNoMocks }, async () => {
  reset("abogada", HARRY);
  const res = await PATCH(req({ status: "cumplida" }), { params: { id: "task-1" } });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.status, "cumplida");
});

test("asistente + tarea propia pero body distinto de cumplida → 400 y NO reasigna", { skip: skipNoMocks }, async () => {
  reset("asistente", HARRY);
  const res = await PATCH(
    req({ status: "pendiente", assigned_to: DAVEIVA, description: "reescrita" }),
    { params: { id: "task-1" } }
  );
  assert.equal(res.status, 400);
  assert.equal(state.captured.update, null, "este handler no reasigna ni edita tareas");
});

/**
 * Tests del CRUD del Plan de Cuentas (chart_of_accounts).
 *
 * Cubre:
 *   1) validadores puros (sin mocks) — código, tipo, longitudes.
 *   2) handlers reales POST / PATCH con un fake de Supabase:
 *      - crear con código duplicado → 400
 *      - crear válida               → 201
 *      - editar                     → 200
 *      - desactivar una is_system   → 409 (bloqueado), no actualiza
 *      - rol no permitido           → 403
 *
 * Ejecución (los handlers requieren el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/finanzas/configuracion/chart-of-accounts/__tests__/chart-of-accounts.route.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import {
  validateCreateChartAccount,
  validateUpdateChartAccount,
} from "@/lib/finanzas/validators/chart-of-account";

// ---------------------------------------------------------------------------
// 1) Validadores PUROS (no requieren mocks).
// ---------------------------------------------------------------------------

test("validateCreateChartAccount: válida → ok con datos normalizados", () => {
  const r = validateCreateChartAccount({
    code: "  5210 ",
    name: "  Gastos de capacitación ",
    account_type: "expense",
    description: "  nota  ",
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.code, "5210");
    assert.equal(r.data.name, "Gastos de capacitación");
    assert.equal(r.data.account_type, "expense");
    assert.equal(r.data.description, "nota");
    assert.equal(r.data.active, true);
  }
});

test("validateCreateChartAccount: sin código → error de code", () => {
  const r = validateCreateChartAccount({ name: "X Y", account_type: "asset" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.code);
});

test("validateCreateChartAccount: tipo inválido (español crudo) → error de account_type", () => {
  const r = validateCreateChartAccount({
    code: "9999",
    name: "Cuenta",
    account_type: "Activo", // debe llegar en inglés
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.account_type);
});

test("validateCreateChartAccount: código con caracteres inválidos → error", () => {
  const r = validateCreateChartAccount({
    code: "52 10/x",
    name: "Cuenta",
    account_type: "expense",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.code);
});

test("validateUpdateChartAccount: sin código → ok (code opcional)", () => {
  const r = validateUpdateChartAccount({
    name: "Renombrada",
    account_type: "income",
    active: false,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.code, undefined);
    assert.equal(r.data.active, false);
  }
});

// ---------------------------------------------------------------------------
// 2) Handlers reales POST / PATCH con un fake de Supabase.
//    Requiere --experimental-test-module-mocks. Sin el flag se saltean.
// ---------------------------------------------------------------------------

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

type Account = Record<string, unknown> & { id: string };

const state: {
  user: { id: string };
  profile: { full_name: string; role: string; tenant_id: string };
  existingAccount: Account | null; // para el fetch de UPDATE
  dupByCode: Account | null; // lo que devuelve findChartAccountByCode
  captured: {
    insert: Record<string, unknown> | null;
    update: Record<string, unknown> | null;
    audit: Record<string, unknown>[];
  };
} = {
  user: { id: "u1" },
  profile: { full_name: "Tester", role: "admin", tenant_id: "t1" },
  existingAccount: null,
  dupByCode: null,
  captured: { insert: null, update: null, audit: [] },
};

function makeAdmin() {
  function builder(table: string) {
    const s: {
      table: string;
      op: "insert" | "update" | null;
      payload: Record<string, unknown> | null;
      selectCols: string;
    } = { table, op: null, payload: null, selectCols: "" };

    const resolve = () => {
      if (s.table === "users") return { data: state.profile, error: null };
      if (s.table === "chart_of_accounts") {
        if (s.op === "insert") {
          state.captured.insert = s.payload;
          return { data: { id: "new-id", is_system: false, ...s.payload }, error: null };
        }
        if (s.op === "update") {
          state.captured.update = s.payload;
          return {
            data: {
              ...(state.existingAccount ?? {}),
              ...s.payload,
              id: state.existingAccount?.id ?? "acc-id",
            },
            error: null,
          };
        }
        // SELECT terminado en maybeSingle: distinguimos por columnas.
        //  - findChartAccountByCode selecciona "id, code, account_type, is_system"
        //  - el fetch de existencia (UPDATE) incluye "name"
        if (s.selectCols.includes("name")) {
          return { data: state.existingAccount, error: null };
        }
        return { data: state.dupByCode, error: null };
      }
      if (s.table === "audit_log") {
        if (s.payload) state.captured.audit.push(s.payload);
        return { data: {}, error: null };
      }
      return { data: {}, error: null };
    };

    const b: Record<string, unknown> = {
      select: (cols?: string) => {
        s.selectCols = String(cols ?? "");
        return b;
      },
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
      // Un insert awaited (audit_log) resuelve por `then`.
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

let POST: (req: NextRequest) => Promise<Response>;
let PATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import(
    "@/app/api/finanzas/configuracion/chart-of-accounts/route"
  )) as unknown as { POST: typeof POST });
  ({ PATCH } = (await import(
    "@/app/api/finanzas/configuracion/chart-of-accounts/[id]/route"
  )) as unknown as { PATCH: typeof PATCH });
});

function req(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

function reset() {
  state.profile = { full_name: "Tester", role: "admin", tenant_id: "t1" };
  state.existingAccount = null;
  state.dupByCode = null;
  state.captured = { insert: null, update: null, audit: [] };
}

// ---- POST (crear) ----

test("POST crear con código DUPLICADO → 400, no inserta", { skip: skipNoMocks }, async () => {
  reset();
  state.dupByCode = { id: "acc-existing", code: "1201", account_type: "asset", is_system: false };
  const res = await POST(
    req({ code: "1201", name: "Cuenta repetida", account_type: "asset", active: true })
  );
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(json.error, /1201/);
  assert.equal(state.captured.insert, null, "no debe llegar al insert");
});

test("POST crear VÁLIDA → 201, inserta con is_system=false", { skip: skipNoMocks }, async () => {
  reset();
  state.dupByCode = null;
  const res = await POST(
    req({ code: "5210", name: "Gastos de capacitación", account_type: "expense", description: "cursos", active: true })
  );
  const json = (await res.json()) as { account: { code: string; is_system: boolean } };
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.code, "5210");
  assert.equal(state.captured.insert?.is_system, false);
  assert.equal(state.captured.insert?.is_trust_pass_through, false);
  assert.equal(json.account.code, "5210");
  assert.equal(state.captured.audit.length, 1, "debe registrar audit_log de create");
});

test("POST con rol NO permitido (asistente) → 403, no inserta", { skip: skipNoMocks }, async () => {
  reset();
  state.profile.role = "asistente";
  const res = await POST(
    req({ code: "5211", name: "Otra cuenta", account_type: "expense", active: true })
  );
  assert.equal(res.status, 403);
  assert.equal(state.captured.insert, null);
});

// ---- PATCH (editar) ----

test("PATCH editar nombre/tipo/desc → 200, actualiza", { skip: skipNoMocks }, async () => {
  reset();
  state.existingAccount = {
    id: "acc1",
    code: "5210",
    name: "Gastos de capacitación",
    account_type: "expense",
    description: null,
    active: true,
    is_system: false,
  };
  const res = await PATCH(
    req({ name: "Gastos de formación", account_type: "expense", description: "renombrada", active: true }),
    { params: { id: "acc1" } }
  );
  const json = (await res.json()) as { account: { name: string } };
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.name, "Gastos de formación");
  assert.equal(json.account.name, "Gastos de formación");
});

test("PATCH desactivar una cuenta is_system → 409 (bloqueado), no actualiza", { skip: skipNoMocks }, async () => {
  reset();
  state.existingAccount = {
    id: "acc-sys",
    code: "4101",
    name: "Honorarios profesionales",
    account_type: "income",
    description: null,
    active: true,
    is_system: true,
  };
  const res = await PATCH(
    req({ name: "Honorarios profesionales", account_type: "income", description: null, active: false }),
    { params: { id: "acc-sys" } }
  );
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 409);
  assert.match(json.error, /sistema/i);
  assert.equal(state.captured.update, null, "no debe actualizar una cuenta del sistema");
});

test("PATCH cambiar el CÓDIGO de una cuenta NORMAL → 400 (código inmutable), no actualiza", { skip: skipNoMocks }, async () => {
  reset();
  state.existingAccount = {
    id: "acc-normal",
    code: "5210",
    name: "Gastos de capacitación",
    account_type: "expense",
    description: null,
    active: true,
    is_system: false, // cuenta normal: el código igual es inmutable
  };
  const res = await PATCH(
    req({ code: "5299", name: "Gastos de capacitación", account_type: "expense", description: null, active: true }),
    { params: { id: "acc-normal" } }
  );
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(json.error, /código/i);
  assert.equal(state.captured.update, null, "no debe actualizar si intentan cambiar el código");
});

test("PATCH con rol NO permitido (asistente) → 403", { skip: skipNoMocks }, async () => {
  reset();
  state.profile.role = "asistente";
  state.existingAccount = {
    id: "acc1",
    code: "5210",
    name: "X",
    account_type: "expense",
    description: null,
    active: true,
    is_system: false,
  };
  const res = await PATCH(
    req({ name: "Nuevo", account_type: "expense", description: null, active: true }),
    { params: { id: "acc1" } }
  );
  assert.equal(res.status, 403);
  assert.equal(state.captured.update, null);
});

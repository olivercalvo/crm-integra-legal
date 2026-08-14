/**
 * Tests del CRUD del Plan de Cuentas (chart_of_accounts).
 *
 * Cubre:
 *   1) validadores puros (sin mocks) — código, tipo, longitudes,
 *      saldo_inicial (default 0, negativos, rango) y subcategoria.
 *   2) handlers reales POST / PATCH con un fake de Supabase:
 *      - crear con código duplicado → 400
 *      - crear válida               → 201
 *      - crear con saldo_inicial + subcategoria → 201, persiste y audita
 *      - crear sin saldo_inicial    → 201 con saldo_inicial = 0
 *      - editar                     → 200
 *      - editar saldo_inicial + subcategoria → 200, persiste y audita
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

// ---- saldo_inicial + subcategoria (Paso 1a plan contable) ----

test("validateCreateChartAccount: saldo_inicial + subcategoria válidos → ok", () => {
  const r = validateCreateChartAccount({
    code: "130003",
    name: "Fondo Legales de Clientes",
    account_type: "asset",
    subcategoria: "activo_corriente",
    saldo_inicial: 1500.5,
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.subcategoria, "activo_corriente");
    assert.equal(r.data.saldo_inicial, 1500.5);
  }
});

test("validateCreateChartAccount: sin saldo_inicial → default 0", () => {
  const r = validateCreateChartAccount({
    code: "600001",
    name: "Alquiler de oficina",
    account_type: "expense",
    subcategoria: "gasto_operativo",
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.saldo_inicial, 0);
    assert.equal(r.data.subcategoria, "gasto_operativo");
  }
});

test("validateCreateChartAccount: sin subcategoria → null (sin clasificar)", () => {
  const r = validateCreateChartAccount({
    code: "600002",
    name: "Otros gastos",
    account_type: "expense",
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.data.subcategoria, null);
});

test("validateCreateChartAccount: subcategoria vacía ('') → null, no error", () => {
  const r = validateCreateChartAccount({
    code: "600003",
    name: "Sin clasificar",
    account_type: "expense",
    subcategoria: "",
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.data.subcategoria, null);
});

test("validateCreateChartAccount: subcategoria inválida (label en español) → error", () => {
  const r = validateCreateChartAccount({
    code: "600004",
    name: "Cuenta",
    account_type: "expense",
    subcategoria: "Gasto operativo", // debe llegar en snake_case
    active: true,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.subcategoria);
});

test("validateCreateChartAccount: saldo_inicial NEGATIVO → permitido (contra-cuenta)", () => {
  const r = validateCreateChartAccount({
    code: "120009",
    name: "Depreciación acumulada",
    account_type: "asset",
    subcategoria: "propiedad_planta_equipo",
    saldo_inicial: -8400.25,
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.data.saldo_inicial, -8400.25);
});

test("validateCreateChartAccount: saldo_inicial redondea a 2 decimales", () => {
  const r = validateCreateChartAccount({
    code: "100001",
    name: "Caja",
    account_type: "asset",
    saldo_inicial: "1234.567",
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.data.saldo_inicial, 1234.57);
});

test("validateCreateChartAccount: saldo_inicial no numérico → error", () => {
  const r = validateCreateChartAccount({
    code: "100002",
    name: "Banco",
    account_type: "asset",
    saldo_inicial: "mil quinientos",
    active: true,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.saldo_inicial);
});

test("validateCreateChartAccount: saldo_inicial fuera de numeric(14,2) → error", () => {
  const r = validateCreateChartAccount({
    code: "100003",
    name: "Banco",
    account_type: "asset",
    saldo_inicial: 1e13,
    active: true,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.saldo_inicial);
});

test("validateUpdateChartAccount: saldo_inicial + subcategoria llegan al payload", () => {
  const r = validateUpdateChartAccount({
    name: "Fondo Legales de Clientes",
    account_type: "asset",
    subcategoria: "activo_no_corriente",
    saldo_inicial: 999.99,
    active: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.subcategoria, "activo_no_corriente");
    assert.equal(r.data.saldo_inicial, 999.99);
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

test(
  "POST crear con saldo_inicial + subcategoria → 201, persiste ambos y los audita",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.dupByCode = null;
    const res = await POST(
      req({
        code: "130003",
        name: "Fondo Legales de Clientes",
        account_type: "asset",
        subcategoria: "activo_corriente",
        saldo_inicial: 12500.75,
        active: true,
      })
    );
    const json = (await res.json()) as {
      account: { subcategoria: string; saldo_inicial: number };
    };
    assert.equal(res.status, 201);

    // Persistencia: ambos campos llegan al INSERT.
    assert.equal(state.captured.insert?.subcategoria, "activo_corriente");
    assert.equal(state.captured.insert?.saldo_inicial, 12500.75);

    // Y vuelven en la respuesta que la UI mete en su estado local.
    assert.equal(json.account.subcategoria, "activo_corriente");
    assert.equal(json.account.saldo_inicial, 12500.75);

    // Auditoría: el new_value del audit_log incluye ambos campos.
    assert.equal(state.captured.audit.length, 1);
    const audited = JSON.parse(String(state.captured.audit[0].new_value)) as {
      subcategoria: string;
      saldo_inicial: number;
    };
    assert.equal(audited.subcategoria, "activo_corriente");
    assert.equal(audited.saldo_inicial, 12500.75);
  }
);

test(
  "POST crear SIN saldo_inicial → 201 con saldo_inicial = 0 (default)",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.dupByCode = null;
    const res = await POST(
      req({
        code: "600001",
        name: "Alquiler de oficina",
        account_type: "expense",
        subcategoria: "gasto_operativo",
        active: true,
      })
    );
    const json = (await res.json()) as { account: { saldo_inicial: number } };
    assert.equal(res.status, 201);
    assert.equal(state.captured.insert?.saldo_inicial, 0, "default explícito 0");
    assert.equal(json.account.saldo_inicial, 0);

    const audited = JSON.parse(String(state.captured.audit[0].new_value)) as {
      saldo_inicial: number;
    };
    assert.equal(audited.saldo_inicial, 0);
  }
);

test(
  "POST crear con subcategoria INVÁLIDA → 400 con fieldError, no inserta",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.dupByCode = null;
    const res = await POST(
      req({
        code: "600009",
        name: "Cuenta",
        account_type: "expense",
        subcategoria: "gastos_varios", // no está en SUBCATEGORIAS
        active: true,
      })
    );
    const json = (await res.json()) as { fieldErrors?: Record<string, string> };
    assert.equal(res.status, 400);
    assert.ok(json.fieldErrors?.subcategoria);
    assert.equal(state.captured.insert, null, "no debe llegar al insert");
  }
);

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

test(
  "PATCH editar saldo_inicial + subcategoria → 200, persiste ambos y los audita",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.existingAccount = {
      id: "acc-saldo",
      code: "130003",
      name: "Fondo Legales de Clientes",
      account_type: "asset",
      subcategoria: null,
      saldo_inicial: 0,
      description: null,
      active: true,
      is_system: false,
    };
    const res = await PATCH(
      req({
        name: "Fondo Legales de Clientes",
        account_type: "asset",
        subcategoria: "activo_corriente",
        saldo_inicial: 8300.4,
        description: null,
        active: true,
      }),
      { params: { id: "acc-saldo" } }
    );
    const json = (await res.json()) as {
      account: { subcategoria: string; saldo_inicial: number };
    };
    assert.equal(res.status, 200);

    // Persistencia
    assert.equal(state.captured.update?.subcategoria, "activo_corriente");
    assert.equal(state.captured.update?.saldo_inicial, 8300.4);
    assert.equal(json.account.saldo_inicial, 8300.4);

    // Auditoría: el diff registra los dos campos con su old → new.
    assert.equal(state.captured.audit.length, 1);
    const entry = state.captured.audit[0];
    assert.match(String(entry.field), /subcategoria/);
    assert.match(String(entry.field), /saldo_inicial/);
    const oldVal = JSON.parse(String(entry.old_value)) as Record<string, unknown>;
    const newVal = JSON.parse(String(entry.new_value)) as Record<string, unknown>;
    assert.equal(oldVal.subcategoria, null);
    assert.equal(oldVal.saldo_inicial, 0);
    assert.equal(newVal.subcategoria, "activo_corriente");
    assert.equal(newVal.saldo_inicial, 8300.4);
  }
);

test(
  "PATCH que reenvía el MISMO saldo_inicial como string numeric → no audita cambio fantasma",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.existingAccount = {
      id: "acc-fantasma",
      code: "130003",
      name: "Fondo Legales de Clientes",
      account_type: "asset",
      subcategoria: "activo_corriente",
      // Postgres/PostgREST puede devolver numeric como string "8300.40".
      saldo_inicial: "8300.40",
      description: null,
      active: true,
      is_system: false,
    };
    const res = await PATCH(
      req({
        name: "Fondo Legales de Clientes",
        account_type: "asset",
        subcategoria: "activo_corriente",
        saldo_inicial: 8300.4,
        description: null,
        active: true,
      }),
      { params: { id: "acc-fantasma" } }
    );
    assert.equal(res.status, 200);
    assert.equal(
      state.captured.audit.length,
      0,
      "8300.40 (string) y 8300.4 (number) son el mismo saldo: no hay nada que auditar"
    );
  }
);

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

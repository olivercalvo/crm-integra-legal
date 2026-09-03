/**
 * `GET / PATCH /api/finanzas/periodos` — cerrar y reabrir períodos.
 *
 * Lo que protege:
 *
 *   1. 🔴 **Al reabrir, `closed_at` y `closed_by` NO se tocan.** Es la decisión
 *      central de la ruta: limpiarlos dejaría un período reabierto idéntico a uno
 *      que nunca se cerró, y ese es justo el hecho que hay que ver.
 *   2. **Una acción que no cambia nada no escribe.** Un cierre repetido pisaría
 *      `closed_at` con una fecha nueva y perdería la original.
 *   3. **El rol**: admin y contador. La abogada NO.
 *   4. **SOP-014**: el `tenant_id` sale del perfil, nunca del body.
 *   5. La ruta **no crea ni borra** períodos: solo opera los que existen.
 *
 * Ejecución:  npm test
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

const state: {
  user: { id: string } | null;
  profile: { role: string; tenant_id: string } | null;
  periodo: { id: string; status: string; closed_at: string | null } | null;
  capturado: {
    update: Record<string, unknown> | null;
    filtrosUpdate: Record<string, unknown>;
    audit: Record<string, unknown> | null;
    tablas: string[];
  };
} = {
  user: null,
  profile: null,
  periodo: null,
  capturado: { update: null, filtrosUpdate: {}, audit: null, tablas: [] },
};

function reset(over: Partial<typeof state> = {}) {
  state.user = { id: "u-contador" };
  state.profile = { role: "contador", tenant_id: "t-real" };
  state.periodo = { id: "per-1", status: "abierto", closed_at: null };
  state.capturado = { update: null, filtrosUpdate: {}, audit: null, tablas: [] };
  Object.assign(state, over);
}

function makeAdmin() {
  function builder(table: string) {
    state.capturado.tablas.push(table);
    const filtros: Record<string, unknown> = {};
    let op: string | null = null;
    let payload: unknown = null;

    const resolve = () => {
      if (table === "users") return { data: state.profile, error: null };
      if (table === "accounting_periods") {
        if (op === "update") {
          state.capturado.update = payload as Record<string, unknown>;
          state.capturado.filtrosUpdate = { ...filtros };
          return { data: null, error: null };
        }
        return { data: state.periodo, error: null };
      }
      if (table === "audit_log" && op === "insert") {
        state.capturado.audit = payload as Record<string, unknown>;
        return { data: null, error: null };
      }
      if (table === "journal_entries") return { data: [], error: null };
      return { data: null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        filtros[c] = v;
        return b;
      },
      in: () => b,
      order: () => b,
      update: (p: unknown) => {
        op = "update";
        payload = p;
        return b;
      },
      insert: (p: unknown) => {
        op = "insert";
        payload = p;
        return b;
      },
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(ok, err),
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

let PATCH: (req: NextRequest) => Promise<Response>;
let GET: () => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  const m = (await import("@/app/api/finanzas/periodos/route")) as unknown as {
    PATCH: typeof PATCH;
    GET: typeof GET;
  };
  PATCH = m.PATCH;
  GET = m.GET;
});

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const CERRAR = { year: 2026, month: 3, accion: "cerrar" };
const REABRIR = { year: 2026, month: 3, accion: "reabrir" };

// ===========================================================================
// 1. 🔴 AL REABRIR NO SE TOCAN closed_at NI closed_by
// ===========================================================================

test(
  "🔴 reabrir cambia SOLO `status`: conserva closed_at y closed_by",
  { skip: skipNoMocks },
  async () => {
    reset({ periodo: { id: "per-1", status: "cerrado", closed_at: "2026-04-01T10:00:00Z" } });
    const res = await PATCH(req(REABRIR));
    assert.equal(res.status, 200);

    const u = state.capturado.update!;
    assert.deepEqual(
      Object.keys(u).sort(),
      ["status"],
      "\n🔴 Limpiar closed_at/closed_by dejaría un período reabierto IDÉNTICO a uno\n" +
        "   que nunca se cerró. No son lo mismo: el primero es un ejercicio que el\n" +
        "   contador ya dio por certificado ante la DGI.\n"
    );
    assert.equal(u.status, "abierto");
  }
);

test("cerrar SÍ escribe closed_at y closed_by", { skip: skipNoMocks }, async () => {
  reset();
  await PATCH(req(CERRAR));
  const u = state.capturado.update!;
  assert.equal(u.status, "cerrado");
  assert.equal(u.closed_by, "u-contador", "queda quién lo cerró");
  assert.ok(typeof u.closed_at === "string" && u.closed_at.length > 0);
});

// ===========================================================================
// 2. LA ACCIÓN QUE NO CAMBIA NADA NO ESCRIBE
// ===========================================================================

test(
  "cerrar uno YA cerrado no escribe — no pisa la fecha original",
  { skip: skipNoMocks },
  async () => {
    reset({ periodo: { id: "per-1", status: "cerrado", closed_at: "2026-04-01T10:00:00Z" } });
    const res = await PATCH(req(CERRAR));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sinCambios, true);
    assert.equal(
      state.capturado.update,
      null,
      "un cierre repetido pisaría closed_at con una fecha nueva y perdería la original"
    );
    assert.equal(state.capturado.audit, null, "tampoco ensucia la auditoría");
  }
);

test("reabrir uno YA abierto no escribe", { skip: skipNoMocks }, async () => {
  reset();
  const res = await PATCH(req(REABRIR));
  assert.equal((await res.json()).sinCambios, true);
  assert.equal(state.capturado.update, null);
});

// ===========================================================================
// 3. AUDITORÍA
// ===========================================================================

test(
  "🔑 el audit_log usa `update`, que es lo que el CHECK permite",
  { skip: skipNoMocks },
  async () => {
    // `audit_log.action` tiene CHECK (action IN ('create','update','delete')) desde
    // el esquema inicial. Un "close" o "reopen" lo rechazaría la base — y como el
    // insert no corta el flujo, la entrada simplemente no se escribiría, en
    // silencio. Cerrar y reabrir se distinguen por old_value → new_value.
    reset();
    await PATCH(req(CERRAR));
    const a = state.capturado.audit!;
    assert.equal(a.action, "update");
    assert.equal(a.field, "status");
    assert.equal(a.old_value, "abierto");
    assert.equal(a.new_value, "cerrado");
    assert.equal(a.entity, "accounting_period");
    assert.equal(a.user_id, "u-contador");
  }
);

test("la reapertura queda auditada con su transición", { skip: skipNoMocks }, async () => {
  reset({ periodo: { id: "per-1", status: "cerrado", closed_at: "2026-04-01T10:00:00Z" } });
  await PATCH(req(REABRIR));
  const a = state.capturado.audit!;
  assert.equal(a.old_value, "cerrado");
  assert.equal(a.new_value, "abierto");
});

// ===========================================================================
// 4. SOP-014 Y ALCANCE
// ===========================================================================

test(
  "el UPDATE se acota al tenant del PERFIL aunque el body mande otro",
  { skip: skipNoMocks },
  async () => {
    reset();
    await PATCH(req({ ...CERRAR, tenant_id: "t-de-otro-bufete" }));
    assert.equal(state.capturado.filtrosUpdate.tenant_id, "t-real");
    assert.equal(state.capturado.audit?.tenant_id, "t-real");
  }
);

test(
  "la ruta NO crea ni borra períodos: solo opera los que existen",
  { skip: skipNoMocks },
  async () => {
    // Crear períodos es exclusivo de `ensure_accounting_periods()`, y la 030 le
    // revocó INSERT a service_role justamente para que no haya dos caminos.
    reset({ periodo: null });
    const res = await PATCH(req(CERRAR));
    assert.equal(res.status, 404);
    assert.equal(state.capturado.update, null);
    assert.match((await res.json()).error, /no existe en el sistema/);
  }
);

// ===========================================================================
// 5. ENTRADA
// ===========================================================================

test("una acción desconocida → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await PATCH(req({ year: 2026, month: 3, accion: "borrar" }));
  assert.equal(res.status, 400);
  assert.equal(state.capturado.update, null);
});

test("un mes fuera de 1..12 → 400", { skip: skipNoMocks }, async () => {
  reset();
  assert.equal((await PATCH(req({ year: 2026, month: 13, accion: "cerrar" }))).status, 400);
  assert.equal((await PATCH(req({ year: 2026, month: 0, accion: "cerrar" }))).status, 400);
});

test("sin año → 400", { skip: skipNoMocks }, async () => {
  reset();
  assert.equal((await PATCH(req({ month: 3, accion: "cerrar" }))).status, 400);
});

// ===========================================================================
// 6. PERMISOS
// ===========================================================================

test("el admin puede", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "admin", tenant_id: "t-real" } });
  assert.equal((await PATCH(req(CERRAR))).status, 200);
});

test(
  "🔒 la ABOGADA no puede cerrar ni reabrir → 403",
  { skip: skipNoMocks },
  async () => {
    reset({ profile: { role: "abogada", tenant_id: "t-real" } });
    assert.equal((await PATCH(req(CERRAR))).status, 403);
    assert.equal(state.capturado.update, null);
    reset({ profile: { role: "abogada", tenant_id: "t-real" } });
    assert.equal((await PATCH(req(REABRIR))).status, 403);
  }
);

test("la abogada tampoco LEE la lista → 403", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "abogada", tenant_id: "t-real" } });
  assert.equal((await GET()).status, 403);
});

test("el asistente tampoco → 403", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "asistente", tenant_id: "t-real" } });
  assert.equal((await PATCH(req(CERRAR))).status, 403);
});

test("sin sesión → 401", { skip: skipNoMocks }, async () => {
  reset({ user: null });
  assert.equal((await PATCH(req(CERRAR))).status, 401);
  reset({ user: null });
  assert.equal((await GET()).status, 401);
});

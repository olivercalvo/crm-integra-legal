/**
 * 🔑 LA ASIGNACIÓN MASIVA SOLO LLENA BLANCOS. NUNCA PISA UNA CLASIFICACIÓN.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ PROTEGE
 * ═════════════════════════════════════════════════════════════════════════════
 * `POST /api/expenses/lines/bulk-classify` puede escribir decenas de filas con un
 * clic. Sin la restricción `chart_account_code IS NULL`, un clic sobre 40 líneas
 * destruye clasificaciones que alguien decidió una por una y que **nadie recuerda
 * cuáles eran** — no hay historial de la cuenta anterior. Con ella, lo peor que
 * puede pasar es que no haga nada.
 *
 * Y ese mismo filtro hace un segundo trabajo que no es obvio: **garantiza que la
 * masiva nunca toca un gasto ya asentado en el libro contable.** Un gasto no se
 * puede postear con líneas en NULL (el asiento no se puede armar contra una
 * cuenta nula, y desde la `037` la base tampoco deja nacer una así), o sea que
 * toda línea en NULL pertenece por definición a un gasto NO posteado.
 *
 * Por eso la ruta NO tiene un guard aparte de "gasto posteado", **y eso también
 * se verifica acá**: un segundo chequeo que siempre da lo mismo que el primero es
 * código que nadie puede probar que haga falta, y el día que alguien simplifique
 * va a sacar el equivocado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL FAKE REGISTRA LA CADENA EN VEZ DE SIMULAR UNA BASE
 * ─────────────────────────────────────────────────────────────────────────────
 * Un fake que "filtrara" de mentira sería peor que no tener test: pasaría igual
 * si el `.is()` desapareciera, porque el filtrado lo estaría haciendo el fake y
 * no el código. Acá el fake **anota qué filtros se le pidieron** y el test afirma
 * sobre esa lista. Se prueba el código real, no una base imaginaria.
 *
 * Ejecución:  npm test
 *   (o: npx tsx --test --experimental-test-module-mocks <este archivo>)
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

/** Un filtro pedido al query builder. */
interface Filtro {
  metodo: "eq" | "in" | "is" | "not";
  campo: string;
  valor: unknown;
}

const state: {
  user: { id: string } | null;
  profile: { role: string; tenant_id: string } | null;
  cuenta: { code: string; name: string; active: boolean } | null;
  /** Cuántas filas "devuelve" el UPDATE. Simula que algunas ya estaban hechas. */
  filasActualizadas: number;
  capturado: {
    tablas: string[];
    updatePayload: Record<string, unknown> | null;
    filtrosDelUpdate: Filtro[];
    huboUpdate: boolean;
  };
} = {
  user: { id: "u1" },
  profile: { role: "abogada", tenant_id: "t-real" },
  cuenta: { code: "130003", name: "Fondo Legales de Clientes", active: true },
  filasActualizadas: 3,
  capturado: { tablas: [], updatePayload: null, filtrosDelUpdate: [], huboUpdate: false },
};

function reset(over: Partial<typeof state> = {}) {
  state.user = { id: "u1" };
  state.profile = { role: "abogada", tenant_id: "t-real" };
  state.cuenta = { code: "130003", name: "Fondo Legales de Clientes", active: true };
  state.filasActualizadas = 3;
  state.capturado = {
    tablas: [],
    updatePayload: null,
    filtrosDelUpdate: [],
    huboUpdate: false,
  };
  Object.assign(state, over);
}

function makeAdmin() {
  function builder(table: string) {
    state.capturado.tablas.push(table);

    const s: {
      op: "update" | null;
      payload: Record<string, unknown> | null;
      filtros: Filtro[];
    } = { op: null, payload: null, filtros: [] };

    const anotar = (metodo: Filtro["metodo"], campo: string, valor: unknown) => {
      s.filtros.push({ metodo, campo, valor });
      return b;
    };

    const resolve = () => {
      if (table === "users") return { data: state.profile, error: null };
      if (table === "chart_of_accounts") return { data: state.cuenta, error: null };
      if (table === "expense_lines" && s.op === "update") {
        state.capturado.huboUpdate = true;
        state.capturado.updatePayload = s.payload;
        state.capturado.filtrosDelUpdate = s.filtros;
        return {
          data: Array.from({ length: state.filasActualizadas }, (_, i) => ({ id: `l${i}` })),
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (campo: string, valor: unknown) => anotar("eq", campo, valor),
      in: (campo: string, valor: unknown) => anotar("in", campo, valor),
      is: (campo: string, valor: unknown) => anotar("is", campo, valor),
      not: (campo: string, _op: string, valor: unknown) => anotar("not", campo, valor),
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

let POST: (req: NextRequest) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import(
    "@/app/api/expenses/lines/bulk-classify/route"
  )) as unknown as { POST: typeof POST });
});

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function filtro(metodo: Filtro["metodo"], campo: string): Filtro | undefined {
  return state.capturado.filtrosDelUpdate.find(
    (f) => f.metodo === metodo && f.campo === campo
  );
}

// ===========================================================================
// LA REGLA CENTRAL
// ===========================================================================

test(
  "🔑 el UPDATE filtra por `chart_account_code IS NULL` — solo llena blancos",
  { skip: skipNoMocks },
  async () => {
    reset();
    const res = await POST(
      req({ line_ids: ["l1", "l2", "l3"], chart_account_code: "130003" })
    );

    assert.equal(res.status, 200);
    assert.equal(state.capturado.huboUpdate, true, "se esperaba un UPDATE");

    const f = filtro("is", "chart_account_code");
    assert.ok(
      f,
      "\n🔑 El UPDATE masivo NO filtra por `chart_account_code IS NULL`.\n\n" +
        "   Sin ese filtro, un clic sobre 40 líneas PISA clasificaciones que\n" +
        "   alguien decidió una por una y que nadie recuerda cuáles eran: no hay\n" +
        "   historial de la cuenta anterior.\n\n" +
        "   Y además es lo que garantiza que la masiva nunca toque un gasto ya\n" +
        "   asentado en el libro contable.\n"
    );
    assert.equal(f?.valor, null, "el filtro tiene que ser contra NULL");
  }
);

test(
  "🔑 NO hay un guard aparte de 'gasto posteado': el `IS NULL` ya lo garantiza",
  { skip: skipNoMocks },
  async () => {
    reset();
    await POST(req({ line_ids: ["l1"], chart_account_code: "130003" }));

    // Una línea en NULL pertenece por definición a un gasto NO posteado, así que
    // consultar `journal_entries` acá sería un segundo chequeo que siempre da lo
    // mismo que el primero. Si alguien lo agrega "por las dudas", este test lo
    // marca — no porque consultar esté mal, sino porque después nadie sabe cuál
    // de los dos es la garantía y el día que se simplifique se saca el
    // equivocado.
    assert.ok(
      !state.capturado.tablas.includes("journal_entries"),
      "la masiva no debe consultar `journal_entries`: el filtro IS NULL ya lo cubre. " +
        "Ver el encabezado de la ruta antes de agregarlo."
    );
  }
);

// ===========================================================================
// SOP-014 — el tenant sale del perfil, NUNCA del body
// ===========================================================================

test(
  "el UPDATE se acota al tenant del PERFIL, no al del body",
  { skip: skipNoMocks },
  async () => {
    reset();
    await POST(
      req({
        line_ids: ["l1"],
        chart_account_code: "130003",
        // Un tenant en el cuerpo es un intento de escribir en otro bufete.
        tenant_id: "t-de-otro-bufete",
      })
    );

    const f = filtro("eq", "tenant_id");
    assert.ok(f, "el UPDATE tiene que acotarse por tenant_id");
    assert.equal(f?.valor, "t-real", "tiene que ser el del perfil");
    assert.notEqual(
      f?.valor,
      "t-de-otro-bufete",
      "🔴 el tenant_id se leyó del BODY. SOP-014: sale del perfil del usuario autenticado."
    );
  }
);

test(
  "el UPDATE se acota a las líneas seleccionadas",
  { skip: skipNoMocks },
  async () => {
    reset();
    await POST(req({ line_ids: ["l1", "l2"], chart_account_code: "130003" }));
    const f = filtro("in", "id");
    assert.ok(f, "tiene que filtrar por los ids recibidos");
    assert.deepEqual(f?.valor, ["l1", "l2"]);
  }
);

// ===========================================================================
// La cuenta destino
// ===========================================================================

test("una cuenta inexistente → 400 y NO escribe", { skip: skipNoMocks }, async () => {
  reset({ cuenta: null });
  const res = await POST(req({ line_ids: ["l1"], chart_account_code: "999999" }));
  assert.equal(res.status, 400);
  assert.equal(state.capturado.huboUpdate, false, "no debe tocar una sola fila");
});

test("una cuenta INACTIVA → 400 y NO escribe", { skip: skipNoMocks }, async () => {
  // Los reportes filtran por `active`: clasificar contra una inactiva es dejar
  // el gasto fuera de todos los estados financieros.
  reset({ cuenta: { code: "4101", name: "Vieja de QuickBooks", active: false } });
  const res = await POST(req({ line_ids: ["l1"], chart_account_code: "4101" }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /inactiva/i);
  assert.equal(state.capturado.huboUpdate, false);
});

// ===========================================================================
// Permisos
// ===========================================================================

test("el asistente no puede clasificar → 403", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "asistente", tenant_id: "t-real" } });
  const res = await POST(req({ line_ids: ["l1"], chart_account_code: "130003" }));
  assert.equal(res.status, 403);
  assert.equal(state.capturado.huboUpdate, false);
});

test("el contador no puede clasificar → 403", { skip: skipNoMocks }, async () => {
  // Gastos de trámite es del módulo Legal; el contador no entra.
  reset({ profile: { role: "contador", tenant_id: "t-real" } });
  const res = await POST(req({ line_ids: ["l1"], chart_account_code: "130003" }));
  assert.equal(res.status, 403);
  assert.equal(state.capturado.huboUpdate, false);
});

test("sin sesión → 401", { skip: skipNoMocks }, async () => {
  reset({ user: null });
  const res = await POST(req({ line_ids: ["l1"], chart_account_code: "130003" }));
  assert.equal(res.status, 401);
});

// ===========================================================================
// Entrada y respuesta
// ===========================================================================

test("sin líneas seleccionadas → 400", { skip: skipNoMocks }, async () => {
  reset();
  assert.equal((await POST(req({ line_ids: [], chart_account_code: "130003" }))).status, 400);
  assert.equal((await POST(req({ chart_account_code: "130003" }))).status, 400);
});

test("sin cuenta → 400", { skip: skipNoMocks }, async () => {
  reset();
  assert.equal((await POST(req({ line_ids: ["l1"], chart_account_code: "" }))).status, 400);
  assert.equal((await POST(req({ line_ids: ["l1"] }))).status, 400);
});

test(
  "informa las omitidas cuando alguien clasificó entre medio, y NO falla",
  { skip: skipNoMocks },
  async () => {
    // Se seleccionaron 5 y el UPDATE tocó 2: las otras 3 dejaron de estar en NULL
    // entre que se cargó la pantalla y se apretó el botón. No es un error — es
    // exactamente lo que el filtro IS NULL tiene que hacer.
    reset({ filasActualizadas: 2 });
    const res = await POST(
      req({ line_ids: ["a", "b", "c", "d", "e"], chart_account_code: "130003" })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clasificadas, 2);
    assert.equal(body.omitidas, 3);
  }
);

test(
  "la respuesta devuelve el NOMBRE de la cuenta, para poder confirmarlo en pantalla",
  { skip: skipNoMocks },
  async () => {
    reset();
    const res = await POST(req({ line_ids: ["l1"], chart_account_code: "130003" }));
    const body = await res.json();
    assert.equal(body.chart_account_code, "130003");
    assert.equal(body.chart_account_name, "Fondo Legales de Clientes");
  }
);

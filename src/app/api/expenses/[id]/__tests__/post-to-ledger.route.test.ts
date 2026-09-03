/**
 * LA PRIMERA RUTA DE `/api` QUE ESCRIBE EN EL LEDGER.
 *
 * Un asiento en este sistema NO SE BORRA: los triggers de la `023` rechazan
 * UPDATE y DELETE. Cada uno de estos tests protege algo que, si falla, deja una
 * marca permanente en los libros que el contador certifica ante la DGI.
 *
 * En orden de gravedad:
 *
 *   1. 🔴 **Un gasto con líneas sin clasificar NO llega al RPC.** Es la razón de
 *      ser del NULL: sin este rechazo, un gasto que nadie clasificó entra al
 *      libro contra una cuenta inventada, y el libro no se corrige después.
 *   2. **Idempotencia en tres capas.** Un asiento duplicado solo se arregla con
 *      una reversión que un contador tiene que justificar.
 *   3. **SOP-014**: el `tenant_id` sale del perfil. El RPC es `SECURITY DEFINER`
 *      y **dejó de correr bajo RLS**, así que esta ruta es la única que lo valida.
 *   4. **Ante la duda no se postea.** Si no se puede verificar si ya hay asiento,
 *      se aborta: postear de más es lo único que no se puede deshacer.
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

interface LineaFake {
  id: string;
  line_order: number;
  description: string;
  chart_account_code: string | null;
  amount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

function linea(over: Partial<LineaFake> = {}): LineaFake {
  const amount = over.amount ?? 100;
  const tax = over.tax_amount ?? 0;
  return {
    id: "l1",
    line_order: 1,
    description: "Timbres fiscales",
    chart_account_code: "130003",
    amount,
    tax_rate: 0,
    tax_amount: tax,
    line_total: amount + tax,
    ...over,
  };
}

const state: {
  user: { id: string } | null;
  profile: { role: string; tenant_id: string } | null;
  gasto: Record<string, unknown> | null;
  /** Asiento ya existente para este gasto (capa 2). */
  asientoPrevio: { entry_number: number } | null;
  /** Simula que el SELECT de la capa 2 falla. */
  fallaLookupAsiento: boolean;
  lineas: LineaFake[];
  /** Error que lanza el RPC, si hay. */
  rpcError: { code?: string; message?: string } | null;
  fallaCache: boolean;
  capturado: {
    rpcLlamado: boolean;
    rpcArgs: Record<string, unknown> | null;
    cacheEscrito: Record<string, unknown> | null;
  };
} = {
  user: null,
  profile: null,
  gasto: null,
  asientoPrevio: null,
  fallaLookupAsiento: false,
  lineas: [],
  rpcError: null,
  fallaCache: false,
  capturado: { rpcLlamado: false, rpcArgs: null, cacheEscrito: null },
};

function reset(over: Partial<typeof state> = {}) {
  state.user = { id: "u1" };
  state.profile = { role: "abogada", tenant_id: "t-real" };
  state.gasto = {
    id: "e1",
    date: "2026-03-15",
    concept: "Trámites Registro Público",
    posted_entry_id: null,
    cases: { case_code: "CIV-014" },
    suppliers: { legal_name: "MICROSISTEMAS S.A." },
  };
  state.asientoPrevio = null;
  state.fallaLookupAsiento = false;
  state.lineas = [linea()];
  state.rpcError = null;
  state.fallaCache = false;
  state.capturado = { rpcLlamado: false, rpcArgs: null, cacheEscrito: null };
  Object.assign(state, over);
}

function makeAdmin() {
  function builder(table: string) {
    const s: { op: "update" | null; payload: Record<string, unknown> | null } = {
      op: null,
      payload: null,
    };

    const resolve = () => {
      if (table === "users") return { data: state.profile, error: null };

      if (table === "expenses") {
        if (s.op === "update") {
          state.capturado.cacheEscrito = s.payload;
          return state.fallaCache
            ? { data: null, error: { message: "cache falló" } }
            : { data: null, error: null };
        }
        return { data: state.gasto, error: null };
      }

      if (table === "journal_entries") {
        if (state.fallaLookupAsiento) {
          return { data: null, error: { message: "no se pudo leer el ledger" } };
        }
        return { data: state.asientoPrevio, error: null };
      }

      if (table === "expense_lines") return { data: state.lineas, error: null };

      if (table === "chart_of_accounts") {
        return {
          data: [{ code: "130003", name: "Fondo Legales de Clientes" }],
          error: null,
        };
      }

      return { data: null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      is: () => b,
      not: () => b,
      order: () => b,
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

  return {
    from: (t: string) => builder(t),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      state.capturado.rpcLlamado = true;
      state.capturado.rpcArgs = args;
      if (state.rpcError) return { data: null, error: state.rpcError };
      return { data: "entry-uuid-1", error: null };
    },
  };
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

let POST: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import(
    "@/app/api/expenses/[id]/post-to-ledger/route"
  )) as unknown as { POST: typeof POST });
});

const req = {} as NextRequest;
const ctx = { params: { id: "e1" } };

// ===========================================================================
// 1. 🔴 EL RECHAZO QUE JUSTIFICA EL NULL
// ===========================================================================

test(
  "🔴 un gasto con una línea SIN cuenta NO llega al RPC",
  { skip: skipNoMocks },
  async () => {
    reset({ lineas: [linea({ line_order: 1, chart_account_code: null })] });

    const res = await POST(req, ctx);

    assert.equal(res.status, 422);
    assert.equal(
      state.capturado.rpcLlamado,
      false,
      "\n🔴 Se llamó a post_journal_entry con una línea sin clasificar.\n" +
        "   Los asientos son INMUTABLES: esto deja un movimiento contra una\n" +
        "   cuenta inventada, para siempre, en los libros que el contador\n" +
        "   certifica ante la DGI.\n"
    );
  }
);

test(
  "el mensaje del rechazo dice cuántas líneas y cuáles",
  { skip: skipNoMocks },
  async () => {
    reset({
      lineas: [
        linea({ id: "l1", line_order: 1 }),
        linea({ id: "l2", line_order: 2, chart_account_code: null }),
        linea({ id: "l3", line_order: 3, chart_account_code: null }),
      ],
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    assert.equal(res.status, 422);
    assert.match(body.error, /2 líneas sin cuenta contable/);
    assert.match(body.error, /Clasifíquelas antes de registrarlo en el libro/);
    assert.equal(body.motivo, "sin_clasificar");
    assert.deepEqual(body.lineas, [2, 3], "el número de línea, para poder ir a ella");
  }
);

test("un gasto sin líneas no se postea", { skip: skipNoMocks }, async () => {
  reset({ lineas: [] });
  const res = await POST(req, ctx);
  assert.equal(res.status, 422);
  assert.equal(state.capturado.rpcLlamado, false);
});

// ===========================================================================
// 2. EL POSTEO FELIZ
// ===========================================================================

test("un gasto clasificado se postea y devuelve 201", { skip: skipNoMocks }, async () => {
  reset({
    lineas: [
      linea({ id: "l1", line_order: 1, description: "Timbres", amount: 412.35 }),
      linea({ id: "l2", line_order: 2, description: "Mensajería", amount: 185.5 }),
    ],
  });

  const res = await POST(req, ctx);
  assert.equal(res.status, 201);
  assert.equal(state.capturado.rpcLlamado, true);

  const args = state.capturado.rpcArgs!;
  assert.equal(args.p_source_type, "gasto_tramite");
  assert.equal(args.p_source_id, "e1");
  assert.equal(args.p_transaction_date, "2026-03-15", "la fecha del GASTO, no la de hoy");

  const lineas = args.p_lines as { account_code: string; debit: number; credit: number }[];
  assert.equal(lineas.length, 3, "2 débitos + 1 crédito");
  assert.equal(lineas.filter((l) => l.credit > 0).length, 1);
  assert.equal(lineas.find((l) => l.credit > 0)?.account_code, "200001");
  assert.equal(lineas.find((l) => l.credit > 0)?.credit, 597.85);
});

// ===========================================================================
// 3. SOP-014 — el tenant sale del PERFIL
// ===========================================================================

test(
  "el RPC recibe el tenant del PERFIL del usuario autenticado",
  { skip: skipNoMocks },
  async () => {
    reset({ profile: { role: "admin", tenant_id: "t-real" } });
    await POST(req, ctx);
    assert.equal(
      state.capturado.rpcArgs?.p_tenant_id,
      "t-real",
      "🔴 SOP-014: el RPC es SECURITY DEFINER y dejó de correr bajo RLS. " +
        "Esta ruta es la ÚNICA que valida contra qué bufete se escribe."
    );
  }
);

test("el usuario queda registrado como autor del asiento", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req, ctx);
  assert.equal(state.capturado.rpcArgs?.p_created_by, "u1");
});

// ===========================================================================
// 4. IDEMPOTENCIA EN TRES CAPAS
// ===========================================================================

test(
  "CAPA 1 — `posted_entry_id` corta temprano, sin llamar al RPC",
  { skip: skipNoMocks },
  async () => {
    reset({
      gasto: {
        id: "e1",
        date: "2026-03-15",
        concept: "X",
        posted_entry_id: "entry-viejo",
        cases: { case_code: "CIV-014" },
        suppliers: null,
      },
      asientoPrevio: { entry_number: 77 },
    });

    const res = await POST(req, ctx);
    assert.equal(res.status, 409);
    assert.equal(state.capturado.rpcLlamado, false);
    assert.match((await res.json()).error, /asiento 77/);
  }
);

test(
  "CAPA 2 — el SELECT sobre journal_entries frena aunque el cache esté vacío",
  { skip: skipNoMocks },
  async () => {
    // El cache puede estar desactualizado; la verdad está en el libro.
    reset({ asientoPrevio: { entry_number: 88 } });
    const res = await POST(req, ctx);
    assert.equal(res.status, 409);
    assert.equal(state.capturado.rpcLlamado, false);
    assert.match((await res.json()).error, /asiento 88/);
  }
);

test(
  "CAPA 3 — el 23505 del UNIQUE se traduce al MISMO mensaje, no a un error de constraint",
  { skip: skipNoMocks },
  async () => {
    // El doble clic: dos requests pasaron la capa 2 a la vez y el índice de la
    // `034` frenó al segundo. Para quien aprieta, las dos rutas cuentan lo mismo.
    reset({ rpcError: { code: "23505", message: 'duplicate key value violates ...' } });
    // El SELECT posterior encuentra al ganador.
    const res = await POST(req, ctx);

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /ya está registrado en el libro contable/);
    assert.ok(
      !/duplicate key|23505|constraint/i.test(body.error),
      "no debe filtrarse el error de Postgres"
    );
  }
);

// ===========================================================================
// 5. ANTE LA DUDA, NO SE POSTEA
// ===========================================================================

test(
  "si no se puede verificar si ya hay asiento → 500 y NO postea",
  { skip: skipNoMocks },
  async () => {
    reset({ fallaLookupAsiento: true });
    const res = await POST(req, ctx);
    assert.equal(res.status, 500);
    assert.equal(
      state.capturado.rpcLlamado,
      false,
      "postear de más es lo único que no se puede deshacer: ante la duda, no se postea"
    );
    assert.match((await res.json()).error, /No se registró nada/);
  }
);

test(
  "un error del RPC (período cerrado) vuelve con su mensaje en español",
  { skip: skipNoMocks },
  async () => {
    reset({
      rpcError: { message: "El período contable 2026-03 está cerrado." },
    });
    const res = await POST(req, ctx);
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /período contable 2026-03 está cerrado/);
  }
);

// ===========================================================================
// 6. EL CACHE NO PUEDE VOLTEAR UN POSTEO YA HECHO
// ===========================================================================

test(
  "si el cache falla, el request sigue siendo 201",
  { skip: skipNoMocks },
  async () => {
    // El asiento ya está en el libro y eso es lo irreversible. Devolver un error
    // acá haría que alguien reintente un posteo que YA se hizo.
    reset({ fallaCache: true });
    const res = await POST(req, ctx);
    assert.equal(res.status, 201);
    assert.equal(state.capturado.rpcLlamado, true);
  }
);

test("el cache se escribe con el id del asiento creado", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req, ctx);
  assert.deepEqual(state.capturado.cacheEscrito, { posted_entry_id: "entry-uuid-1" });
});

// ===========================================================================
// 7. PERMISOS
// ===========================================================================

test("el asistente no postea → 403", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "asistente", tenant_id: "t-real" } });
  const res = await POST(req, ctx);
  assert.equal(res.status, 403);
  assert.equal(state.capturado.rpcLlamado, false);
});

test("el contador no postea → 403", { skip: skipNoMocks }, async () => {
  // Gastos de trámite es del módulo Legal; el contador lo LEE desde
  // /finanzas/gastos-tramite/{id} pero no lo registra.
  reset({ profile: { role: "contador", tenant_id: "t-real" } });
  const res = await POST(req, ctx);
  assert.equal(res.status, 403);
  assert.equal(state.capturado.rpcLlamado, false);
});

test("sin sesión → 401", { skip: skipNoMocks }, async () => {
  reset({ user: null });
  const res = await POST(req, ctx);
  assert.equal(res.status, 401);
  assert.equal(state.capturado.rpcLlamado, false);
});

test("un gasto de otro bufete o inexistente → 404", { skip: skipNoMocks }, async () => {
  reset({ gasto: null });
  const res = await POST(req, ctx);
  assert.equal(res.status, 404);
  assert.equal(state.capturado.rpcLlamado, false);
});

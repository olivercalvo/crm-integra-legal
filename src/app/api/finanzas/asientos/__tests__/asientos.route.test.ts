/**
 * `POST /api/finanzas/asientos` — el asiento manual.
 *
 * Un asiento NO SE BORRA. Cada test de acá protege algo que, si falla, deja una
 * marca permanente en los libros que el contador certifica ante la DGI.
 *
 *   1. 🔴 **La idempotencia**, que acá es la única defensa: sin `source_id`, el
 *      UNIQUE de la `034` no cubre nada y un doble clic postea dos veces.
 *   2. **El rol**: admin y contador. La abogada NO — es el primer caso de una
 *      ruta de `/finanzas` cerrada para ella.
 *   3. **SOP-014**: el `tenant_id` sale del perfil, nunca del body.
 *   4. **Que el cuadre NO se duplique**: la ruta no lo valida, lo hace el RPC. Se
 *      verifica que el asiento descuadrado LLEGUE al RPC y que su mensaje vuelva
 *      tal cual.
 *   5. **La traducción** del mensaje que nombra `ensure_accounting_periods()`.
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
  /** Asiento ya posteado con el mismo token (capa 1). */
  previo: { entry_number: number } | null;
  fallaLookup: boolean;
  rpcError: { code?: string; message?: string } | null;
  capturado: { rpcLlamado: boolean; rpcArgs: Record<string, unknown> | null };
} = {
  user: null,
  profile: null,
  previo: null,
  fallaLookup: false,
  rpcError: null,
  capturado: { rpcLlamado: false, rpcArgs: null },
};

function reset(over: Partial<typeof state> = {}) {
  state.user = { id: "u1" };
  state.profile = { role: "contador", tenant_id: "t-real" };
  state.previo = null;
  state.fallaLookup = false;
  state.rpcError = null;
  state.capturado = { rpcLlamado: false, rpcArgs: null };
  Object.assign(state, over);
}

function makeAdmin() {
  function builder(table: string) {
    // ⚠️ La ruta consulta `journal_entries` DOS veces con intenciones opuestas:
    // por `idempotency_key` para la capa 1 (donde "hay fila" significa RECHAZAR)
    // y por `id` para leer el asiento recién creado (donde "hay fila" es el
    // camino feliz). El fake distingue por el filtro, igual que el código real.
    const filtros: Record<string, unknown> = {};

    const resolve = () => {
      if (table === "users") return { data: state.profile, error: null };
      if (table === "journal_entries") {
        if (state.fallaLookup) return { data: null, error: { message: "boom" } };
        if ("idempotency_key" in filtros) {
          // Capa 1 y el ganador del 23505.
          return { data: state.previo, error: null };
        }
        // El SELECT final por id.
        return {
          data: {
            entry_number: 42,
            record_date: "2026-09-03",
            transaction_date: "2026-03-15",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (campo: string, valor: unknown) => {
        filtros[campo] = valor;
        return b;
      },
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(ok, err),
    };
    return b;
  }
  return {
    from: (t: string) => builder(t),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      state.capturado.rpcLlamado = true;
      state.capturado.rpcArgs = args;
      if (state.rpcError) return { data: null, error: state.rpcError };
      return { data: "entry-uuid", error: null };
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

let POST: (req: NextRequest) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import("@/app/api/finanzas/asientos/route")) as unknown as {
    POST: typeof POST;
  });
});

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const LINEAS = [
  { key: "a", account_code: "610001", debit: "100", credit: "", description: "Alquiler" },
  { key: "b", account_code: "200001", debit: "", credit: "100", description: "" },
];
const BASE = {
  transaction_date: "2026-03-15",
  description: "Ajuste de alquiler",
  reference: "MEMO-2026-014",
  idempotency_key: "tok-1",
  lines: LINEAS,
};

// ===========================================================================
// 1. IDEMPOTENCIA — la única defensa acá
// ===========================================================================

test(
  "🔴 CAPA 1 — con el token ya usado corta antes de llamar al RPC",
  { skip: skipNoMocks },
  async () => {
    reset({ previo: { entry_number: 42 } });
    const res = await POST(req(BASE));
    assert.equal(res.status, 409);
    assert.equal(
      state.capturado.rpcLlamado,
      false,
      "\n🔴 Un asiento manual no tiene `source_id`, así que el UNIQUE de la 034\n" +
        "   no lo cubre. Sin esta capa, un doble clic postea DOS asientos\n" +
        "   idénticos — y un asiento no se borra.\n"
    );
    assert.match((await res.json()).error, /ya se registró.*42/);
  }
);

test(
  "CAPA 2 — el 23505 se traduce al MISMO mensaje, no a un error de constraint",
  { skip: skipNoMocks },
  async () => {
    reset({ rpcError: { code: "23505", message: "duplicate key value violates ..." } });
    const res = await POST(req(BASE));
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /ya se registró/);
    assert.ok(!/duplicate key|23505/i.test(body.error), "no filtrar el error de Postgres");
  }
);

test("el token viaja al RPC", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req(BASE));
  assert.equal(state.capturado.rpcArgs?.p_idempotency_key, "tok-1");
});

test("sin token → 400 y no postea", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req({ ...BASE, idempotency_key: "" }));
  assert.equal(res.status, 400);
  assert.equal(state.capturado.rpcLlamado, false);
});

test(
  "si no se puede verificar el token → 500 y NO postea",
  { skip: skipNoMocks },
  async () => {
    reset({ fallaLookup: true });
    const res = await POST(req(BASE));
    assert.equal(res.status, 500);
    assert.equal(state.capturado.rpcLlamado, false, "ante la duda no se postea");
  }
);

// ===========================================================================
// 2. EL ROL — la abogada NO
// ===========================================================================

test("el contador postea", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "contador", tenant_id: "t-real" } });
  assert.equal((await POST(req(BASE))).status, 201);
});

test("el admin postea", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "admin", tenant_id: "t-real" } });
  assert.equal((await POST(req(BASE))).status, 201);
});

test(
  "🔴 la ABOGADA no postea → 403",
  { skip: skipNoMocks },
  async () => {
    // Es el primer caso de una ruta de /finanzas cerrada a la abogada. Si la
    // abogada no puede reclasificar una cuenta (ROLES_CLASIFICACION), menos puede
    // escribir directo en el libro sin documento que lo respalde.
    reset({ profile: { role: "abogada", tenant_id: "t-real" } });
    const res = await POST(req(BASE));
    assert.equal(res.status, 403);
    assert.equal(state.capturado.rpcLlamado, false);
  }
);

test("el asistente tampoco → 403", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "asistente", tenant_id: "t-real" } });
  assert.equal((await POST(req(BASE))).status, 403);
});

test("sin sesión → 401", { skip: skipNoMocks }, async () => {
  reset({ user: null });
  assert.equal((await POST(req(BASE))).status, 401);
});

// ===========================================================================
// 3. SOP-014
// ===========================================================================

test(
  "el RPC recibe el tenant del PERFIL aunque el body mande otro",
  { skip: skipNoMocks },
  async () => {
    reset();
    await POST(req({ ...BASE, tenant_id: "t-de-otro-bufete" }));
    assert.equal(state.capturado.rpcArgs?.p_tenant_id, "t-real");
  }
);

test("el asiento va como `manual` y SIN source_id", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req(BASE));
  assert.equal(state.capturado.rpcArgs?.p_source_type, "manual");
  assert.equal(state.capturado.rpcArgs?.p_source_id, null);
});

test("la referencia llega al RPC", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req(BASE));
  assert.equal(state.capturado.rpcArgs?.p_reference, "MEMO-2026-014");
});

test("sin referencia va NULL, no cadena vacía", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req({ ...BASE, reference: "   " }));
  assert.equal(state.capturado.rpcArgs?.p_reference, null);
});

// ===========================================================================
// 4. EL CUADRE NO SE DUPLICA — lo hace el RPC
// ===========================================================================

test(
  "🔑 un asiento DESCUADRADO llega al RPC: la ruta no lo valida",
  { skip: skipNoMocks },
  async () => {
    // Duplicar el cuadre acá crearía dos verdades que se desincronizan. La regla
    // vive en un solo lugar.
    reset({
      rpcError: {
        message: "El asiento no cuadra: débitos 100.00 vs créditos 90.00 (diferencia 10.00)",
      },
    });
    const res = await POST(
      req({
        ...BASE,
        lines: [
          { key: "a", account_code: "610001", debit: "100", credit: "", description: "" },
          { key: "b", account_code: "200001", debit: "", credit: "90", description: "" },
        ],
      })
    );
    assert.equal(state.capturado.rpcLlamado, true, "el cuadre lo decide el RPC");
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /diferencia 10\.00/);
  }
);

test(
  "el mensaje de período cerrado pasa TAL CUAL: ya es entendible",
  { skip: skipNoMocks },
  async () => {
    reset({ rpcError: { message: "El período 2026-03 está CERRADO: no admite asientos nuevos." } });
    const res = await POST(req(BASE));
    assert.match((await res.json()).error, /El período 2026-03 está CERRADO/);
  }
);

test(
  "🔑 el mensaje del período INEXISTENTE se traduce: no nombra una función de Postgres",
  { skip: skipNoMocks },
  async () => {
    reset({
      rpcError: {
        message:
          "No existe el período contable 2025-11 para este tenant y está fuera del rango que se crea solo (2026 y 2027). Provisionalo con ensure_accounting_periods().",
      },
    });
    const res = await POST(req({ ...BASE, transaction_date: "2025-11-10" }));
    const body = await res.json();
    assert.ok(
      !body.error.includes("ensure_accounting_periods"),
      "a un contador el nombre de una función de Postgres no le dice nada"
    );
    assert.match(body.error, /ejercicio 2025 no está abierto/);
    assert.match(body.error, /administrador/);
  }
);

// ===========================================================================
// 5. ENTRADA Y RESPUESTA
// ===========================================================================

test("sin descripción → 400 y no postea", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req({ ...BASE, description: "ab" }));
  assert.equal(res.status, 400);
  assert.equal(state.capturado.rpcLlamado, false);
});

test("con fecha mal formada → 400", { skip: skipNoMocks }, async () => {
  reset();
  assert.equal((await POST(req({ ...BASE, transaction_date: "15/03/2026" }))).status, 400);
});

test("una línea sin cuenta → 400 antes del RPC", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(
    req({
      ...BASE,
      lines: [
        { key: "a", account_code: "", debit: "100", credit: "", description: "" },
        { key: "b", account_code: "200001", debit: "", credit: "100", description: "" },
      ],
    })
  );
  assert.equal(res.status, 400);
  assert.equal(state.capturado.rpcLlamado, false);
});

test(
  "la respuesta trae las DOS fechas del Art. 13a",
  { skip: skipNoMocks },
  async () => {
    // Mostrarlas juntas es lo que le demuestra al contador que el sistema las
    // guarda separadas y que la de registro no se puede retocar.
    reset();
    const body = await (await POST(req(BASE))).json();
    assert.equal(body.transaction_date, "2026-03-15");
    assert.equal(body.record_date, "2026-09-03");
    assert.equal(body.entry_number, 42);
  }
);

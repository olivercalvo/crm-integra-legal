/**
 * `POST /api/expenses` — un gasto de trámite nace con líneas o no nace.
 *
 * Lo que protege:
 *
 *   1. 🔴 **Las líneas son obligatorias.** Un gasto sin líneas NO SE PUEDE
 *      POSTEAR al libro —el builder no tiene contra qué cuenta armar el asiento—
 *      así que aceptarlo sería crear en silencio documentos que nunca van a
 *      llegar a la contabilidad.
 *   2. 🔴 **El monto lo calcula el SERVIDOR sumando las líneas.** Si viniera del
 *      request, el encabezado y el detalle podrían decir cosas distintas y el
 *      asiento se arma con una sola de las dos.
 *   3. **La cuenta de cada línea es obligatoria al crear**, aunque la columna sea
 *      NULLABLE. El NULL existe solo para los 128 gastos históricos que nadie
 *      clasificó nunca.
 *   4. Si las líneas fallan, el gasto se borra: un encabezado huérfano es basura
 *      invisible que después nadie sabe de dónde salió.
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
  fallanLineas: boolean;
  /** El plan de cuentas que "ve" la ruta al validar las líneas. */
  plan: { code: string; name: string; active: boolean; account_type: string }[];
  capturado: {
    expenseInsert: Record<string, unknown> | null;
    lineasInsert: Record<string, unknown>[] | null;
    borroElGasto: boolean;
  };
} = {
  user: null,
  profile: null,
  fallanLineas: false,
  plan: [],
  capturado: { expenseInsert: null, lineasInsert: null, borroElGasto: false },
};

/** El recorte del plan real que usan estos tests. */
const PLAN_POR_DEFECTO = [
  { code: "130003", name: "Fondo Legales de Clientes", active: true, account_type: "asset" },
  { code: "500004", name: "Honorarios Profesionales Externos", active: true, account_type: "cost" },
  { code: "500005", name: "Costos tramites legales", active: true, account_type: "cost" },
  { code: "610002", name: "Honorarios Profesionales", active: true, account_type: "expense" },
  { code: "300001", name: "Capital Social", active: true, account_type: "equity" },
  { code: "400001", name: "Derecho Corporativo", active: true, account_type: "income" },
  { code: "200001", name: "Cuentas por pagar", active: true, account_type: "liability" },
  { code: "4101", name: "Vieja de QuickBooks", active: false, account_type: "income" },
];

function reset(over: Partial<typeof state> = {}) {
  state.user = { id: "u1" };
  state.profile = { role: "abogada", tenant_id: "t-real" };
  state.fallanLineas = false;
  state.plan = PLAN_POR_DEFECTO;
  state.capturado = { expenseInsert: null, lineasInsert: null, borroElGasto: false };
  Object.assign(state, over);
}

function makeAdmin() {
  function builder(table: string) {
    const s: { op: string | null; payload: unknown } = { op: null, payload: null };

    const resolve = () => {
      if (table === "users") return { data: state.profile, error: null };

      if (table === "expenses") {
        if (s.op === "insert") {
          state.capturado.expenseInsert = s.payload as Record<string, unknown>;
          return { data: { id: "nuevo-gasto", ...(s.payload as object) }, error: null };
        }
        if (s.op === "delete") {
          state.capturado.borroElGasto = true;
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }

      if (table === "chart_of_accounts") {
        // La ruta pide `.in("code", codigos)`. El fake no filtra: devuelve el
        // plan entero y la ruta busca en él, que es lo que hace de verdad.
        return { data: state.plan, error: null };
      }

      if (table === "expense_lines" && s.op === "insert") {
        state.capturado.lineasInsert = s.payload as Record<string, unknown>[];
        return state.fallanLineas
          ? { data: null, error: { message: "boom" } }
          : { data: null, error: null };
      }

      return { data: null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      // La ruta filtra el plan con `.in("code", codigos)`.
      in: () => b,
      insert: (payload: unknown) => {
        s.op = "insert";
        s.payload = payload;
        return b;
      },
      delete: () => {
        s.op = "delete";
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
  ({ POST } = (await import("@/app/api/expenses/route")) as unknown as { POST: typeof POST });
});

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function linea(over: Record<string, string> = {}) {
  return {
    key: "k1",
    description: "Timbres fiscales",
    chart_account_code: "130003",
    amount: "100.00",
    tax_rate: "0",
    tax_amount: "0",
    ...over,
  };
}

const BASE = { case_id: "c1", concept: "Trámite Registro Público", date: "2026-03-15" };

// ===========================================================================
// 1. LAS LÍNEAS SON OBLIGATORIAS
// ===========================================================================

test("sin `lines` → 400 y no crea nada", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req(BASE));
  assert.equal(res.status, 400);
  assert.equal(state.capturado.expenseInsert, null, "no debe crear el encabezado");
  assert.match((await res.json()).error, /al menos una línea/i);
});

test("con `lines` vacío → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req({ ...BASE, lines: [] }));
  assert.equal(res.status, 400);
  assert.equal(state.capturado.expenseInsert, null);
});

test(
  "🔴 una línea SIN cuenta contable → 400, con el error del campo",
  { skip: skipNoMocks },
  async () => {
    reset();
    const res = await POST(req({ ...BASE, lines: [linea({ chart_account_code: "" })] }));
    assert.equal(res.status, 400);
    assert.equal(state.capturado.expenseInsert, null, "no se crea un gasto sin clasificar");
    const body = await res.json();
    assert.ok(
      body.fieldErrors?.["lineas.0.chart_account_code"],
      "el error tiene que llegar al campo, no solo al banner"
    );
  }
);

// ===========================================================================
// 2. 🔴 EL MONTO LO CALCULA EL SERVIDOR
// ===========================================================================

test(
  "🔴 el monto sale de las LÍNEAS, y un `amount` del body se ignora",
  { skip: skipNoMocks },
  async () => {
    reset();
    await POST(
      req({
        ...BASE,
        // Un monto inventado en el request. Si el servidor lo tomara, el
        // encabezado diría 999.999 y el asiento 597,85.
        amount: 999999,
        lines: [
          linea({ description: "Timbres", amount: "412.35" }),
          linea({ description: "Mensajería", amount: "185.50" }),
        ],
      })
    );

    assert.equal(
      state.capturado.expenseInsert?.amount,
      597.85,
      "🔴 el monto del encabezado tiene que ser la SUMA DE LAS LÍNEAS"
    );
    assert.notEqual(state.capturado.expenseInsert?.amount, 999999);
  }
);

test("el ITBMS de la línea entra en el total", { skip: skipNoMocks }, async () => {
  reset();
  await POST(
    req({
      ...BASE,
      lines: [linea({ amount: "100", tax_rate: "0.07", tax_amount: "7.00" })],
    })
  );
  assert.equal(state.capturado.expenseInsert?.amount, 107);
});

// ===========================================================================
// 3. LO QUE SE GUARDA
// ===========================================================================

test("las líneas se guardan con su orden y su cuenta", { skip: skipNoMocks }, async () => {
  reset();
  await POST(
    req({
      ...BASE,
      lines: [
        linea({ description: "Timbres", chart_account_code: "130003", amount: "412.35" }),
        linea({ description: "Honorario", chart_account_code: "500005", amount: "900" }),
      ],
    })
  );

  const l = state.capturado.lineasInsert!;
  assert.equal(l.length, 2);
  assert.deepEqual(
    l.map((x) => [x.line_order, x.chart_account_code, x.amount]),
    [
      [1, "130003", 412.35],
      [2, "500005", 900],
    ]
  );
  assert.equal(l[0].tenant_id, "t-real", "el tenant sale del perfil");
});

test("el proveedor y el vencimiento se guardan en el ENCABEZADO", { skip: skipNoMocks }, async () => {
  reset();
  await POST(
    req({ ...BASE, supplier_id: "prov-1", due_date: "2026-04-14", lines: [linea()] })
  );
  assert.equal(state.capturado.expenseInsert?.supplier_id, "prov-1");
  assert.equal(state.capturado.expenseInsert?.due_date, "2026-04-14");
});

test("sin proveedor ni vencimiento se guardan como NULL, no vacíos", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req({ ...BASE, supplier_id: "", due_date: "", lines: [linea()] }));
  assert.equal(state.capturado.expenseInsert?.supplier_id, null);
  assert.equal(state.capturado.expenseInsert?.due_date, null);
});

test("el tenant sale del perfil aunque el body mande otro", { skip: skipNoMocks }, async () => {
  reset();
  await POST(req({ ...BASE, tenant_id: "t-de-otro", lines: [linea()] }));
  assert.equal(state.capturado.expenseInsert?.tenant_id, "t-real");
});

// ===========================================================================
// 4. SI FALLAN LAS LÍNEAS, EL GASTO SE BORRA
// ===========================================================================

test(
  "si el INSERT de líneas falla, el encabezado se borra y no queda basura",
  { skip: skipNoMocks },
  async () => {
    // Un gasto sin líneas no se puede postear y nadie lo vería como un problema:
    // sería basura invisible. Se puede borrar sin riesgo porque todavía no tiene
    // asiento — el trigger de la `038` lo dejaría pasar justamente por eso.
    reset({ fallanLineas: true });
    const res = await POST(req({ ...BASE, lines: [linea()] }));
    assert.equal(res.status, 500);
    assert.equal(state.capturado.borroElGasto, true, "compensating delete");
    assert.match((await res.json()).error, /No se guardó nada/);
  }
);

// ===========================================================================
// 5. PERMISOS
// ===========================================================================

test("el asistente no crea gastos → 403", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "asistente", tenant_id: "t-real" } });
  const res = await POST(req({ ...BASE, lines: [linea()] }));
  assert.equal(res.status, 403);
  assert.equal(state.capturado.expenseInsert, null);
});

test("el contador no crea gastos de trámite → 403", { skip: skipNoMocks }, async () => {
  reset({ profile: { role: "contador", tenant_id: "t-real" } });
  const res = await POST(req({ ...BASE, lines: [linea()] }));
  assert.equal(res.status, 403);
});

test("sin sesión → 401", { skip: skipNoMocks }, async () => {
  reset({ user: null });
  const res = await POST(req({ ...BASE, lines: [linea()] }));
  assert.equal(res.status, 401);
});

// ===========================================================================
// 6. EL GUARD DE CUENTAS
// ===========================================================================

test(
  "🔴 una cuenta de PATRIMONIO en una línea → 400, y no crea nada",
  { skip: skipNoMocks },
  async () => {
    // Es el caso concreto que motivó el guard: en la pantalla de limpieza,
    // `300001 Capital Social` está ACTIVA y a un clic de distancia de una tasa
    // judicial. El chequeo de inactivas no la frena.
    reset();
    const res = await POST(
      req({ ...BASE, lines: [linea({ chart_account_code: "300001" })] })
    );
    assert.equal(res.status, 400);
    assert.equal(state.capturado.expenseInsert, null);
    const body = await res.json();
    assert.match(body.fieldErrors["lineas.0.chart_account_code"], /capital de las socias/);
  }
);

test("una cuenta de INGRESO en una línea → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req({ ...BASE, lines: [linea({ chart_account_code: "400001" })] }));
  assert.equal(res.status, 400);
  assert.equal(state.capturado.expenseInsert, null);
});

test(
  "una cuenta de PASIVO en una línea → 400: dejaría la misma cuenta de los dos lados",
  { skip: skipNoMocks },
  async () => {
    reset();
    const res = await POST(req({ ...BASE, lines: [linea({ chart_account_code: "200001" })] }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.fieldErrors["lineas.0.chart_account_code"], /los dos lados/);
  }
);

test("una cuenta INACTIVA en una línea → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req({ ...BASE, lines: [linea({ chart_account_code: "4101" })] }));
  assert.equal(res.status, 400);
  assert.match(
    (await res.json()).fieldErrors["lineas.0.chart_account_code"],
    /inactiva/
  );
});

test("una cuenta que no existe en el plan → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req({ ...BASE, lines: [linea({ chart_account_code: "999999" })] }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).fieldErrors["lineas.0.chart_account_code"], /no existe/);
});

test(
  "el error apunta a la LÍNEA que falla, no a la primera",
  { skip: skipNoMocks },
  async () => {
    reset();
    const res = await POST(
      req({
        ...BASE,
        lines: [
          linea({ chart_account_code: "130003" }),
          linea({ chart_account_code: "300001" }),
        ],
      })
    );
    const body = await res.json();
    assert.ok(!body.fieldErrors["lineas.0.chart_account_code"], "la 0 está bien");
    assert.ok(body.fieldErrors["lineas.1.chart_account_code"], "la 1 es la mala");
  }
);

test("610002 se ACEPTA: es improbable, no imposible", { skip: skipNoMocks }, async () => {
  // El servidor rechaza lo imposible, no lo improbable. Un viaje a una audiencia
  // va legítimamente a una 610xxx; lo que hace la lista corta es que no sea el
  // default, no que esté prohibida.
  reset();
  const res = await POST(req({ ...BASE, lines: [linea({ chart_account_code: "610002" })] }));
  assert.equal(res.status, 201);
});

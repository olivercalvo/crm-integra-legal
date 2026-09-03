/**
 * 🔴 UNA COMPRA DEL BUFETE SE CLASIFICA CONTRA GASTO, COSTO **O ACTIVO**.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL REQUISITO QUE ESTABA INCUMPLIDO
 * ═════════════════════════════════════════════════════════════════════════════
 * El acta del 25/08/2026 pide para compras *"la cuenta de gasto, **costo o
 * activo** que elija el usuario"*. Hasta el 03/09 tanto el selector como el guard
 * filtraban `account_type = 'expense'`: faltaban dos de los tres.
 *
 * El caso que lo rompe es cotidiano: **comprar una computadora** va a
 * `110001 Mobiliario y equipo`. Con el filtro viejo no se podía elegir, así que o
 * se registraba contra una cuenta de gasto —inflando el resultado del ejercicio
 * con algo que había que capitalizar— o no se registraba.
 *
 * Y el mensaje era peor que el bloqueo: un activo legítimo volvía como
 * `"no-existe"`, o sea que le decía a la persona que la cuenta no estaba en el
 * plan **cuando sí estaba y era la correcta**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS TRES VEREDICTOS SON TRES COSAS DISTINTAS
 * ─────────────────────────────────────────────────────────────────────────────
 * Existir, estar activa y poder clasificar un desembolso son independientes, y
 * cada una manda a un lugar distinto a quien lee el error. El guard viejo las
 * mezclaba en un `.eq()`.
 *
 * Ejecución:  npm test
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

interface Fila {
  code: string;
  name: string;
  active: boolean;
  account_type: string;
}

/** El recorte del plan real de Integra que usan estos tests. */
const PLAN: Fila[] = [
  { code: "110001", name: "Mobiliario y equipo", active: true, account_type: "asset" },
  { code: "130003", name: "Fondo Legales de Clientes", active: true, account_type: "asset" },
  { code: "500004", name: "Honorarios Profesionales Externos", active: true, account_type: "cost" },
  { code: "610001", name: "Alquiler", active: true, account_type: "expense" },
  { code: "610009", name: "Combustible", active: true, account_type: "expense" },
  { code: "200001", name: "Cuentas por pagar", active: true, account_type: "liability" },
  { code: "300001", name: "Capital Social", active: true, account_type: "equity" },
  { code: "400001", name: "Derecho Corporativo", active: true, account_type: "income" },
  { code: "5101", name: "Gasto del plan viejo", active: false, account_type: "expense" },
];

const state: { plan: Fila[]; capturado: { tiposPedidos: unknown } } = {
  plan: PLAN,
  capturado: { tiposPedidos: null },
};

function makeDb() {
  function builder() {
    const filtros: { campo: string; valor: unknown }[] = [];
    let tipos: unknown = null;

    const resolve = () => {
      let filas = state.plan;
      if (tipos && Array.isArray(tipos)) {
        filas = filas.filter((f) => (tipos as string[]).includes(f.account_type));
      }
      for (const f of filtros) {
        if (f.campo === "code") filas = filas.filter((x) => x.code === f.valor);
        if (f.campo === "account_type") {
          filas = filas.filter((x) => x.account_type === f.valor);
        }
      }
      return { data: filas, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (campo: string, valor: unknown) => {
        filtros.push({ campo, valor });
        return b;
      },
      in: (_campo: string, valor: unknown) => {
        tipos = valor;
        state.capturado.tiposPedidos = valor;
        return b;
      },
      order: () => b,
      maybeSingle: async () => {
        const r = resolve();
        return { data: r.data[0] ?? null, error: null };
      },
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onOk, onErr),
    };
    return b;
  }
  return { from: () => builder() };
}

type Validar = (
  db: unknown,
  t: string,
  code: string | null,
  previo?: string | null
) => Promise<{ estado: string; mensaje?: string }>;
type Listar = (
  db: unknown,
  t: string,
  incluir?: string | null
) => Promise<{ code: string; name: string; inactiva?: boolean }[]>;

let validarCuentaDeGasto: Validar;
let listExpenseAccountOptions: Listar;

before(async () => {
  if (!MOCKS_ENABLED) return;
  const m = (await import("@/lib/finanzas/queries/business-expenses")) as unknown as {
    validarCuentaDeGasto: Validar;
    listExpenseAccountOptions: Listar;
  };
  validarCuentaDeGasto = m.validarCuentaDeGasto;
  listExpenseAccountOptions = m.listExpenseAccountOptions;
});

const db = () => makeDb() as unknown;

// ===========================================================================
// EL CASO CONCRETO: COMPRAR UNA COMPUTADORA
// ===========================================================================

test(
  "🔴 comprar una computadora contra `110001 Mobiliario y equipo` PASA",
  { skip: skipNoMocks },
  async () => {
    const v = await validarCuentaDeGasto(db(), "t1", "110001");
    assert.equal(
      v.estado,
      "ok",
      "\n🔴 El acta del 25/08 pide para compras la cuenta de gasto, costo o ACTIVO.\n" +
        "   Sin esto no hay forma de registrar una compra capitalizable: o se\n" +
        "   clasifica contra una cuenta de gasto —inflando el resultado del\n" +
        "   ejercicio con algo que había que capitalizar— o no se registra.\n"
    );
  }
);

test(
  "y el SELECTOR la ofrece — si no, el arreglo del guard no se nota",
  { skip: skipNoMocks },
  async () => {
    const ops = await listExpenseAccountOptions(db(), "t1");
    assert.ok(
      ops.some((o) => o.code === "110001"),
      "aflojar el guard sin tocar el selector deja la cuenta imposible de elegir"
    );
  }
);

// ===========================================================================
// LOS TRES TIPOS DEL ACTA
// ===========================================================================

test("una cuenta de COSTO pasa", { skip: skipNoMocks }, async () => {
  assert.equal((await validarCuentaDeGasto(db(), "t1", "500004")).estado, "ok");
});

test("una cuenta de GASTO pasa, como siempre", { skip: skipNoMocks }, async () => {
  assert.equal((await validarCuentaDeGasto(db(), "t1", "610001")).estado, "ok");
});

test("el selector ofrece los tres tipos y nada más", { skip: skipNoMocks }, async () => {
  await listExpenseAccountOptions(db(), "t1");
  assert.deepEqual(state.capturado.tiposPedidos, ["asset", "cost", "expense"]);
});

// ===========================================================================
// LO QUE SIGUE RECHAZADO
// ===========================================================================

test(
  "PASIVO → `tipo-invalido`, y el mensaje explica el problema del asiento",
  { skip: skipNoMocks },
  async () => {
    const v = await validarCuentaDeGasto(db(), "t1", "200001");
    assert.equal(v.estado, "tipo-invalido");
    assert.match(v.mensaje ?? "", /los dos lados/);
  }
);

test("PATRIMONIO → `tipo-invalido`", { skip: skipNoMocks }, async () => {
  const v = await validarCuentaDeGasto(db(), "t1", "300001");
  assert.equal(v.estado, "tipo-invalido");
  assert.match(v.mensaje ?? "", /capital de las socias/);
});

test("INGRESO → `tipo-invalido`", { skip: skipNoMocks }, async () => {
  const v = await validarCuentaDeGasto(db(), "t1", "400001");
  assert.equal(v.estado, "tipo-invalido");
});

test("el selector NO ofrece pasivo, patrimonio ni ingreso", { skip: skipNoMocks }, async () => {
  const ops = await listExpenseAccountOptions(db(), "t1");
  const codes = ops.map((o) => o.code);
  for (const c of ["200001", "300001", "400001"]) {
    assert.ok(!codes.includes(c), `${c} no debería ofrecerse`);
  }
});

// ===========================================================================
// LOS TRES VEREDICTOS SON DISTINTOS, Y ESO ES EL ARREGLO DE FONDO
// ===========================================================================

test(
  "🔑 una cuenta de tipo inválido NO se reporta como 'no existe'",
  { skip: skipNoMocks },
  async () => {
    // Es el bug de fondo del guard viejo: el `.eq("account_type","expense")`
    // hacía que un activo legítimo volviera como "no-existe", y el mensaje
    // mandaba a buscar la cuenta en el plan cuando la cuenta estaba ahí.
    const v = await validarCuentaDeGasto(db(), "t1", "300001");
    assert.notEqual(
      v.estado,
      "no-existe",
      "existir y poder clasificar un desembolso son dos cosas distintas"
    );
  }
);

test("una cuenta que de verdad no está en el plan → `no-existe`", { skip: skipNoMocks }, async () => {
  assert.equal((await validarCuentaDeGasto(db(), "t1", "999999")).estado, "no-existe");
});

test("una cuenta INACTIVA → `inactiva`, no `no-existe`", { skip: skipNoMocks }, async () => {
  assert.equal((await validarCuentaDeGasto(db(), "t1", "5101")).estado, "inactiva");
});

test(
  "la cuenta inactiva que el gasto YA tenía se respeta",
  { skip: skipNoMocks },
  async () => {
    // Editar la descripción de un gasto viejo no puede fallar porque su cuenta se
    // desactivó después.
    assert.equal((await validarCuentaDeGasto(db(), "t1", "5101", "5101")).estado, "ok");
  }
);

test("sin cuenta (`null`) sigue siendo válido", { skip: skipNoMocks }, async () => {
  // `business_expenses.chart_account_code` es NULLABLE: un gasto puede quedar sin
  // clasificar. No es lo mismo que clasificarlo mal.
  assert.equal((await validarCuentaDeGasto(db(), "t1", null)).estado, "ok");
});

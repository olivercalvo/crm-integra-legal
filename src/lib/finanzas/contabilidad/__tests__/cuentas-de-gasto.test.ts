/**
 * Qué cuenta puede clasificar una línea de gasto.
 *
 * Los dos mecanismos tienen sesgos OPUESTOS y deliberados, y estos tests fijan
 * los dos:
 *
 *   · La LISTA es opinada y corta — y sobre todo **derivada**: se prueba que una
 *     cuenta de costo NUEVA aparezca sola, porque una lista literal de siete
 *     códigos se desactualiza el día que RM toque el plan.
 *   · El GUARD es conservador — se prueba que `100001 Banco General` **pase**,
 *     aunque como clasificación sea un disparate. El servidor rechaza lo
 *     imposible, no lo improbable.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  cuentasClasificables,
  cuentasSugeridasParaTramite,
  esTipoValidoParaGasto,
  motivoDeRechazo,
  TIPOS_IMPOSIBLES_EN_GASTO,
  type CuentaClasificable,
} from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import { ACCOUNT_TYPES } from "@/lib/finanzas/types/chart-of-account";

/** Un recorte del plan real de Integra, con las 6 de costo completas. */
const PLAN: CuentaClasificable[] = [
  { code: "100001", name: "Banco General Operativa", account_type: "asset" },
  { code: "100004", name: "Cuentas por Cobrar Clientes", account_type: "asset" },
  { code: "100005", name: "Gastos Pagados por Anticipado", account_type: "asset" },
  { code: "112001", name: "Depr. de Mobiliario y equipo", account_type: "asset" },
  { code: "130003", name: "Fondo Legales de Clientes", account_type: "asset" },
  { code: "200001", name: "Cuentas por pagar", account_type: "liability" },
  { code: "200003", name: "ITBMS por Pagar", account_type: "liability" },
  { code: "300001", name: "Capital Social", account_type: "equity" },
  { code: "300003", name: "Utilidad del Ejercicio", account_type: "equity" },
  { code: "400001", name: "Derecho Corporativo", account_type: "income" },
  { code: "500001", name: "Traductores Oficiales", account_type: "cost" },
  { code: "500002", name: "Notarios", account_type: "cost" },
  { code: "500003", name: "Mensajeria Especializada", account_type: "cost" },
  { code: "500004", name: "Honorarios Profesionales Externos", account_type: "cost" },
  { code: "500005", name: "Costos tramites legales", account_type: "cost" },
  { code: "500006", name: "Investigadores", account_type: "cost" },
  { code: "610002", name: "Honorarios Profesionales", account_type: "expense" },
  { code: "610018", name: "Gastos de viajes", account_type: "expense" },
];

// ===========================================================================
// LA LISTA SUGERIDA
// ===========================================================================

test("son exactamente siete: 130003 más las seis de costo", () => {
  const s = cuentasSugeridasParaTramite(PLAN);
  assert.deepEqual(
    s.map((c) => c.code),
    ["130003", "500001", "500002", "500003", "500004", "500005", "500006"]
  );
});

test("130003 va PRIMERA: es la respuesta más frecuente y el default del acta", () => {
  assert.equal(cuentasSugeridasParaTramite(PLAN)[0].code, "130003");
});

test("🔑 una cuenta de costo NUEVA aparece sola — la lista es derivada, no literal", () => {
  // Es el punto entero del diseño. Si el contador agrega `500007 Peritos` y la
  // lista fuera de códigos literales, no aparecería NUNCA y nadie se enteraría:
  // la cuenta existe, el selector simplemente no la muestra.
  const conNueva = [
    ...PLAN,
    { code: "500007", name: "Peritos", account_type: "cost" as const },
  ];
  assert.ok(
    cuentasSugeridasParaTramite(conNueva).some((c) => c.code === "500007"),
    "una lista hardcodeada de siete códigos se desactualiza el día que RM toque el plan"
  );
});

test("las 610xxx NO están en la lista corta — van a un clic de distancia", () => {
  const s = cuentasSugeridasParaTramite(PLAN).map((c) => c.code);
  assert.ok(!s.includes("610002"));
  assert.ok(!s.includes("610018"), "un viaje a una audiencia es legítimo, pero es el caso raro");
});

test("ni los bancos ni las cuentas por cobrar entran en la lista corta", () => {
  const s = cuentasSugeridasParaTramite(PLAN).map((c) => c.code);
  assert.ok(!s.includes("100001"));
  assert.ok(!s.includes("100004"));
});

test("una cuenta de costo INACTIVA no se sugiere", () => {
  // Los reportes filtran `active`: sugerirla sería ofrecer una clasificación que
  // después no se ve en ningún estado financiero.
  const conInactiva = PLAN.map((c) =>
    c.code === "500002" ? { ...c, active: false } : { ...c, active: true }
  );
  const s = cuentasSugeridasParaTramite(conInactiva).map((c) => c.code);
  assert.ok(!s.includes("500002"));
  assert.ok(s.includes("500001"), "las demás siguen");
});

// ===========================================================================
// EL GUARD — rechaza lo imposible
// ===========================================================================

test("ingreso, patrimonio y pasivo se rechazan", () => {
  for (const t of TIPOS_IMPOSIBLES_EN_GASTO) {
    assert.equal(esTipoValidoParaGasto(t), false, `${t} debería rechazarse`);
  }
  assert.deepEqual([...TIPOS_IMPOSIBLES_EN_GASTO], ["income", "equity", "liability"]);
});

test("activo, costo y gasto se aceptan", () => {
  for (const t of ["asset", "cost", "expense"] as const) {
    assert.equal(esTipoValidoParaGasto(t), true, `${t} debería aceptarse`);
  }
});

test("el activo NO se puede cerrar: 130003 es un activo y es el caso principal", () => {
  assert.equal(
    esTipoValidoParaGasto("asset"),
    true,
    "cerrar los activos rompería la clasificación por defecto del acta"
  );
});

test("🔑 el motivo del PASIVO nombra el problema real del asiento", () => {
  // Es el más fuerte de los tres: el asiento YA acredita 200001, así que una
  // línea contra un pasivo dejaría la misma cuenta de los dos lados.
  const m = motivoDeRechazo({
    code: "200001",
    name: "Cuentas por pagar",
    account_type: "liability",
  });
  assert.ok(m);
  assert.match(m!, /200001|Cuentas por pagar/);
  assert.match(m!, /los dos lados/);
});

test("el mensaje de rechazo EXPLICA, no solo prohíbe", () => {
  // Quien lo lee está clasificando y necesita saber hacia dónde ir.
  const m = motivoDeRechazo({
    code: "300001",
    name: "Capital Social",
    account_type: "equity",
  })!;
  assert.match(m, /300001 Capital Social/);
  assert.match(m, /capital de las socias/);
  assert.ok(m.length > 60, "un mensaje de una línea no enseña nada");
});

test("una cuenta válida no devuelve motivo", () => {
  assert.equal(
    motivoDeRechazo({ code: "500005", name: "Costos tramites legales", account_type: "cost" }),
    null
  );
});

test("🔑 `100001 Banco General` PASA el guard, aunque sea un disparate clasificarlo así", () => {
  // El sesgo del servidor es deliberado: rechaza lo imposible, no lo improbable.
  // Un guard equivocado bloquea trabajo legítimo y se descubre tarde, con alguien
  // trabado; una sugerencia equivocada cuesta un clic. La lista corta ya lo saca
  // del camino.
  assert.equal(
    motivoDeRechazo({
      code: "100001",
      name: "Banco General Operativa",
      account_type: "asset",
    }),
    null
  );
});

test("`112001 Depr. acumulada` pasa: debitarla es legítimo en una baja de activo", () => {
  assert.equal(
    motivoDeRechazo({
      code: "112001",
      name: "Depr. de Mobiliario y equipo",
      account_type: "asset",
    }),
    null
  );
});

test("todo tipo del vocabulario está decidido: o se acepta o tiene motivo escrito", () => {
  // Si mañana entra un séptimo `account_type`, este test obliga a decidir qué
  // pasa con él en vez de que caiga en el lado permisivo por omisión.
  for (const t of ACCOUNT_TYPES) {
    const m = motivoDeRechazo({ code: "X", name: "Y", account_type: t });
    if (esTipoValidoParaGasto(t)) assert.equal(m, null);
    else assert.ok(m && m.length > 40, `falta el motivo escrito para "${t}"`);
  }
});

// ===========================================================================
// LOS DOS MECANISMOS, JUNTOS
// ===========================================================================

test("todo lo sugerido pasa el guard — la pantalla no ofrece lo que la ruta rechaza", () => {
  for (const c of cuentasSugeridasParaTramite(PLAN)) {
    assert.equal(esTipoValidoParaGasto(c.account_type), true, `${c.code} se ofrece y se rechaza`);
  }
});

test("`cuentasClasificables` es el 'ver todas', y ya saca los tres tipos imposibles", () => {
  const todas = cuentasClasificables(PLAN).map((c) => c.code);
  assert.ok(todas.includes("610018"), "el caso raro tiene que estar");
  assert.ok(todas.includes("100001"), "improbable pero posible: está");
  assert.ok(!todas.includes("300001"), "patrimonio no");
  assert.ok(!todas.includes("400001"), "ingreso no");
  assert.ok(!todas.includes("200001"), "pasivo no");
});

test("la lista corta es un subconjunto del 'ver todas'", () => {
  const todas = new Set(cuentasClasificables(PLAN).map((c) => c.code));
  for (const c of cuentasSugeridasParaTramite(PLAN)) {
    assert.ok(todas.has(c.code), `${c.code} se sugiere pero no está en "ver todas"`);
  }
});

// ===========================================================================
// EL ERROR QUE MOTIVÓ TODO ESTO
// ===========================================================================

test("el caso real: 610002 y 500004 se llaman casi igual y solo una es de costo", () => {
  // El 03/09 se clasificó "Honorario del gestor externo" contra 610002. La
  // correcta es 500004. Fue un error de alguien que acababa de diseñar el modelo,
  // eligiendo de 64 cuentas donde dos se llaman casi igual.
  const sugeridas = cuentasSugeridasParaTramite(PLAN).map((c) => c.code);
  assert.ok(
    sugeridas.includes("500004"),
    "la correcta tiene que estar en la lista corta"
  );
  assert.ok(
    !sugeridas.includes("610002"),
    "la parecida NO, o el error se repite exactamente igual"
  );
});

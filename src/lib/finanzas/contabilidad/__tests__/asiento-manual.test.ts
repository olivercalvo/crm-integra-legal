/**
 * Asiento manual — totales y armado.
 *
 * Lo que protege:
 *
 *   1. El totalizador da lo mismo que el RPC. Si divergen, la pantalla dice que
 *      cuadra y el servidor lo rechaza — o al revés, que es peor.
 *   2. Una línea es débito O crédito, y el editor limpia el otro campo.
 *   3. 🔴 **Que NO se cuele el guard de cuentas de gasto.** Un asiento manual
 *      contra patrimonio o contra ingreso es lo normal, no la excepción.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  armarAsientoManual,
  estadoDelRegistro,
  lineaManualVacia,
  lineaManualVaciaODescartable,
  parseImporte,
  totalesManuales,
  MAX_LINEAS_MANUALES,
  type LineaManualDraft,
} from "@/lib/finanzas/contabilidad/asiento-manual";

function linea(over: Partial<LineaManualDraft> = {}): LineaManualDraft {
  return {
    key: "k" + Math.random(),
    account_code: "610001",
    debit: "",
    credit: "",
    description: "",
    tercero: "",
    ...over,
  };
}

// ===========================================================================
// 1. EL TOTALIZADOR
// ===========================================================================

test("un asiento cuadrado da diferencia 0 y `cuadra`", () => {
  const t = totalesManuales([
    linea({ debit: "1500.00" }),
    linea({ credit: "1500.00" }),
  ]);
  assert.deepEqual(t, { debitos: 1500, creditos: 1500, diferencia: 0, cuadra: true });
});

test("la diferencia se muestra con signo: sirve para saber de qué lado falta", () => {
  const t = totalesManuales([linea({ debit: "1500" }), linea({ credit: "1400" })]);
  assert.equal(t.diferencia, 100);
  assert.equal(t.cuadra, false);
});

test("la diferencia negativa también", () => {
  const t = totalesManuales([linea({ debit: "1400" }), linea({ credit: "1500" })]);
  assert.equal(t.diferencia, -100);
});

test("redondea cada suma al FINAL, como hace el RPC", () => {
  // El RPC compara round(sum(debit),2) contra round(sum(credit),2). Sumar
  // redondeos daría otro número, y la pantalla diría que cuadra cuando no.
  const t = totalesManuales([
    linea({ debit: "0.005" }),
    linea({ debit: "0.005" }),
    linea({ credit: "0.01" }),
  ]);
  assert.equal(t.debitos, 0.01);
  assert.equal(t.creditos, 0.01);
  assert.equal(t.cuadra, true);
});

test("sin líneas los totales son 0, no NaN", () => {
  assert.deepEqual(totalesManuales([]), {
    debitos: 0,
    creditos: 0,
    diferencia: 0,
    cuadra: true,
  });
});

test("un asiento de seis líneas cuadra igual", () => {
  const t = totalesManuales([
    linea({ debit: "100" }),
    linea({ debit: "200" }),
    linea({ debit: "300.55" }),
    linea({ credit: "50.55" }),
    linea({ credit: "250" }),
    linea({ credit: "300" }),
  ]);
  assert.equal(t.debitos, 600.55);
  assert.equal(t.creditos, 600.55);
  assert.equal(t.cuadra, true);
});

// ===========================================================================
// 2. IMPORTES ESCRITOS A MANO
// ===========================================================================

test("acepta coma decimal, que es como se teclea en Panamá", () => {
  assert.equal(parseImporte("1.497,85"), 1497.85);
});

test("acepta punto decimal", () => {
  assert.equal(parseImporte("1,497.85"), 1497.85);
});

test("vacío es 0 — en un asiento la mitad de las celdas están vacías por diseño", () => {
  assert.equal(parseImporte(""), 0);
  assert.equal(parseImporte("   "), 0);
});

test("basura es 0, no NaN", () => {
  assert.equal(parseImporte("abc"), 0);
});

// ===========================================================================
// 3. ARMADO
// ===========================================================================

test("una línea intacta se descarta en silencio", () => {
  const r = armarAsientoManual([
    linea({ debit: "100" }),
    linea({ credit: "100" }),
    lineaManualVacia("k3"),
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.lineas.length, 2);
});

test("la línea vacía se reconoce por los CUATRO campos", () => {
  assert.equal(lineaManualVaciaODescartable(lineaManualVacia("k")), true);
  // Con solo la descripción cargada ya no es descartable: alguien la escribió.
  assert.equal(
    lineaManualVaciaODescartable(linea({ account_code: "", description: "algo" })),
    false
  );
});

test("sin ninguna línea útil se rechaza antes de llegar al servidor", () => {
  const r = armarAsientoManual([lineaManualVacia("a"), lineaManualVacia("b")]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /ninguna línea/);
});

test("una línea sin cuenta se ataja acá, y el mensaje dice cuántas", () => {
  // Sin código, el RPC contestaría "Cuenta(s) inexistentes: " con la lista vacía.
  const r = armarAsientoManual([
    linea({ account_code: "", debit: "100" }),
    linea({ credit: "100" }),
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /una línea sin cuenta/);
});

test("más de MAX_LINEAS_MANUALES se rechaza", () => {
  const muchas = Array.from({ length: MAX_LINEAS_MANUALES + 1 }, () =>
    linea({ debit: "1" })
  );
  const r = armarAsientoManual(muchas);
  assert.equal(r.ok, false);
});

test("la descripción de línea vacía viaja como null, no como cadena vacía", () => {
  const r = armarAsientoManual([
    linea({ debit: "100", description: "  " }),
    linea({ credit: "100", description: "Contrapartida" }),
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.lineas[0].description, null);
  assert.equal(r.lineas[1].description, "Contrapartida");
});

// ===========================================================================
// 4. 🔴 EL GUARD DE GASTOS NO SE APLICA ACÁ
// ===========================================================================

test("🔴 un asiento contra PATRIMONIO se arma sin problema", () => {
  // El aporte de capital de las socias. Si alguien "unifica" el guard de gastos
  // con éste, este test se pone en rojo y explica por qué no se puede.
  const r = armarAsientoManual([
    linea({ account_code: "100001", debit: "5000", description: "Banco" }),
    linea({ account_code: "300001", credit: "5000", description: "Capital Social" }),
  ]);
  assert.equal(
    r.ok,
    true,
    "\n🔴 Un asiento manual es el mecanismo para tocar lo que ningún documento\n" +
      "   toca. Aplicarle `esTipoValidoParaGasto()` convertiría la herramienta de\n" +
      "   ajuste en la única que no puede ajustar. Ver sop.md SOP-024, regla 3.\n"
  );
});

test("🔴 un asiento contra INGRESO también", () => {
  const r = armarAsientoManual([
    linea({ account_code: "400001", debit: "800", description: "Ajuste de ingresos diferidos" }),
    linea({ account_code: "200001", credit: "800" }),
  ]);
  assert.equal(r.ok, true);
});

test("🔴 y contra PASIVO", () => {
  const r = armarAsientoManual([
    linea({ account_code: "200001", debit: "300" }),
    linea({ account_code: "100001", credit: "300" }),
  ]);
  assert.equal(r.ok, true);
});

test("el módulo no importa nada de `cuentas-de-gasto`", async () => {
  // La forma más directa de fijar la regla: si alguien agrega el import, esto
  // falla. Es una regla que ningún tipo de TypeScript puede sostener.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const fuente = readFileSync(
    join(process.cwd(), "src/lib/finanzas/contabilidad/asiento-manual.ts"),
    "utf8"
  );
  const lineasDeImport = fuente
    .split("\n")
    .filter((l) => l.trimStart().startsWith("import "));
  assert.ok(
    !lineasDeImport.some((l) => l.includes("cuentas-de-gasto")),
    "🔴 `asiento-manual.ts` NO debe importar el guard de cuentas de gasto: un ajuste va contra patrimonio o ingreso tan seguido como contra gasto"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// estadoDelRegistro — POR QUÉ EL BOTÓN ESTÁ APAGADO
// ═══════════════════════════════════════════════════════════════════════════
//
// El 09/09/2026 esto bloqueó la demo delante del cliente: RM armó un asiento
// de 100 contra 100, el totalizador se puso verde y el botón siguió apagado
// porque faltaba la descripción — que no avisaba nada. Se leía como un botón
// roto.
//
// Estos tests fijan las dos mitades: que el motivo exista siempre que el botón
// esté apagado, y que corregir el descuadre DENTRO DE LA MISMA SESIÓN de
// edición habilite el registro.

/**
 * Réplica de `actualizar()` del formulario
 * (`asientos/_components/asiento-manual-form.tsx`). Se copia a propósito: lo
 * que se prueba es la SESIÓN DE EDICIÓN, no una llamada suelta. Un test que
 * arme el arreglo final a mano no habría detectado nada de esto.
 */
function editar(
  lineas: LineaManualDraft[],
  i: number,
  cambios: Partial<LineaManualDraft>
): LineaManualDraft[] {
  const copia = [...lineas];
  const l = { ...copia[i], ...cambios };
  if ("debit" in cambios && cambios.debit !== "") l.credit = "";
  if ("credit" in cambios && cambios.credit !== "") l.debit = "";
  copia[i] = l;
  return copia;
}

test("🔴 descuadrado y corregido a cuadrado EN LA MISMA SESIÓN habilita el registro", () => {
  // Exactamente el camino de la reunión del 09/09.
  let lineas: LineaManualDraft[] = [lineaManualVacia("l0"), lineaManualVacia("l1")];
  lineas = editar(lineas, 0, { account_code: "610001" });
  lineas = editar(lineas, 1, { account_code: "100001" });
  const descripcion = "Depreciación de mobiliario — agosto";

  // 90 contra 100: no cuadra, y el motivo dice de qué lado falta.
  lineas = editar(lineas, 0, { debit: "90" });
  lineas = editar(lineas, 1, { credit: "100" });
  const descuadrado = estadoDelRegistro(lineas, descripcion);
  assert.equal(descuadrado.puede, false);
  assert.match(descuadrado.motivo ?? "", /no cuadra/i);
  assert.match(descuadrado.motivo ?? "", /10\.00/);
  assert.match(descuadrado.motivo ?? "", /débito/);

  // Se corrige el 90 a 100 sin recargar nada.
  lineas = editar(lineas, 0, { debit: "100" });
  const corregido = estadoDelRegistro(lineas, descripcion);
  assert.equal(
    corregido.puede,
    true,
    `el botón tiene que habilitarse; motivo devuelto: ${corregido.motivo}`
  );
  assert.equal(corregido.motivo, null);
});

test("sin descripción el botón está apagado, y lo DICE", () => {
  // El bloqueo invisible del 09/09: el totalizador en verde y el botón muerto.
  let lineas: LineaManualDraft[] = [lineaManualVacia("l0"), lineaManualVacia("l1")];
  lineas = editar(lineas, 0, { account_code: "610001", debit: "100" });
  lineas = editar(lineas, 1, { account_code: "100001", credit: "100" });

  assert.ok(totalesManuales(lineas).cuadra, "el asiento cuadra");

  const estado = estadoDelRegistro(lineas, "");
  assert.equal(estado.puede, false);
  assert.match(estado.motivo ?? "", /naturaleza del asiento/i);
});

test("una línea sin cuenta apaga el botón y nombra CUÁL línea", () => {
  // Antes de esto el botón se habilitaba y el rechazo llegaba del servidor.
  let lineas: LineaManualDraft[] = [lineaManualVacia("l0"), lineaManualVacia("l1")];
  lineas = editar(lineas, 0, { account_code: "610001", debit: "100" });
  lineas = editar(lineas, 1, { credit: "100" }); // sin cuenta

  const estado = estadoDelRegistro(lineas, "Ajuste de cierre");
  assert.equal(estado.puede, false);
  assert.match(estado.motivo ?? "", /línea 2/i);
});

test("el formulario vacío pide los importes, no el cuadre", () => {
  const lineas = [lineaManualVacia("l0"), lineaManualVacia("l1")];
  const estado = estadoDelRegistro(lineas, "");
  assert.equal(estado.puede, false);
  assert.match(estado.motivo ?? "", /importes/i);
});

test("mientras se envía, el motivo lo dice en vez de quedar mudo", () => {
  let lineas: LineaManualDraft[] = [lineaManualVacia("l0"), lineaManualVacia("l1")];
  lineas = editar(lineas, 0, { account_code: "610001", debit: "100" });
  lineas = editar(lineas, 1, { account_code: "100001", credit: "100" });

  const estado = estadoDelRegistro(lineas, "Ajuste de cierre", true);
  assert.equal(estado.puede, false);
  assert.match(estado.motivo ?? "", /registrando/i);
});

test("🔒 apagado SIEMPRE trae motivo, y habilitado NUNCA", () => {
  // La regla que sostiene el arreglo: no se puede agregar una condición nueva
  // sin escribir su frase. Si alguien suma una cláusula muda, esto falla.
  let lineas: LineaManualDraft[] = [lineaManualVacia("l0"), lineaManualVacia("l1")];
  const casos: Array<[LineaManualDraft[], string, boolean]> = [];
  casos.push([lineas, "", false]);

  lineas = editar(lineas, 0, { account_code: "610001", debit: "100" });
  casos.push([lineas, "Ajuste de cierre", false]); // no cuadra todavía
  lineas = editar(lineas, 1, { credit: "100" });
  casos.push([lineas, "Ajuste de cierre", false]); // falta la cuenta de la 2
  lineas = editar(lineas, 1, { account_code: "100001" });
  casos.push([lineas, "", false]); // falta la descripción
  casos.push([lineas, "Ajuste de cierre", true]);

  for (const [ls, desc, esperado] of casos) {
    const e = estadoDelRegistro(ls, desc);
    assert.equal(e.puede, esperado);
    if (e.puede) assert.equal(e.motivo, null, "habilitado no lleva motivo");
    else assert.ok((e.motivo ?? "").length > 0, "apagado SIEMPRE lleva motivo");
  }
});

test("los motivos hablan como un contador, no como el código", () => {
  // Nombran lo que falta en la pantalla. Nunca el campo del código ni su largo.
  let lineas: LineaManualDraft[] = [lineaManualVacia("l0"), lineaManualVacia("l1")];
  lineas = editar(lineas, 0, { account_code: "610001", debit: "100" });
  lineas = editar(lineas, 1, { account_code: "100001", credit: "90" });

  const motivos = [
    estadoDelRegistro([lineaManualVacia("l0")], "").motivo,
    estadoDelRegistro(lineas, "").motivo,
    estadoDelRegistro(lineas, "Ajuste").motivo,
  ];

  for (const m of motivos) {
    assert.ok(m, "hay motivo");
    assert.doesNotMatch(m!, /descripcion|account_code|length|null|undefined|<|>=/i, m!);
  }
});

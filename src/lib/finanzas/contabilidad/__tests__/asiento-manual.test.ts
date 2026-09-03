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

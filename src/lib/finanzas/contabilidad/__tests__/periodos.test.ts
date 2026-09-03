/**
 * Períodos contables — estado y presentación.
 *
 * Lo que protege:
 *
 *   1. 🔴 **"Reabierto" es un estado propio.** En la base `status` solo tiene dos
 *      valores, pero un período reabierto NO es lo mismo que uno que nunca se
 *      cerró: el primero es un ejercicio que alguien ya dio por certificado.
 *      Mostrarlos iguales esconde exactamente el hecho que hay que ver.
 *   2. **Una acción que no cambia nada no escribe.** Cerrar lo ya cerrado pisaría
 *      `closed_at` con una fecha nueva y perdería la original.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  agruparPorAnio,
  codigoPeriodo,
  esAccionPeriodo,
  estadoDe,
  etiquetaPeriodo,
  laAccionCambiaAlgo,
  type PeriodoRow,
} from "@/lib/finanzas/contabilidad/periodos";

function periodo(over: Partial<PeriodoRow> = {}): PeriodoRow {
  return {
    id: "p" + Math.random(),
    year: 2026,
    month: 3,
    status: "abierto",
    closed_at: null,
    closed_by: null,
    asientos: 0,
    ...over,
  };
}

// ===========================================================================
// 1. 🔴 LOS TRES ESTADOS
// ===========================================================================

test("nunca cerrado → abierto", () => {
  assert.equal(estadoDe({ status: "abierto", closed_at: null }), "abierto");
});

test("cerrado → cerrado", () => {
  assert.equal(estadoDe({ status: "cerrado", closed_at: "2026-04-01T10:00:00Z" }), "cerrado");
});

test("🔴 abierto CON closed_at → reabierto, que NO es lo mismo que abierto", () => {
  // Es la razón por la que la ruta conserva `closed_at` al reabrir en vez de
  // limpiarlo. Si lo limpiara, este caso sería indistinguible de "abierto" y se
  // perdería el hecho de que alguien lo dio por cerrado ante la DGI.
  assert.equal(
    estadoDe({ status: "abierto", closed_at: "2026-04-01T10:00:00Z" }),
    "reabierto",
    "\n🔴 Un período reabierto es un ejercicio YA certificado que volvió a admitir\n" +
      "   asientos. Si se muestra igual que uno que nunca se cerró, ese hecho\n" +
      "   desaparece de la pantalla.\n"
  );
});

test("un período cerrado SIEMPRE tiene closed_at, pero el estado no depende de eso", () => {
  // Defensivo: si por un UPDATE a mano quedara `cerrado` sin fecha, sigue siendo
  // cerrado. El estado lo manda `status`; `closed_at` solo distingue los dos
  // sabores de "abierto".
  assert.equal(estadoDe({ status: "cerrado", closed_at: null }), "cerrado");
});

// ===========================================================================
// 2. LA ACCIÓN QUE NO CAMBIA NADA
// ===========================================================================

test("cerrar uno abierto cambia algo; cerrar uno cerrado no", () => {
  assert.equal(laAccionCambiaAlgo("abierto", "cerrar"), true);
  assert.equal(
    laAccionCambiaAlgo("cerrado", "cerrar"),
    false,
    "un cierre repetido pisaría closed_at con una fecha nueva y perdería la original"
  );
});

test("reabrir uno cerrado cambia algo; reabrir uno abierto no", () => {
  assert.equal(laAccionCambiaAlgo("cerrado", "reabrir"), true);
  assert.equal(laAccionCambiaAlgo("abierto", "reabrir"), false);
});

test("solo se aceptan `cerrar` y `reabrir`", () => {
  assert.equal(esAccionPeriodo("cerrar"), true);
  assert.equal(esAccionPeriodo("reabrir"), true);
  assert.equal(esAccionPeriodo("borrar"), false);
  assert.equal(esAccionPeriodo(""), false);
  assert.equal(esAccionPeriodo(null), false);
});

// ===========================================================================
// 3. PRESENTACIÓN
// ===========================================================================

test("la etiqueta es legible para un contador", () => {
  assert.equal(etiquetaPeriodo(2026, 3), "marzo 2026");
  assert.equal(etiquetaPeriodo(2026, 12), "diciembre 2026");
});

test("un mes fuera de rango no rompe la pantalla", () => {
  assert.equal(etiquetaPeriodo(2026, 13), "13/2026");
  assert.equal(etiquetaPeriodo(2026, 0), "0/2026");
});

test("el código coincide con el que usan los mensajes del RPC", () => {
  // El RPC dice "El período 2026-03 está CERRADO". Si acá se escribiera distinto,
  // la persona no relacionaría el error con la fila de la pantalla.
  assert.equal(codigoPeriodo(2026, 3), "2026-03");
  assert.equal(codigoPeriodo(2026, 11), "2026-11");
});

// ===========================================================================
// 4. AGRUPAMIENTO
// ===========================================================================

test("los años van del más reciente al más viejo", () => {
  // El contador trabaja sobre el ejercicio en curso: no tiene por qué bajar hasta
  // el final para encontrarlo.
  const g = agruparPorAnio([
    periodo({ year: 2025, month: 1 }),
    periodo({ year: 2027, month: 1 }),
    periodo({ year: 2026, month: 1 }),
  ]);
  assert.deepEqual(g.map((a) => a.year), [2027, 2026, 2025]);
});

test("dentro de cada año los meses van de enero a diciembre", () => {
  const g = agruparPorAnio([
    periodo({ month: 12 }),
    periodo({ month: 1 }),
    periodo({ month: 6 }),
  ]);
  assert.deepEqual(g[0].periodos.map((p) => p.month), [1, 6, 12]);
});

test("cuenta abiertos y cerrados por año", () => {
  const g = agruparPorAnio([
    periodo({ month: 1, status: "cerrado", closed_at: "2026-02-01T00:00:00Z" }),
    periodo({ month: 2, status: "cerrado", closed_at: "2026-03-01T00:00:00Z" }),
    periodo({ month: 3, status: "abierto" }),
  ]);
  assert.equal(g[0].cerrados, 2);
  assert.equal(g[0].abiertos, 1);
});

test("un período REABIERTO cuenta como abierto en el resumen del año", () => {
  // Y está bien: para "cuántos meses admiten asientos", un reabierto admite.
  // El matiz de que fue certificado se ve en su fila, no en el contador.
  const g = agruparPorAnio([
    periodo({ month: 1, status: "abierto", closed_at: "2026-02-01T00:00:00Z" }),
  ]);
  assert.equal(g[0].abiertos, 1);
  assert.equal(estadoDe(g[0].periodos[0]), "reabierto");
});

test("sin períodos devuelve una lista vacía, no explota", () => {
  assert.deepEqual(agruparPorAnio([]), []);
});

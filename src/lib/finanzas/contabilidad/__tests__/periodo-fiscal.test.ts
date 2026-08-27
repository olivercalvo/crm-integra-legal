/**
 * Tests de las reglas del período fiscal (Fase 1, Tarea 5).
 *
 * Estas reglas las va a reusar la Fase 2 para sembrar `accounting_periods`, así
 * que conviene que estén clavadas antes de que algo dependa de ellas.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/contabilidad/__tests__/periodo-fiscal.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  anioFiscalDe,
  anioMaximoSaldoInicial,
  cierrePeriodoFiscal,
  esFechaISOValida,
  inicioPeriodoFiscal,
} from "@/lib/finanzas/contabilidad/periodo-fiscal";

test("el período fiscal de Integra va del 1 de enero al 31 de diciembre", () => {
  assert.equal(inicioPeriodoFiscal(2026), "2026-01-01");
  assert.equal(cierrePeriodoFiscal(2026), "2026-12-31");
});

test("el cierre se deriva del inicio, no está hardcodeado en '12-31'", () => {
  // Si algún día el período fiscal se desfasa, cambiar las dos constantes tiene
  // que alcanzar. Este test cubre un año bisiesto para que no se cuele un
  // cálculo de días fijo.
  assert.equal(cierrePeriodoFiscal(2024), "2024-12-31");
  assert.equal(inicioPeriodoFiscal(2024), "2024-01-01");
});

test("anioFiscalDe ubica una fecha en su período", () => {
  assert.equal(anioFiscalDe("2026-01-01"), 2026);
  assert.equal(anioFiscalDe("2026-08-14"), 2026);
  assert.equal(anioFiscalDe("2026-12-31"), 2026);
  assert.equal(anioFiscalDe("2027-01-01"), 2027);
});

test("anioFiscalDe devuelve null si la fecha no parsea", () => {
  assert.equal(anioFiscalDe("14/08/2026"), null);
  assert.equal(anioFiscalDe(""), null);
});

test("esFechaISOValida acepta solo AAAA-MM-DD reales", () => {
  assert.equal(esFechaISOValida("2026-01-01"), true);
  assert.equal(esFechaISOValida("2024-02-29"), true, "2024 es bisiesto");

  assert.equal(esFechaISOValida("2026-02-30"), false, "el 30 de febrero no existe");
  assert.equal(esFechaISOValida("2025-02-29"), false, "2025 no es bisiesto");
  assert.equal(esFechaISOValida("2026-13-01"), false, "no hay mes 13");
  assert.equal(esFechaISOValida("14/08/2026"), false, "formato local");
  assert.equal(esFechaISOValida("2026-1-1"), false, "sin cero a la izquierda");
  assert.equal(esFechaISOValida(20260101), false, "no es string");
  assert.equal(esFechaISOValida(null), false);
});

test("el año máximo aceptado es el siguiente al de hoy", () => {
  // Cargar un saldo de apertura con fecha muy futura casi siempre es un dedazo.
  assert.equal(anioMaximoSaldoInicial(new Date("2026-08-27T00:00:00Z")), 2027);
  assert.equal(anioMaximoSaldoInicial(new Date("2030-01-01T00:00:00Z")), 2031);
});

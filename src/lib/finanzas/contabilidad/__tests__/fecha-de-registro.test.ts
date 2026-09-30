/**
 * 🔒 LA FECHA DE REGISTRO (Bloque 1, E1).
 *
 *   npm test
 *
 * Revisión de Josuarth del 28/09/2026 y reunión del 30/09/2026: el contador
 * elige la fecha de registro de documentos, notas, reversiones y anulaciones;
 * siempre en un período abierto; una reversión nunca antes de su original.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PERMITIR_FECHA_DE_REGISTRO_FUTURA,
  errorDeFechaDeRegistro,
  esFechaIso,
  periodoDe,
} from "../fecha-de-registro";

const HOY = "2026-09-30";

test("una fecha en un período abierto se acepta", () => {
  assert.equal(errorDeFechaDeRegistro({ fecha: "2026-09-15", hoy: HOY, periodoCerrado: false }), null);
});

test("🔴 período cerrado: se rechaza y el mensaje nombra el mes", () => {
  const e = errorDeFechaDeRegistro({ fecha: "2026-08-31", hoy: HOY, periodoCerrado: true });
  assert.ok(e);
  assert.match(e!, /2026-08 está cerrado/);
});

test("🔴 reversión anterior al original: se rechaza, nombrando el asiento y su fecha", () => {
  const e = errorDeFechaDeRegistro({
    fecha: "2026-09-01",
    hoy: HOY,
    periodoCerrado: false,
    noAntesDe: { fecha: "2026-09-10", etiqueta: "el asiento 42" },
    que: "la reversión",
  });
  assert.ok(e);
  assert.match(e!, /no puede ser anterior a la fecha del asiento 42 \(10\/09\/2026\)/);
  const f = errorDeFechaDeRegistro({
    fecha: "2026-09-01", hoy: HOY, periodoCerrado: false,
    noAntesDe: { fecha: "2026-09-10", etiqueta: "la factura FAC-HON-000009" },
  });
  assert.match(f!, /anterior a la fecha de la factura FAC-HON-000009/);
});

test("la reversión el mismo día del original, o después, se acepta", () => {
  const regla = { hoy: HOY, periodoCerrado: false, noAntesDe: { fecha: "2026-09-10", etiqueta: "el asiento 42" } };
  assert.equal(errorDeFechaDeRegistro({ ...regla, fecha: "2026-09-10" }), null);
  assert.equal(errorDeFechaDeRegistro({ ...regla, fecha: "2026-09-25" }), null);
});

test("🟡 fechas futuras en un mes abierto: detrás de UNA constante (pregunta 5, P-1c)", () => {
  const e = errorDeFechaDeRegistro({ fecha: "2026-10-05", hoy: HOY, periodoCerrado: false });
  if (PERMITIR_FECHA_DE_REGISTRO_FUTURA) {
    assert.equal(e, null, "mientras Josuarth no conteste, se permiten");
  } else {
    assert.match(e!, /posterior a hoy/);
  }
});

test("🔒 la llave de las fechas futuras está en UN solo lugar", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) {
        if (n !== "__tests__" && n !== "node_modules") recorrer(p);
      } else if (/\.(ts|tsx)$/.test(n) && /PERMITIR_FECHA_DE_REGISTRO_FUTURA\s*=/.test(readFileSync(p, "utf8"))) {
        encontrados.push(p);
      }
    }
  };
  recorrer("src");
  assert.equal(encontrados.length, 1, `se define en: ${encontrados.join(", ")}`);
});

test("el período cerrado se revisa DESPUÉS de las otras reglas (es lo único que se arregla en otra pantalla)", () => {
  const e = errorDeFechaDeRegistro({
    fecha: "2026-08-01",
    hoy: HOY,
    periodoCerrado: true,
    noAntesDe: { fecha: "2026-08-15", etiqueta: "el asiento 7" },
  });
  assert.match(e!, /anterior/);
});

test("formato: sólo fechas calendario reales AAAA-MM-DD", () => {
  assert.equal(esFechaIso("2026-09-30"), true);
  assert.equal(esFechaIso("2026-02-31"), false);
  assert.equal(esFechaIso("30/09/2026"), false);
  assert.equal(esFechaIso(undefined), false);
  assert.match(errorDeFechaDeRegistro({ fecha: "31/02/2026", hoy: HOY, periodoCerrado: false })!, /no es una fecha válida/);
});

test("periodoDe arma la etiqueta de la pantalla de Períodos", () => {
  assert.deepEqual(periodoDe("2026-09-30"), { year: 2026, month: 9, etiqueta: "2026-09" });
});

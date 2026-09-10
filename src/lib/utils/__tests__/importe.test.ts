import test from "node:test";
import assert from "node:assert/strict";

import { fmtImporte } from "@/lib/utils/importe";

/**
 * El separador de miles es la razón de ser de este módulo: hasta el 10/09/2026
 * Facturación y Cotizaciones usaban `.toFixed(2)` pelado y la misma factura se
 * leía `1,605.00` en el Libro Mayor y `$1605.00` en su propio detalle.
 */

test("pone separador de miles a partir de cuatro dígitos", () => {
  assert.equal(fmtImporte(1605), "1,605.00");
  assert.equal(fmtImporte(15000), "15,000.00");
  assert.equal(fmtImporte(191947.55), "191,947.55");
});

test("siempre dos decimales", () => {
  assert.equal(fmtImporte(0), "0.00");
  assert.equal(fmtImporte(105), "105.00");
  assert.equal(fmtImporte(1.5), "1.50");
});

test("acepta el texto que devuelve Postgres para las columnas numeric", () => {
  // PostgREST manda los `numeric` como string; media app los recibe así.
  assert.equal(fmtImporte("1605.00"), "1,605.00");
  assert.equal(fmtImporte("191947.55"), "191,947.55");
});

test("no escupe NaN en una columna de plata", () => {
  assert.equal(fmtImporte(null), "0.00");
  assert.equal(fmtImporte(undefined), "0.00");
  assert.equal(fmtImporte("no es un número"), "0.00");
});

test("no agrega símbolo de moneda: lo pone la pantalla", () => {
  // Unas pantallas usan `$` y otras `B/.`. Si el símbolo viniera de acá habría
  // que arrancárselo en la mitad de los lugares.
  const salida = fmtImporte(1605);
  assert.ok(!salida.includes("$") && !salida.includes("B/."), salida);
});

test("redondea a dos decimales sin arrastrar el tercero", () => {
  assert.equal(fmtImporte(10.999), "11.00");
  assert.equal(fmtImporte(0.005), "0.01");
});

/**
 * 🔒 LIBRO MAYOR: el desplazamiento horizontal siempre a mano (Parte 3, 14/10/2026).
 *
 * Fija: el encabezado de columnas fijo bajo la cabecera de la app, la barra
 * horizontal fija al pie de la ventana, encabezado y cuerpo con el MISMO
 * `<colgroup>` (si no, las columnas se desalinean), y un ancho por cada una de
 * las 13 columnas del modelo de Josuarth.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const DIR = "src/app/finanzas/reportes/mayor/_components/";

test("el marco fija el encabezado arriba y la barra abajo, y comparte las columnas", () => {
  const marco = leer(DIR + "mayor-desplazable.tsx");
  assert.match(marco, /sticky top-\[calc\(4rem\+var\(--env-band-h,0px\)\)\]/);
  assert.match(marco, /sticky bottom-0[^"]*overflow-x-auto/);
  // Los dos `<table>` usan la misma variable `columnas`.
  assert.equal((marco.match(/\{columnas\}/g) ?? []).length, 2);
  assert.equal((marco.match(/className="table-fixed"/g) ?? []).length, 2);
});

test("la tabla del mayor usa el marco, con un ancho por cada una de sus 13 columnas", () => {
  const tabla = leer(DIR + "libro-mayor-table.tsx");
  assert.match(tabla, /<MayorDesplazable/);
  assert.doesNotMatch(tabla, /overflow-x-auto/, "un overflow propio volvería a mandar la barra al final de la tabla");
  const anchos = tabla.match(/const ANCHOS_DE_COLUMNA = \[([^\]]+)\]/);
  assert.ok(anchos);
  assert.equal(anchos![1].split(",").length, 13);
  const ths = tabla.slice(tabla.indexOf("encabezado={"), tabla.indexOf("</thead>")).match(/<th /g) ?? [];
  assert.equal(ths.length, 13);
  const fila = leer(DIR + "fila-expandible.tsx");
  assert.match(fila, /const COLUMNAS_DEL_MAYOR = 13;/);
});

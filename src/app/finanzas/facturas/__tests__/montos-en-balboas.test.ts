/**
 * 🔒 Los montos del módulo de facturas se muestran en B/., no con «$»
 * (Oliver, 01/10/2026: el detalle de la factura mostraba «$» en el Resumen y en
 * las líneas mientras el resto del sistema usa B/.).
 *
 * Mira el JSX: una línea con `${fmtImporte(` FUERA de un template literal es un
 * «$» impreso en pantalla. Las que tienen backtick son interpolaciones de
 * texto (`B/. ${fmtImporte(x)}`) y se dejan.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../../..");
const DIR = path.join(RAIZ, "src/app/finanzas/facturas");

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : archivos(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

test("ningún monto del módulo de facturas se muestra con «$»", () => {
  const malas: string[] = [];
  for (const f of archivos(DIR)) {
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .forEach((l, i) => {
        if (!l.includes("`") && /\$\{fmtImporte\(/.test(l)) malas.push(`${path.relative(RAIZ, f)}:${i + 1}`);
      });
  }
  assert.deepEqual(malas, [], `montos con «$»: ${malas.join(", ")}`);
});

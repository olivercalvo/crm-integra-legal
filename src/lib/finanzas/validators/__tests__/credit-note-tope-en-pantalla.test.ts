/**
 * 🔒 El diálogo de nota de crédito frena EN PANTALLA una cantidad mayor a la
 * disponible, con la misma función y el mismo texto que el servidor
 * (25/09/2026). Antes calculaba B/. 21.40 sobre una línea con 1 de 2
 * disponible y dejaba el botón activo.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { errorDeCantidadAcreditable } from "../credit-note";

const base = { descripcion: "Honorarios corporativos", facturado: 2, disponible: 1 };

test("dentro del disponible: sin error", () => {
  assert.equal(errorDeCantidadAcreditable({ ...base, cantidad: 1 }), null);
  assert.equal(errorDeCantidadAcreditable({ ...base, cantidad: 0.5 }), null);
});

test("más que el disponible: el texto del servidor, con facturado y ya acreditado", () => {
  assert.equal(
    errorDeCantidadAcreditable({ ...base, cantidad: 2 }),
    'La línea "Honorarios corporativos" tiene 1 disponible(s) para acreditar (facturado 2, ya acreditado 1).'
  );
});

test("línea ya acreditada por completo", () => {
  assert.equal(
    errorDeCantidadAcreditable({ ...base, disponible: 0, cantidad: 1 }),
    'La línea "Honorarios corporativos" ya está acreditada por completo.'
  );
});

test("🔒 la pantalla de NC usa la misma función y apaga el botón con el error", () => {
  const raiz = path.resolve(__dirname, "../../../../..");
  // E8: el diálogo se reemplazó por la pantalla del módulo, que corre el
  // validador ENTERO del servidor (y con él, este mismo tope por línea).
  const dialogo = readFileSync(path.join(raiz, "src/app/finanzas/notas-credito/_components/nota-de-credito-form.tsx"), "utf8");
  const validador = readFileSync(path.join(raiz, "src/lib/finanzas/validators/credit-note.ts"), "utf8");
  assert.match(dialogo, /validarLineasDeNotaDeCredito\(/);
  assert.match(dialogo, /disabled=\{isPending \|\| sinFacturaBloqueado \|\| !validacion \|\| !validacion\.ok\}/);
  assert.doesNotMatch(dialogo, /qty > x\.linea\.disponible|> l\.disponible/, "no reimplementa el tope");
  assert.match(validador, /const excedida = errorDeCantidadAcreditable\(/, "el servidor usa la misma");
});

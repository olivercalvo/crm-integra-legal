/**
 * 🔒 UNA NC ES "DE ANULACIÓN" POR NO TENER ASIENTO PROPIO, NO POR SU FACTURA.
 *
 *   npm test
 *
 * D5: la NC que sale de anular una factura no tiene asiento propio (la
 * anulación ya reversó el asiento de la factura). La pantalla lo deducía de
 * `invoice.status === "anulada"`, y desde la 063 eso deja de alcanzar: una NC
 * por líneas, reversada, sobre una factura que después se anula, tiene asiento
 * propio y NO es de anulación. Encontrado con clics el 25/09/2026, junto con la
 * etiqueta "Parcial" en una NC que acreditaba la factura entera.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../../..");
const PAGINA = readFileSync(path.resolve(RAIZ, "src/app/finanzas/notas-credito/[id]/page.tsx"), "utf8");

test("🔒 esAnulacion exige que la NC NO tenga asiento propio", () => {
  assert.match(PAGINA, /const esAnulacion = nc\.invoice\?\.status === "anulada" && asiento === null;/);
  assert.ok(
    PAGINA.indexOf("const asiento = propios.get") < PAGINA.indexOf("const esAnulacion"),
    "el asiento propio se carga ANTES de decidir si es de anulación"
  );
});

test("la etiqueta dice Total cuando la NC acredita la factura entera", () => {
  assert.match(PAGINA, /\{acreditaElTotal \? "Total" : "Parcial"\}/);
});

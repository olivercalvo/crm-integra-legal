/**
 * 🔒 EL AVISO DEL DIÁLOGO DE ANULACIÓN DICE LO QUE HACE LA RUTA.
 *
 *   npm test
 *
 * Desde 9B, `POST /api/finanzas/invoices/[id]/cancel` llama a
 * `anularFacturaAnteDgi`: anula PRIMERO ante la DGI y después en el libro. El
 * diálogo siguió diciendo, hasta el 25/09/2026, que anular "solo la marca como
 * anulada en el CRM; no la anula ante la DGI" y pedía confirmar que ya se había
 * anulado a mano en el portal. Lo encontró la verificación con clics: la
 * pantalla mandaba a hacer en el portal lo que el botón ya hacía solo.
 *
 * Mientras la ruta hable con la DGI, el diálogo no puede negarlo.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.resolve(RAIZ, rel), "utf8");

const RUTA = leer("src/app/api/finanzas/invoices/[id]/cancel/route.ts");
const DIALOGO = leer("src/app/finanzas/facturas/_components/cancel-invoice-dialog.tsx")
  .replace(/\s+/g, " ");

test("🔒 si la ruta anula ante la DGI, el diálogo no dice que no lo hace", () => {
  assert.match(RUTA, /anularFacturaAnteDgi\(/, "la ruta dejó de anular ante la DGI: revisar este test");
  for (const frase of [/no la anula ante la DGI/i, /primero hay que anularla en el portal/i, /Confirmo que ya anul/i]) {
    assert.doesNotMatch(DIALOGO, frase, `el diálogo contradice a la ruta: ${frase}`);
  }
  assert.match(DIALOGO, /la anula primero ante la DGI y después en el CRM/);
});

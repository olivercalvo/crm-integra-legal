/**
 * 🔒 EL VOCABULARIO DE JOSUARTH EN LAS PANTALLAS (E2, 30/09/2026).
 *
 *   npm test
 *
 * "Fecha de registro" es la CONTABLE (`transaction_date` en el libro,
 * `accounting_date` en el documento). El día en que se grabó el asiento
 * (`record_date`) es "Grabado el". El recorrido de E1 encontró el detalle del
 * asiento al revés, y la factura, la NC y el gasto de trámite sin la fecha de
 * registro. Este test lee las pantallas y falla si vuelven a separarse.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const leer = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\s+/g, " ");

test("detalle del asiento: «Fecha de registro» es transaction_date y «Grabado el» es record_date", () => {
  const src = leer("src/app/finanzas/asientos/[id]/page.tsx");
  assert.match(src, /Fecha de registro <\/dt> <dd[^>]*>\{formatDate\(asiento\.transaction_date\)\}/);
  assert.match(src, /Grabado el <\/dt> <dd[^>]*>\{formatDate\(asiento\.record_date\)\}/);
  assert.doesNotMatch(src, /Fecha de la operación/);
});

test("detalle de la factura, de la NC y del gasto de trámite: las dos fechas visibles", () => {
  const factura = leer("src/app/finanzas/facturas/[id]/page.tsx");
  assert.match(factura, /Fecha del documento/);
  assert.match(factura, /Fecha de registro <\/dt> <dd[^>]*> \{formatDate\(registroDeLaFactura\)\}/);

  const nc = leer("src/app/finanzas/notas-credito/[id]/page.tsx");
  assert.match(nc, /Fecha del documento <\/dt> <dd[^>]*>\{formatDate\(nc\.issue_date\)\}/);
  assert.match(nc, /Fecha de registro <\/dt> <dd[^>]*> \{formatDate\(nc\.accounting_date \?\? nc\.issue_date\)\}/);

  const gasto = leer("src/app/finanzas/gastos-tramite/[id]/page.tsx");
  assert.match(gasto, /Fecha del documento/);
  assert.match(gasto, /Fecha de registro <\/dt> <dd[^>]*>\{formatDate\(gasto\.accounting_date\)\}/);
});

/**
 * El tipo de documento de una NOTA y la elección «DGI / interna» (03/10/2026).
 *
 * Fija las dos reglas que la DGI rechaza (ficha para PAC V1.00, medido en
 * sandbox: docs/efactura/prueba-tipos-05-06-07.txt):
 *   · 04/05 sin CUFE → 1705;  · 06/07 con CUFE → 1706.
 *
 * Ejecución:  npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import { tipoDocumentoDeNota } from "@/lib/finanzas/efactura/mapper/tipo-de-documento";
import { leerModoDeEnvio } from "@/lib/finanzas/efactura/orchestration/envio-al-emitir";
import { decidirAccionFiscal } from "@/lib/finanzas/efactura/orchestration/decidir-accion-fiscal";

test("NC: 04 con factura, 06 sin ella. ND: 05 con factura, 07 sin ella", () => {
  assert.equal(tipoDocumentoDeNota("credito", true), "04");
  assert.equal(tipoDocumentoDeNota("credito", false), "06");
  assert.equal(tipoDocumentoDeNota("debito", true), "05");
  assert.equal(tipoDocumentoDeNota("debito", false), "07");
});

test("envío: «dgi», «interna» o nada; cualquier otra cosa es un 400", () => {
  assert.equal(leerModoDeEnvio("dgi"), "dgi");
  assert.equal(leerModoDeEnvio("interna"), "interna");
  assert.equal(leerModoDeEnvio(undefined), null);
  assert.equal(leerModoDeEnvio(""), null);
  assert.throws(() => leerModoDeEnvio("portal"), /dgi.*interna/);
});

test("083: un documento interno se anula sólo en el libro, sin el aviso del portal", () => {
  const base = {
    status: "emitida",
    feEstado: "interna" as const,
    dgiCufe: null,
    issueDate: "2026-10-01",
    dgiFechaAutorizacion: null,
    amountPaid: 0,
    creditedTotal: 0,
    mesCerrado: false,
  };
  const a = decidirAccionFiscal(base as never, new Date("2026-10-03T15:00:00Z"));
  assert.equal(a.accion, "anular_solo_en_el_libro");
  assert.doesNotMatch(a.mensaje, /portal/);
  const b = decidirAccionFiscal({ ...base, mesCerrado: true } as never, new Date("2026-10-03T15:00:00Z"));
  assert.equal(b.accion, "no_aplica");
  assert.match(b.mensaje, /nota de crédito/);
});

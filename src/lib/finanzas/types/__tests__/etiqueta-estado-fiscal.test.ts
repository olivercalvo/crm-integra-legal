/**
 * El estado fiscal NO dice «Sin enviar» de una factura que ya existe ante la
 * DGI sin que la haya enviado el CRM (05/10/2026).
 *
 *   npm test
 *
 * `externo` (092) y `portal_050` (caso B) quedan en `fe_estado = 'no_emitida'`
 * a propósito, para que nada las mande al PAC. Antes el listado y la tarjeta
 * las mostraban «Sin enviar», como si faltara mandarlas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { etiquetaDeEstadoFiscal, FE_ESTADO_LABEL, type FeEstado } from "@/lib/finanzas/types/invoice";

test("emitida fuera del CRM (externo) y CUFE del portal (portal_050): su origen, no «Sin enviar»", () => {
  assert.deepEqual(etiquetaDeEstadoFiscal("no_emitida", "externo"), { texto: "Emitida fuera del CRM", porOrigen: true });
  assert.deepEqual(etiquetaDeEstadoFiscal("no_emitida", "portal_050"), { texto: "Autorizada en el portal", porOrigen: true });
});

test("sin CUFE, o con CUFE del propio CRM: el estado de siempre", () => {
  assert.equal(etiquetaDeEstadoFiscal("no_emitida", null).texto, "Sin enviar");
  assert.equal(etiquetaDeEstadoFiscal("no_emitida", undefined).texto, "Sin enviar");
  assert.equal(etiquetaDeEstadoFiscal("no_emitida", "crm").texto, "Sin enviar");
  assert.equal(etiquetaDeEstadoFiscal("authorized", "crm").texto, "Autorizada DGI");
});

test("sólo no_emitida se reemplaza: error, anulada, en curso o autorizada dicen lo que pasó", () => {
  for (const estado of ["error", "canceled", "pending", "authorized", "interna"] as FeEstado[]) {
    for (const origen of ["externo", "portal_050"]) {
      const r = etiquetaDeEstadoFiscal(estado, origen);
      assert.equal(r.porOrigen, false, `${estado} · ${origen}`);
      assert.equal(r.texto, FE_ESTADO_LABEL[estado], `${estado} · ${origen}`);
    }
  }
});

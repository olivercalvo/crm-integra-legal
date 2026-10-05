/**
 * LO QUE DICE UN CUFE ADENTRO (092, «Registrar factura emitida fuera»).
 *
 *   npm test
 *
 * Los CUFE son los reales del facturador del 05/10/2026 (solo lectura). La
 * estructura se verificó contra los 238 documentos del archivo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compararCufeConFactura, leerCufe, referenciaFiscal } from "../leer-cufe";

const MEI_1C = "FE0120000025046169-3-2021-4000002026071400000000021000112431062839";
const MEI_2B = "FE0120000025046169-3-2021-4000002026071400000000031000112587224588";
const MI_CONDADO = "FE0120000025046169-3-2021-4000002026080100000000041000110418925905";
const QB_REEMBOLSO = "FE0920000025046169-3-2021-4000002026070200000006030500117374644259";
const DEL_CRM = "FE0120000025046169-3-2021-4000002026100100000000900510118775058943";
const DEL_SANDBOX = "FE0120000025046169-3-2021-4000002026082100000000580010122286028903";

test("lee tipo, fecha, número, punto y ambiente de las tres del punto 100", () => {
  const casos = [
    [MEI_1C, "2026-07-14", 2],
    [MEI_2B, "2026-07-14", 3],
    [MI_CONDADO, "2026-08-01", 4],
  ] as const;
  for (const [cufe, fecha, numero] of casos) {
    const r = leerCufe(cufe);
    assert.equal(r.ok, true);
    if (!r.ok) continue;
    assert.equal(r.leido.tipo, "01");
    assert.equal(r.leido.fecha, fecha);
    assert.equal(r.leido.numero, numero);
    assert.equal(r.leido.punto, "100");
    assert.equal(r.leido.ambiente, "1");
    assert.equal(r.leido.rucEmisor, "25046169-3-2021");
  }
});

test("un reembolso de QuickBooks es tipo 09 del punto 050", () => {
  const r = leerCufe(QB_REEMBOLSO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([r.leido.tipo, r.leido.punto, r.leido.numero, r.leido.fecha], ["09", "050", 603, "2026-07-02"]);
});

test("quita espacios y saltos de línea (el portal lo muestra partido)", () => {
  const partido = MEI_1C.slice(0, 30) + " \n " + MEI_1C.slice(30).toLowerCase();
  const r = leerCufe(partido);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.leido.cufe, MEI_1C);
});

test("rechaza un CUFE cortado, sin FE o con una fecha imposible", () => {
  assert.equal(leerCufe(MEI_1C.slice(0, 60)).ok, false);
  assert.equal(leerCufe("XX" + MEI_1C.slice(2)).ok, false);
  const fechaImposible = MEI_1C.slice(0, 32) + "20260231" + MEI_1C.slice(40);
  assert.equal(leerCufe(fechaImposible).ok, false);
});

test("coincide con lo cargado: sin desacuerdos", () => {
  const r = leerCufe(MEI_1C);
  assert.ok(r.ok);
  if (!r.ok) return;
  const d = compararCufeConFactura(r.leido, {
    invoice_kind: "HONORARIOS",
    issue_date: "2026-07-14",
    punto: "100",
    numero_documento: 2,
  });
  assert.deepEqual(d, {});
});

test("🔴 el CUFE de la OTRA factura de MEI Tower se detecta por el número", () => {
  // Cargando la 1C (n.º 2) con el CUFE de la 2B (n.º 3): mismo día, mismo punto.
  const r = leerCufe(MEI_2B);
  assert.ok(r.ok);
  if (!r.ok) return;
  const d = compararCufeConFactura(r.leido, {
    invoice_kind: "HONORARIOS",
    issue_date: "2026-07-14",
    punto: "100",
    numero_documento: 2,
  });
  assert.deepEqual(Object.keys(d), ["numero_documento"]);
});

test("fecha, tipo y punto distintos se marcan cada uno en su campo", () => {
  const r = leerCufe(MI_CONDADO);
  assert.ok(r.ok);
  if (!r.ok) return;
  const d = compararCufeConFactura(r.leido, {
    invoice_kind: "REEMBOLSO",
    issue_date: "2026-08-02",
    punto: "50",
    numero_documento: 4,
  });
  assert.deepEqual(Object.keys(d).sort(), ["invoice_kind", "issue_date", "punto"]);
});

test("un CUFE del 051 lo emitió el CRM; uno del sandbox no es real", () => {
  const crm = leerCufe(DEL_CRM);
  assert.ok(crm.ok);
  if (crm.ok) {
    const d = compararCufeConFactura(crm.leido, {
      invoice_kind: "HONORARIOS",
      issue_date: "2026-10-01",
      punto: "051",
      numero_documento: 90,
    });
    assert.match(d.cufe ?? "", /punto 051/);
  }
  const sb = leerCufe(DEL_SANDBOX);
  assert.ok(sb.ok);
  if (sb.ok) {
    assert.equal(sb.leido.ambiente, "2");
    const d = compararCufeConFactura(sb.leido, {
      invoice_kind: "HONORARIOS",
      issue_date: "2026-08-21",
      punto: "001",
      numero_documento: 58,
    });
    assert.match(d.cufe ?? "", /pruebas/);
  }
});

test("la referencia externa del asiento: punto y número con ceros", () => {
  assert.equal(referenciaFiscal("100", 2), "100-0000000002");
  assert.equal(referenciaFiscal("50", 603), "050-0000000603");
});

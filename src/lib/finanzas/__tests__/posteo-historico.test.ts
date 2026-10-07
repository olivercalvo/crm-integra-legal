/**
 * 🔒 INTERRUPTOR DEL POSTEO HISTÓRICO (07/10/2026).
 *
 * «Contabilizar el mes» (documentos existentes) y «Contabilizar» / «Reversar»
 * (apertura) escriben en el libro lo anterior a la ventana. Quedan apagados
 * hasta que el contador dé el visto bueno: FINANZAS_POSTEO_HISTORICO_HABILITADO.
 *
 * Fija: apagado por defecto (sin la variable, o con otro valor), el 403 de la
 * ruta, que CADA ruta que escribe tenga el guard ANTES de escribir, y que las
 * pantallas reciban el estado y deshabiliten el botón con el mensaje.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MENSAJE_POSTEO_HISTORICO_APAGADO,
  VARIABLE_POSTEO_HISTORICO,
  posteoHistoricoHabilitado,
  rechazoSiPosteoHistoricoApagado,
} from "../posteo-historico";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("apagado por defecto: sólo `true` lo prende", () => {
  assert.equal(posteoHistoricoHabilitado({}), false);
  for (const v of ["", "1", "yes", "si", "false", "TRUE?"]) assert.equal(posteoHistoricoHabilitado({ [VARIABLE_POSTEO_HISTORICO]: v }), false, v);
  assert.equal(posteoHistoricoHabilitado({ [VARIABLE_POSTEO_HISTORICO]: "true" }), true);
  assert.equal(posteoHistoricoHabilitado({ [VARIABLE_POSTEO_HISTORICO]: " TRUE " }), true);
  assert.equal(MENSAJE_POSTEO_HISTORICO_APAGADO, "Disponible cuando el contador dé el visto bueno.");
});

test("apagado, la ruta responde 403 con el mensaje", async () => {
  const antes = process.env[VARIABLE_POSTEO_HISTORICO];
  delete process.env[VARIABLE_POSTEO_HISTORICO];
  try {
    const r = rechazoSiPosteoHistoricoApagado();
    assert.ok(r);
    assert.equal(r!.status, 403);
    assert.equal((await r!.json()).error, MENSAJE_POSTEO_HISTORICO_APAGADO);
    process.env[VARIABLE_POSTEO_HISTORICO] = "true";
    assert.equal(rechazoSiPosteoHistoricoApagado(), null);
  } finally {
    if (antes === undefined) delete process.env[VARIABLE_POSTEO_HISTORICO];
    else process.env[VARIABLE_POSTEO_HISTORICO] = antes;
  }
});

test("🔴 cada ruta que escribe en el libro pregunta ANTES de escribir", () => {
  const casos: [string, string][] = [
    ["src/app/api/finanzas/asientos/documentos-existentes/route.ts", "contabilizarPlan("],
    ["src/app/api/finanzas/asientos/apertura/route.ts", "contabilizarApertura("],
    ["src/app/api/finanzas/asientos/apertura/reversar/route.ts", "reversarApertura("],
  ];
  for (const [archivo, escritura] of casos) {
    const f = leer(archivo);
    const guard = f.indexOf("rechazoSiPosteoHistoricoApagado()");
    assert.ok(guard > 0, `${archivo} no tiene el interruptor`);
    assert.ok(f.lastIndexOf(escritura) > guard, `${archivo} escribe antes de mirar el interruptor`);
  }
  // Revisar en seco, la plantilla y los Excel NO pasan por el interruptor.
  const apertura = leer("src/app/api/finanzas/asientos/apertura/route.ts");
  assert.ok(apertura.indexOf("previsualizarApertura(") < apertura.indexOf("rechazoSiPosteoHistoricoApagado()"));
  for (const libre of [
    "src/app/api/finanzas/asientos/apertura/plantilla/route.ts",
    "src/app/api/finanzas/asientos/apertura/cuadre/export/route.ts",
  ]) assert.doesNotMatch(leer(libre), /rechazoSiPosteoHistoricoApagado/);
  const docs = leer("src/app/api/finanzas/asientos/documentos-existentes/route.ts");
  const get = docs.slice(docs.indexOf("export const GET"), docs.indexOf("export const POST"));
  assert.doesNotMatch(get, /rechazoSiPosteoHistoricoApagado/, "el Excel en seco se baja con el interruptor apagado");
});

test("las pantallas reciben el estado y deshabilitan el botón con el mensaje", () => {
  for (const [pagina, componente] of [
    ["src/app/finanzas/asientos/documentos-existentes/page.tsx", "src/app/finanzas/asientos/documentos-existentes/_components/contabilizar-mes.tsx"],
    ["src/app/finanzas/asientos/apertura/page.tsx", "src/app/finanzas/asientos/apertura/_components/apertura-panel.tsx"],
    ["src/app/finanzas/asientos/apertura/page.tsx", "src/app/finanzas/asientos/apertura/_components/reversar-apertura.tsx"],
  ]) {
    assert.match(leer(pagina), /posteoHistoricoHabilitado\(\)/);
    const c = leer(componente);
    assert.match(c, /disabled=\{!habilitado/);
    assert.match(c, /MENSAJE_POSTEO_HISTORICO_APAGADO/);
  }
});

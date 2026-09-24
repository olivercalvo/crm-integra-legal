/**
 * LA VENTANA DE 182 HORAS DE UNA NOTA DE CRÉDITO.
 *
 *   npm test
 *
 * Una NC autorizada es un documento fiscal con vida propia y se anula por el
 * MISMO endpoint que una factura (ideati, 22/09), así que lleva el MISMO plazo.
 * Lo que estos tests fijan es lo que se puede equivocar sin que nadie lo note:
 *
 *   · que el plazo se cuente desde la emisión **de la NC**, no de su factura;
 *   · que fuera de plazo NO se ofrezca "otra nota de crédito", porque no existe;
 *   · que la NC que sale de anular una factura no llegue nunca a lo fiscal.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  decidirAccionSobreNotaDeCredito,
  HORAS_PARA_ANULAR,
  type EstadoDeNotaDeCredito,
} from "../decidir-accion-fiscal";

const BASE: EstadoDeNotaDeCredito = {
  status: "emitida",
  feEstado: "authorized",
  dgiCufe: "FE0920000025046169-3-2021-40000020260924000000002400101299027814",
  issueDate: "2026-09-20",
  dgiFechaAutorizacion: "2026-09-20T10:00:00-05:00",
  tieneAsientoPropio: true,
};

const nc = (p: Partial<EstadoDeNotaDeCredito>): EstadoDeNotaDeCredito => ({ ...BASE, ...p });

/** Horas después del arranque del 20/09 en Panamá, que es de donde se cuenta. */
function horasDespuesDeLaEmision(h: number): Date {
  return new Date(Date.parse("2026-09-20T00:00:00-05:00") + h * 3_600_000);
}

test("el plazo son las MISMAS 182 horas que una factura", () => {
  assert.equal(HORAS_PARA_ANULAR, 182);
});

test("dentro de plazo: se anula ante la DGI y se reversa en el libro", () => {
  const r = decidirAccionSobreNotaDeCredito(nc({}), horasDespuesDeLaEmision(100));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
  if (r.accion !== "anular_en_dgi_y_libro") return;
  assert.equal(r.ventana.vencida, false);
  assert.ok(r.mensaje.includes("recupera su saldo"), "el mensaje dice qué pasa con la factura");
});

test("a las 182 horas exactas TODAVÍA se puede: el vencimiento es estrictamente mayor", () => {
  const r = decidirAccionSobreNotaDeCredito(nc({}), horasDespuesDeLaEmision(182));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
});

test("🔴 pasado el plazo NO se ofrece otra nota de crédito: no existe la NC de la NC", () => {
  const r = decidirAccionSobreNotaDeCredito(nc({}), horasDespuesDeLaEmision(183));
  assert.equal(r.accion, "sin_camino_fuera_de_plazo");
  if (r.accion !== "sin_camino_fuera_de_plazo") return;
  assert.equal(r.ventana.vencida, true);
  // Es la diferencia con una factura, y tiene que estar dicha en claro.
  assert.match(r.mensaje, /no se corrige con otra nota de crédito/);
  assert.match(r.mensaje, /contador/);
});

/**
 * 🔴 EL ERROR QUE ESTE TEST EXISTE PARA ATRAPAR.
 *
 * Es tentador contar el plazo desde la factura que la NC corrige: están
 * enlazadas y la factura es "el documento". Pero son dos documentos ante la
 * DGI, con dos autorizaciones y dos plazos. Una NC emitida HOY sobre una
 * factura de hace dos meses tiene sus 182 horas enteras.
 */
test("🔴 el plazo se cuenta desde la emisión de la NC, no desde la de su factura", () => {
  const ncDeHoy = nc({ issueDate: "2026-09-24", dgiFechaAutorizacion: "2026-09-24T09:00:00-05:00" });
  // Dos meses después de una factura de julio, pero una hora después de la NC.
  const r = decidirAccionSobreNotaDeCredito(ncDeHoy, new Date("2026-09-24T10:00:00-05:00"));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
  if (r.accion !== "anular_en_dgi_y_libro") return;
  assert.ok(
    r.ventana.horasTranscurridas < 24,
    `se contaron ${r.ventana.horasTranscurridas} horas: se está midiendo desde la factura`
  );
});

test("sin CUFE es un documento interno: se reversa sólo en el libro", () => {
  const r = decidirAccionSobreNotaDeCredito(
    nc({ feEstado: "no_emitida", dgiCufe: null, dgiFechaAutorizacion: null }),
    horasDespuesDeLaEmision(5000)
  );
  // 🔴 Sin plazo que vencer: hoy TODAS las NC del sistema están así (D1), y un
  //    plazo aplicado acá las volvería irreversibles a los ocho días.
  assert.equal(r.accion, "reversar_solo_en_el_libro");
});

test("anulada ante la DGI pero viva en el libro: queda la reversión", () => {
  const r = decidirAccionSobreNotaDeCredito(nc({ feEstado: "canceled" }), horasDespuesDeLaEmision(10));
  assert.equal(r.accion, "reversar_solo_en_el_libro");
  assert.match(r.mensaje, /sigue viva en el libro/);
});

test("un envío en curso gana sobre todo lo demás", () => {
  const r = decidirAccionSobreNotaDeCredito(nc({ feEstado: "pending" }), horasDespuesDeLaEmision(10));
  assert.equal(r.accion, "esperar_confirmacion");
});

test("🔴 la NC que salió de anular una factura no llega nunca a lo fiscal", () => {
  // Incluso con CUFE y dentro de plazo: el filtro va ANTES, igual que en el RPC.
  const r = decidirAccionSobreNotaDeCredito(
    nc({ tieneAsientoPropio: false }),
    horasDespuesDeLaEmision(10)
  );
  assert.equal(r.accion, "sin_asiento_propio");
  assert.match(r.mensaje, /anular su factura/);
  assert.match(r.mensaje, /factura nueva/, "dice qué hacer en su lugar, no sólo que no se puede");
});

test("una NC ya anulada no ofrece nada", () => {
  const r = decidirAccionSobreNotaDeCredito(nc({ status: "anulada" }), horasDespuesDeLaEmision(10));
  assert.equal(r.accion, "nada_que_hacer");
});

test("autorizada sin CUFE guardado es inconsistente, no se adivina", () => {
  const r = decidirAccionSobreNotaDeCredito(
    nc({ feEstado: "authorized", dgiCufe: null }),
    horasDespuesDeLaEmision(10)
  );
  assert.equal(r.accion, "inconsistente");
});

test("la función no lee el reloj: el mismo estado da lo mismo siempre", () => {
  const cuando = horasDespuesDeLaEmision(100);
  const a = decidirAccionSobreNotaDeCredito(nc({}), cuando);
  const b = decidirAccionSobreNotaDeCredito(nc({}), cuando);
  assert.deepEqual(a, b);
});

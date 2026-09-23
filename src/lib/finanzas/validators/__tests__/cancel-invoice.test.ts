/**
 * El motivo de una anulación: 15 caracteres, y son de la DGI.
 *
 * Ejecución:  npm test
 *
 * El caso que estos tests existen para atrapar no es "alguien escribe corto":
 * es que el número viva en dos lugares y se desincronice. Hasta el 23/09/2026
 * el mínimo era 3 en `validateCancelInput` y en el diálogo, mientras la DGI
 * pedía 15 — y nadie lo notaba porque el envío al PAC todavía no estaba
 * cableado. El día que se cableara, el síntoma habría sido un rechazo del PAC
 * sobre una factura real, con la anulación a medio hacer.
 *
 * Por eso el último test compara el validador contra el CHECK de la `058`:
 * son las dos puntas que tienen que decir lo mismo.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MOTIVO_ANULACION_MIN,
  MOTIVO_ANULACION_MAX,
  validarMotivoDeAnulacion,
  faltanParaElMinimo,
} from "@/lib/finanzas/validators/cancel-invoice";

test("el mínimo es 15 — el número que pidió la DGI, no uno cómodo", () => {
  assert.equal(MOTIVO_ANULACION_MIN, 15);
  assert.equal(MOTIVO_ANULACION_MAX, 1000);
});

test("un motivo real pasa y vuelve trimeado", () => {
  const r = validarMotivoDeAnulacion("  Datos del receptor incorrectos.  ");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.motivo, "Datos del receptor incorrectos.");
});

test("🔴 el borde: 15 justos entran, 14 no", () => {
  assert.ok(validarMotivoDeAnulacion("a".repeat(15)).ok, "15 es inclusivo");
  assert.ok(!validarMotivoDeAnulacion("a".repeat(14)).ok, "14 rebota");
});

test("🔴 los espacios no cuentan: el largo se mide trimeado, como el CHECK", () => {
  // El CHECK de la 058 usa `btrim`. Si el validador no trimeara, veinte
  // espacios pasarían acá y la base los rechazaría — un 500 en vez de un 400,
  // y con un mensaje de Postgres en pantalla.
  const r = validarMotivoDeAnulacion(" ".repeat(20) + "corto");
  assert.ok(!r.ok);
});

test("el mensaje dice cuántos van y que la regla es de la DGI", () => {
  const r = validarMotivoDeAnulacion("monto mal");
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.match(r.mensaje, /15/);
  assert.match(r.mensaje, /van 9/, "decir cuántos van evita contar a mano");
  assert.match(r.mensaje, /DGI/, "que no parezca un capricho del sistema");
});

test("pasarse de 1000 también rebota", () => {
  assert.ok(!validarMotivoDeAnulacion("a".repeat(1001)).ok);
  assert.ok(validarMotivoDeAnulacion("a".repeat(1000)).ok);
});

test("lo que no es texto cuenta como vacío, no revienta", () => {
  for (const basura of [null, undefined, 42, {}, [], true]) {
    const r = validarMotivoDeAnulacion(basura);
    assert.ok(!r.ok, `${JSON.stringify(basura)} no debería pasar`);
  }
});

test("faltanParaElMinimo es lo que muestra el contador del diálogo", () => {
  assert.equal(faltanParaElMinimo(""), 15);
  assert.equal(faltanParaElMinimo("monto mal"), 6);
  assert.equal(faltanParaElMinimo("a".repeat(15)), 0);
  assert.equal(faltanParaElMinimo("a".repeat(900)), 0, "pasado el mínimo, 0");
  assert.equal(faltanParaElMinimo("   x   "), 14, "cuenta trimeado");
});

/**
 * 🔒 LAS DOS PUNTAS DICEN LO MISMO.
 *
 * El validador es el 400 de la ruta; el CHECK de la `058` es la capa que no se
 * puede saltear (el RPC `cancel_invoice_with_reversal` escribe la columna
 * directo). Si alguien cambia uno y no el otro, el síntoma es feo y tardío: o
 * un error de Postgres crudo en pantalla, o un motivo guardado que la DGI
 * después rechaza.
 */
test("🔒 el CHECK de la migración 058 declara el mismo 15..1000", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../../../../../sql/pending/058_motivo_de_anulacion_minimo_15.sql"),
    "utf8"
  );
  const check = sql.slice(sql.indexOf("ADD CONSTRAINT invoices_cancellation_reason_largo"));
  assert.match(
    check,
    new RegExp(`BETWEEN\\s+${MOTIVO_ANULACION_MIN}\\s+AND\\s+${MOTIVO_ANULACION_MAX}`),
    `la 058 no declara BETWEEN ${MOTIVO_ANULACION_MIN} AND ${MOTIVO_ANULACION_MAX}`
  );
  assert.match(check, /btrim\(cancellation_reason\)/, "el CHECK tiene que trimear, como el validador");
});

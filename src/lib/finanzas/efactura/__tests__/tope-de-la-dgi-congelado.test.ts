/**
 * 🔒 LA DGI LIBERA EL MONTO ACREDITADO CUANDO SE ANULA UNA NOTA DE CRÉDITO.
 *
 *   npm test
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN TEST Y NO UNA LÍNEA EN UN .md
 * ─────────────────────────────────────────────────────────────────────────────
 * El 24/09/2026 medimos que la DGI **lleva su propia cuenta** de lo acreditado
 * por documento referenciado: rechaza con `[1717]` cuando la suma de notas de
 * crédito pasa el total de la factura referenciada.
 *
 * Eso abría una pregunta con consecuencias concretas: **¿esa cuenta se
 * descuenta al anular una NC?** Si no se descontara, nuestro tope estaría MAL
 * para la DGI —`credited_total` bajaría y el de ella no— y dejaríamos emitir
 * una nota de crédito que la DGI va a rechazar, sobre un documento real y
 * delante del cliente.
 *
 * No se dedujo: se midió, con esta secuencia en el sandbox (`i_amb = 2`):
 *
 *   1. factura nueva de B/. 10.00           → autorizada
 *   2. NC de B/. 10.00                       → autorizada  (CUFE FE04…)
 *   3. anular ESA NC ante la DGI             → `0600 Evento registrado con éxito`
 *   4. reversarla en el libro                → `credited_total` vuelve a 0
 *   5. OTRA NC de B/. 10.00, misma factura   → ✅ **AUTORIZADA**
 *
 * O sea que la DGI **libera** el monto, y su tope coincide con el nuestro. Por
 * eso `validators/credit-note.ts` NO tiene que contar las NC anuladas.
 *
 * 🔴 Si algún día esta medición cambia, lo que hay que tocar es el TOPE, no
 * este archivo: contar también las NC fiscales anuladas antes de emitir. El
 * test está para que ese cambio sea una decisión y no un descubrimiento.
 *
 * Evidencia completa: `docs/efactura/prueba9c-tope-1717.txt`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const leer = (n: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, n), "utf8")) as Record<string, unknown>;

const ANULACION = leer("tope-dgi-anulacion-nc.json");
const SEGUNDA = leer("tope-dgi-segunda-nc.json");

test("🔒 una NOTA DE CRÉDITO se anula por el mismo endpoint y con el mismo código que una factura", () => {
  // `CreateCancellation` recibe un CUFE sin preguntar de qué documento es
  // (ideati, 22/09). Esto lo confirma con una respuesta real sobre una NC.
  assert.equal(ANULACION._clasificada, "anulada");
  const respuesta = ANULACION.respuesta as { codigo: string; mensaje: string }[];
  assert.ok(Array.isArray(respuesta), "la respuesta de CreateCancellation es un ARRAY");
  assert.equal(respuesta[0].codigo, "0600", "el éxito de la anulación sigue siendo 0600");
});

test("🔴 la DGI LIBERA el monto: la segunda NC por el total AUTORIZÓ", () => {
  assert.equal(
    SEGUNDA._libera_el_monto,
    true,
    "Si esto pasa a false, la DGI dejó de liberar el monto y el tope de " +
      "`validators/credit-note.ts` tiene que contar también las NC fiscales anuladas."
  );
  const r = SEGUNDA.resultado as { ok: boolean; feEstado: string; cufe: string | null };
  assert.equal(r.ok, true);
  assert.equal(r.feEstado, "authorized");
  assert.ok(r.cufe && r.cufe.startsWith("FE04"), "y salió como nota de crédito (tipo 04)");
});

test("⇒ por eso el tope NO cuenta las notas de crédito anuladas", () => {
  // La consecuencia, escrita donde se va a leer. `credited_total` es
  // `SUM(grand_total) WHERE status = 'emitida'` desde la 051: las anuladas ya
  // quedan fuera, y esta medición dice que así está bien.
  assert.equal(SEGUNDA._autorizada, true);
});

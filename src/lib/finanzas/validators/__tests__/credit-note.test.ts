/**
 * La nota de crédito por líneas (Bloque 5): la forma del request y la regla
 * contable contra la factura, las dos puras.
 *
 *   · cantidades acumuladas por línea (D7): lo facturado menos lo ya acreditado;
 *   · tope en balance_due con el mensaje que manda a reversar el cobro (D7);
 *   · el total sale de las líneas con su tasa (ITBMS proporcional exacto), y
 *     una línea de reembolso (tasa 0) suma solo su base;
 *   · precio, tasa y descripción se COPIAN de la factura: la NC no inventa;
 *   · factura anulada o no emitida → 409.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateCreateCreditNoteInput,
  validarLineasDeNotaDeCredito,
  type LineaFacturada,
} from "@/lib/finanzas/validators/credit-note";

const INV = "11111111-1111-1111-1111-111111111111";
const L1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const L2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const L3 = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const FACTURADAS: LineaFacturada[] = [
  { id: L1, line_order: 1, service_id: "s1", description: "Honorarios asesoría", quantity: 10, unit_price: 100, tax_code: "ITBMS_7", tax_rate: 0.07, tax_code_id: "t7" },
  { id: L2, line_order: 2, service_id: "s2", description: "Timbres (reembolso)", quantity: 1, unit_price: 200, tax_code: "EXENTO", tax_rate: 0, tax_code_id: "t0" },
];
// 10 × 100 × 1.07 + 200 = 1,270.00
const FACTURA = { invoice_number: "FAC-HON-000099", status: "emitida", balance_due: 1270 };

test("forma: factura, motivo y al menos una línea con cantidad > 0; la misma línea dos veces se rechaza", () => {
  assert.ok(validateCreateCreditNoteInput({ invoice_id: INV, reason: "Descuento acordado", lineas: [{ invoice_line_id: L1, quantity: 2 }] }).ok);
  const sin = validateCreateCreditNoteInput({ invoice_id: INV, reason: "ok", lineas: [] });
  assert.equal(sin.ok, false);
  assert.ok(sin.errors?.lineas);
  const dup = validateCreateCreditNoteInput({ invoice_id: INV, reason: "ok!", lineas: [{ invoice_line_id: L1, quantity: 1 }, { invoice_line_id: L1, quantity: 1 }] });
  assert.equal(dup.ok, false);
  assert.ok(dup.errors?.["lineas.1.invoice_line_id"]);
  const cero = validateCreateCreditNoteInput({ invoice_id: INV, reason: "ok!", lineas: [{ invoice_line_id: L1, quantity: 0 }] });
  assert.ok(cero.errors?.["lineas.0.quantity"]);
  assert.ok(validateCreateCreditNoteInput({ invoice_id: "x", reason: "a", lineas: [] }).errors?.invoice_id);
});

test("el caso de Josuarth: factura de 1,000 (+ITBMS), NC de 2 unidades → 214.00 con su ITBMS proporcional exacto", () => {
  const r = validarLineasDeNotaDeCredito({ factura: FACTURA, facturadas: FACTURADAS, acreditadoPorLinea: new Map(), pedido: [{ invoice_line_id: L1, quantity: 2 }] });
  assert.ok(r.ok);
  assert.equal(r.total, 214);
  assert.equal(r.lineas[0].unit_price, 100, "el precio se copia de la factura");
  assert.equal(r.lineas[0].tax_rate, 0.07);
  assert.equal(r.lineas[0].line_total, 214);
});

test("una línea de reembolso (exenta) acredita solo su base", () => {
  const r = validarLineasDeNotaDeCredito({ factura: FACTURA, facturadas: FACTURADAS, acreditadoPorLinea: new Map(), pedido: [{ invoice_line_id: L2, quantity: 1 }] });
  assert.ok(r.ok);
  assert.equal(r.total, 200);
});

test("🔒 D7: cantidades ACUMULADAS por línea — lo ya acreditado por NC anteriores descuenta lo disponible", () => {
  const ya = new Map([[L1, 8]]);
  const ok = validarLineasDeNotaDeCredito({ factura: FACTURA, facturadas: FACTURADAS, acreditadoPorLinea: ya, pedido: [{ invoice_line_id: L1, quantity: 2 }] });
  assert.ok(ok.ok, "quedan 2 disponibles");
  const mal = validarLineasDeNotaDeCredito({ factura: FACTURA, facturadas: FACTURADAS, acreditadoPorLinea: ya, pedido: [{ invoice_line_id: L1, quantity: 3 }] });
  assert.equal(mal.ok, false);
  if (!mal.ok) {
    assert.equal(mal.status, 400);
    assert.match(String(mal.fieldErrors?.["lineas.0.quantity"]), /2 disponible/);
  }
  const nada = validarLineasDeNotaDeCredito({ factura: FACTURA, facturadas: FACTURADAS, acreditadoPorLinea: new Map([[L1, 10]]), pedido: [{ invoice_line_id: L1, quantity: 1 }] });
  assert.equal(nada.ok, false);
  if (!nada.ok) assert.match(String(nada.fieldErrors?.["lineas.0.quantity"]), /acreditada por completo/);
});

test("🔒 D7: la NC no supera balance_due — lo cobrado no se acredita, se reversa el cobro primero", () => {
  // Factura cobrada en 1,000: saldo 270. Una NC de 3 unidades (321.00) se pasa.
  const cobrada = { ...FACTURA, balance_due: 270 };
  const r = validarLineasDeNotaDeCredito({ factura: cobrada, facturadas: FACTURADAS, acreditadoPorLinea: new Map(), pedido: [{ invoice_line_id: L1, quantity: 3 }] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 409);
    assert.match(r.mensaje, /supera el saldo pendiente/);
    assert.match(r.mensaje, /B\/\. 321\.00/);
    assert.match(r.mensaje, /B\/\. 270\.00/);
    assert.match(r.mensaje, /reverse el cobro primero/);
  }
  const justo = validarLineasDeNotaDeCredito({ factura: cobrada, facturadas: FACTURADAS, acreditadoPorLinea: new Map(), pedido: [{ invoice_line_id: L1, quantity: 2 }] });
  assert.ok(justo.ok, "214 ≤ 270");
});

test("una línea que no es de la factura, o una factura anulada / no emitida, se rechazan", () => {
  const ajena = validarLineasDeNotaDeCredito({ factura: FACTURA, facturadas: FACTURADAS, acreditadoPorLinea: new Map(), pedido: [{ invoice_line_id: L3, quantity: 1 }] });
  assert.equal(ajena.ok, false);
  if (!ajena.ok) assert.ok(ajena.fieldErrors?.["lineas.0.invoice_line_id"]);
  const anulada = validarLineasDeNotaDeCredito({ factura: { ...FACTURA, status: "anulada" }, facturadas: FACTURADAS, acreditadoPorLinea: new Map(), pedido: [{ invoice_line_id: L1, quantity: 1 }] });
  assert.equal(anulada.ok, false);
  if (!anulada.ok) assert.equal(anulada.status, 409);
  const borrador = validarLineasDeNotaDeCredito({ factura: { ...FACTURA, status: "borrador" }, facturadas: FACTURADAS, acreditadoPorLinea: new Map(), pedido: [{ invoice_line_id: L1, quantity: 1 }] });
  assert.equal(borrador.ok, false);
});

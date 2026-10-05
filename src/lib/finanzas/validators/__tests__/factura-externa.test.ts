/**
 * «Registrar factura emitida fuera» (092): el pedido.
 *
 *   npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { totalesDeLineas, validarPedidoDeFacturaExterna } from "../factura-externa";

const SVC = "11111111-1111-4111-8111-111111111111";
const TAX = "22222222-2222-4222-8222-222222222222";
const CLI = "33333333-3333-4333-8333-333333333333";
const MEI_1C = "FE0120000025046169-3-2021-4000002026071400000000021000112431062839";

function pedido(over: Record<string, unknown> = {}) {
  return {
    invoice_kind: "HONORARIOS",
    client_id: CLI,
    case_id: null,
    issue_date: "2026-07-14",
    accounting_date: "2026-07-14",
    due_date: "2026-08-13",
    notes: null,
    cufe: MEI_1C,
    punto: "100",
    numero_documento: "2",
    base_autorizada: "150.00",
    itbms_autorizado: "10.50",
    lines: [
      {
        service_id: SVC,
        description: "Honorarios profesionales",
        quantity: 1,
        unit_price: 150,
        tax_code_id: TAX,
        tax_code: "ITBMS_7",
        tax_rate: 0.07,
      },
    ],
    ...over,
  };
}

test("MEI Tower 1C: 150 + 10.50 con su CUFE pasa", () => {
  const r = validarPedidoDeFacturaExterna(pedido());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  if (!r.ok) return;
  assert.equal(r.data.punto, "100");
  assert.equal(r.data.numero_documento, 2);
  assert.equal(r.data.base_autorizada, 150);
  assert.equal(r.data.itbms_autorizado, 10.5);
});

test("🔴 el monto que no coincide con el documento autorizado no pasa", () => {
  const r = validarPedidoDeFacturaExterna(pedido({ base_autorizada: "160.00" }));
  assert.equal(r.ok, false);
  assert.match(r.errors?.base_autorizada ?? "", /150\.00.*160\.00/);
  const r2 = validarPedidoDeFacturaExterna(pedido({ itbms_autorizado: "0" }));
  assert.equal(r2.ok, false);
  assert.ok(r2.errors?.itbms_autorizado);
});

test("🔴 la fecha que no coincide con el CUFE no pasa", () => {
  const r = validarPedidoDeFacturaExterna(
    pedido({ issue_date: "2026-07-15", accounting_date: "2026-07-15", due_date: "2026-08-15" })
  );
  assert.equal(r.ok, false);
  assert.match(r.errors?.issue_date ?? "", /14\/07\/2026/);
});

test("cada línea necesita un servicio del catálogo", () => {
  const r = validarPedidoDeFacturaExterna(
    pedido({
      lines: [
        {
          service_id: null,
          description: "Honorarios",
          quantity: 1,
          unit_price: 150,
          tax_code_id: TAX,
          tax_code: "ITBMS_7",
          tax_rate: 0.07,
        },
      ],
    })
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors?.["lines.0.service"]);
});

test("una nota de débito no entra por acá", () => {
  const r = validarPedidoDeFacturaExterna(pedido({ invoice_kind: "NOTA_DEBITO" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors?.invoice_kind);
});

test("los totales redondean al final, como la base", () => {
  // 3 × 33.335 = 100.005 → 100.01; ITBMS 7.00035 → 7.00
  const t = totalesDeLineas([{ quantity: 3, unit_price: 33.335, tax_rate: 0.07 }]);
  assert.deepEqual(t, { base: 100.01, itbms: 7, total: 107.01 });
});

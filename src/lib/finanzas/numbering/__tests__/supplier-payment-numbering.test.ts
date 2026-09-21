/**
 * El número del comprobante de egreso: `CE-` + seis dígitos, el MISMO formato
 * que el backfill de la 048 (`'CE-' || lpad(n, 6, '0')`). El prefijo es
 * propuesta (Oliver le pregunta a Josuarth): si cambia, cambia acá, en la 048 y
 * en este test, y nada más.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatSupplierPaymentNumber,
  allocateSupplierPaymentNumber,
  SUPPLIER_PAYMENT_SEQUENCE_TYPE,
} from "@/lib/finanzas/numbering/supplier-payment-numbering";

test("CE- + seis dígitos", () => {
  assert.equal(formatSupplierPaymentNumber(1), "CE-000001");
  assert.equal(formatSupplierPaymentNumber(12), "CE-000012");
  assert.match(formatSupplierPaymentNumber(3), /^CE-\d{6}$/, "la regex de la 048");
  assert.throws(() => formatSupplierPaymentNumber(0), /inválido/);
});

test("allocate consume la secuencia 'supplier_payment'", async () => {
  const llamadas: unknown[] = [];
  const db = { rpc: async (fn: string, args: unknown) => { llamadas.push([fn, args]); return { data: 7, error: null }; } };
  assert.equal(await allocateSupplierPaymentNumber(db as never, "t"), "CE-000007");
  assert.deepEqual(llamadas, [["get_next_sequence_number", { p_tenant_id: "t", p_sequence_type: SUPPLIER_PAYMENT_SEQUENCE_TYPE }]]);
  assert.equal(SUPPLIER_PAYMENT_SEQUENCE_TYPE, "supplier_payment");
});

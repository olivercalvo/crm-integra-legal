/**
 * El número del pago a proveedor: `PA-` + seis dígitos desde E3 (01/10/2026,
 * plan punto 2). Antes era `CE-` (la 048 y su backfill); los `CE-` ya emitidos
 * en staging se quedan. Si el prefijo cambia, cambia acá y en
 * `supplier-payment-numbering.ts`, y nada más.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatSupplierPaymentNumber,
  allocateSupplierPaymentNumber,
  SUPPLIER_PAYMENT_SEQUENCE_TYPE,
} from "@/lib/finanzas/numbering/supplier-payment-numbering";

test("PA- + seis dígitos", () => {
  assert.equal(formatSupplierPaymentNumber(1), "PA-000001");
  assert.equal(formatSupplierPaymentNumber(12), "PA-000012");
  assert.match(formatSupplierPaymentNumber(3), /^PA-\d{6}$/, "seis dígitos, como la 048");
  assert.throws(() => formatSupplierPaymentNumber(0), /inválido/);
});

test("allocate consume la secuencia 'supplier_payment'", async () => {
  const llamadas: unknown[] = [];
  const db = { rpc: async (fn: string, args: unknown) => { llamadas.push([fn, args]); return { data: 7, error: null }; } };
  assert.equal(await allocateSupplierPaymentNumber(db as never, "t"), "PA-000007");
  assert.deepEqual(llamadas, [["get_next_sequence_number", { p_tenant_id: "t", p_sequence_type: SUPPLIER_PAYMENT_SEQUENCE_TYPE }]]);
  assert.equal(SUPPLIER_PAYMENT_SEQUENCE_TYPE, "supplier_payment");
});

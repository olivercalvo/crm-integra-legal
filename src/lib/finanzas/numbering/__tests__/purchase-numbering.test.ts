/**
 * El número de compra: `FAC-CO-` + seis dígitos, el formato que exige el CHECK
 * de la 071 (`^FAC-CO-[0-9]{6,}$`). Compras y gastos de trámite comparten la
 * secuencia `purchase` (P-2b).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatPurchaseNumber,
  allocatePurchaseNumber,
  PURCHASE_SEQUENCE_TYPE,
} from "@/lib/finanzas/numbering/purchase-numbering";

test("FAC-CO- + seis dígitos, el formato del CHECK de la 071", () => {
  assert.equal(formatPurchaseNumber(1), "FAC-CO-000001");
  assert.equal(formatPurchaseNumber(1268), "FAC-CO-001268");
  assert.match(formatPurchaseNumber(3), /^FAC-CO-[0-9]{6,}$/);
  assert.equal(formatPurchaseNumber(1000000), "FAC-CO-1000000");
});

test("un número 0, negativo o no entero no existe", () => {
  assert.throws(() => formatPurchaseNumber(0), /inválido/);
  assert.throws(() => formatPurchaseNumber(-2), /inválido/);
  assert.throws(() => formatPurchaseNumber(2.5), /inválido/);
});

test("allocate consume la secuencia 'purchase' del tenant", async () => {
  const llamadas: unknown[] = [];
  const db = {
    rpc: async (fn: string, args: unknown) => {
      llamadas.push([fn, args]);
      return { data: 9, error: null };
    },
  };
  assert.equal(await allocatePurchaseNumber(db as never, "t-1"), "FAC-CO-000009");
  assert.deepEqual(llamadas, [
    ["get_next_sequence_number", { p_tenant_id: "t-1", p_sequence_type: "purchase" }],
  ]);
  assert.equal(PURCHASE_SEQUENCE_TYPE, "purchase");
});

test("allocate: error de la base → error con su mensaje", async () => {
  const db = { rpc: async () => ({ data: null, error: { message: "Secuencia purchase no existe" } }) };
  await assert.rejects(() => allocatePurchaseNumber(db as never, "t"), /Secuencia purchase no existe/);
});

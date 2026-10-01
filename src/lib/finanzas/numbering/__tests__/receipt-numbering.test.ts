/**
 * El número de recibo: `CO-` + seis dígitos desde E3 (01/10/2026, P-2c). El
 * backfill de la 047 sigue escribiendo `REC-` para los cobros viejos de
 * producción, que se quedan así: el formato de seis dígitos es el mismo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatReceiptNumber,
  allocateReceiptNumber,
  previewNextReceiptNumber,
  RECEIPT_SEQUENCE_TYPE,
} from "@/lib/finanzas/numbering/receipt-numbering";

test("CO- + seis dígitos, como las facturas", () => {
  assert.equal(formatReceiptNumber(1), "CO-000001");
  assert.equal(formatReceiptNumber(12), "CO-000012");
  assert.equal(formatReceiptNumber(1268), "CO-001268");
  assert.equal(formatReceiptNumber(999999), "CO-999999");
});

test("más de seis dígitos no se trunca", () => {
  assert.equal(formatReceiptNumber(1000000), "CO-1000000");
});

test("seis dígitos, como el backfill de la 047 (que sigue con REC- para lo viejo)", () => {
  assert.match(formatReceiptNumber(3), /^CO-\d{6}$/);
});

test("un recibo 0, negativo o no entero no existe", () => {
  assert.throws(() => formatReceiptNumber(0), /inválido/);
  assert.throws(() => formatReceiptNumber(-1), /inválido/);
  assert.throws(() => formatReceiptNumber(1.5), /inválido/);
  assert.throws(() => formatReceiptNumber(NaN), /inválido/);
});

test("allocate consume la secuencia 'payment' del tenant y formatea", async () => {
  const llamadas: unknown[] = [];
  const db = {
    rpc: async (fn: string, args: unknown) => {
      llamadas.push([fn, args]);
      return { data: 7, error: null };
    },
  };
  const n = await allocateReceiptNumber(db as never, "tenant-1");
  assert.equal(n, "CO-000007");
  assert.deepEqual(llamadas, [
    ["get_next_sequence_number", { p_tenant_id: "tenant-1", p_sequence_type: RECEIPT_SEQUENCE_TYPE }],
  ]);
  assert.equal(RECEIPT_SEQUENCE_TYPE, "payment");
});

test("allocate: la secuencia no existe → error con el mensaje de la base", async () => {
  const db = {
    rpc: async () => ({ data: null, error: { message: "Secuencia payment no existe" } }),
  };
  await assert.rejects(() => allocateReceiptNumber(db as never, "t"), /Secuencia payment no existe/);
});

test("preview devuelve last_number + 1 sin tocar la secuencia", async () => {
  let rpcs = 0;
  const db = {
    rpc: async () => {
      rpcs++;
      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { last_number: 3 }, error: null }) }),
        }),
      }),
    }),
  };
  assert.equal(await previewNextReceiptNumber(db as never, "t"), "CO-000004");
  assert.equal(rpcs, 0);
});

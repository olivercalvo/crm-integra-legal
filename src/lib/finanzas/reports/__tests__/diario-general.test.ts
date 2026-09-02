/**
 * Tests del Diario General.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiarioGeneral,
  type AsientoCrudo,
} from "@/lib/finanzas/reports/diario-general";

const EPSILON = 0.005;

function asiento(over: Partial<AsientoCrudo> = {}): AsientoCrudo {
  return {
    entry_id: "e1",
    entry_number: 1,
    transaction_date: "2026-04-05",
    description: "Factura FAC-HON-000001 — FERRETERÍA VALLARINO, S.A.",
    source_type: "factura",
    source_id: "src-1",
    documento: "FAC-HON-000001",
    lineas: [
      { line_order: 0, account_code: "100004", account_name: "Cuentas por Cobrar", line_description: "FERRETERÍA", debit: 1070, credit: 0 },
      { line_order: 1, account_code: "400001", account_name: "Derecho Corporativo", line_description: "Honorarios", debit: 0, credit: 1000 },
      { line_order: 2, account_code: "200003", account_name: "ITBMS por Pagar", line_description: "ITBMS 7%", debit: 0, credit: 70 },
    ],
    ...over,
  };
}

test("el tipo de transacción usa el MISMO vocabulario que el Libro Mayor", () => {
  const d = buildDiarioGeneral([
    asiento({ source_type: "factura" }),
    asiento({ entry_id: "e2", entry_number: 2, source_type: "pago" }),
    asiento({ entry_id: "e3", entry_number: 3, source_type: "manual", source_id: null, documento: null }),
    asiento({ entry_id: "e4", entry_number: 4, source_type: "gasto" }),
  ]);

  assert.deepEqual(
    d.asientos.map((a) => a.tipoTransaccion),
    ["Factura", "Pago", "Asiento de diario", "Gasto / compra"]
  );
});

test("cada asiento cuadra por separado", () => {
  const d = buildDiarioGeneral([asiento()]);
  const a = d.asientos[0];
  assert.ok(Math.abs(a.totalDebito - 1070) < EPSILON);
  assert.ok(Math.abs(a.totalCredito - 1070) < EPSILON);
  assert.ok(a.cuadra);
  assert.deepEqual(d.descuadrados, []);
});

test("un asiento descuadrado se DENUNCIA, no se silencia", () => {
  // No debería poder existir: el RPC lo rechaza y los triggers impiden editarlo.
  // Si aparece, es que algo escribió en el ledger sin pasar por el motor.
  const roto = asiento({
    entry_number: 9,
    lineas: [
      { line_order: 0, account_code: "100004", account_name: "CxC", line_description: null, debit: 1070, credit: 0 },
      { line_order: 1, account_code: "400001", account_name: "Ingreso", line_description: null, debit: 0, credit: 900 },
    ],
  });
  const d = buildDiarioGeneral([roto]);

  assert.ok(!d.asientos[0].cuadra);
  assert.deepEqual(d.descuadrados, [9]);
});

test("las líneas salen en el orden en que se escribió el asiento", () => {
  const desordenado = asiento({
    lineas: [
      { line_order: 2, account_code: "200003", account_name: "ITBMS", line_description: null, debit: 0, credit: 70 },
      { line_order: 0, account_code: "100004", account_name: "CxC", line_description: null, debit: 1070, credit: 0 },
      { line_order: 1, account_code: "400001", account_name: "Ingreso", line_description: null, debit: 0, credit: 1000 },
    ],
  });
  const d = buildDiarioGeneral([desordenado]);
  assert.deepEqual(
    d.asientos[0].lineas.map((l) => l.code),
    ["100004", "400001", "200003"]
  );
});

test("una línea sin glosa propia hereda la descripción del asiento", () => {
  // Un renglón sin texto no le dice nada a quien audita.
  const d = buildDiarioGeneral([
    asiento({
      description: "Cobro de la factura FAC-HON-000001",
      lineas: [
        { line_order: 0, account_code: "100001", account_name: "Banco", line_description: null, debit: 1070, credit: 0 },
        { line_order: 1, account_code: "100004", account_name: "CxC", line_description: "  ", debit: 0, credit: 1070 },
      ],
    }),
  ]);
  assert.equal(d.asientos[0].lineas[0].descripcion, "Cobro de la factura FAC-HON-000001");
  assert.equal(d.asientos[0].lineas[1].descripcion, "Cobro de la factura FAC-HON-000001");
});

test("los totales del diario suman todos los asientos y todas las líneas", () => {
  const d = buildDiarioGeneral([
    asiento(),
    asiento({ entry_id: "e2", entry_number: 2 }),
  ]);
  assert.equal(d.asientos.length, 2);
  assert.equal(d.cantidadLineas, 6);
  assert.ok(Math.abs(d.totalDebito - 2140) < EPSILON);
  assert.ok(Math.abs(d.totalCredito - 2140) < EPSILON);
});

test("un asiento de diario no tiene documento y por eso no se enlaza", () => {
  const d = buildDiarioGeneral([
    asiento({ source_type: "manual", source_id: null, documento: null }),
  ]);
  assert.equal(d.asientos[0].sourceId, null);
  assert.equal(d.asientos[0].documento, "");
  assert.equal(d.asientos[0].tipoTransaccion, "Asiento de diario");
});

test("ledger VACÍO: el diario no revienta, devuelve la estructura en cero", () => {
  const d = buildDiarioGeneral([]);
  assert.deepEqual(d.asientos, []);
  assert.equal(d.cantidadLineas, 0);
  assert.equal(d.totalDebito, 0);
  assert.equal(d.totalCredito, 0);
  assert.deepEqual(d.descuadrados, []);
});

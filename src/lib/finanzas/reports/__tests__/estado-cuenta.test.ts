/**
 * Tests del Estado de Cuenta por tercero.
 *
 * Lo que se prueba es lo que un contador verifica a mano: que el saldo corrido
 * arrastre bien, que el saldo final sea saldo inicial + débitos − créditos, y
 * que un tercero sin movimientos no invente un cero engañoso.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEstadoCuenta,
  cuadra,
  type MovimientoTercero,
} from "@/lib/finanzas/reports/estado-cuenta";

const EPSILON = 0.005;

function mov(over: Partial<MovimientoTercero> = {}): MovimientoTercero {
  return {
    fecha: "2026-07-01",
    tipo: "Factura",
    documento: "FAC-HON-000001",
    descripcion: "Honorarios",
    debito: 0,
    credito: 0,
    documentoId: "f1",
    sourceType: "factura",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// EL SALDO CORRIDO
// ---------------------------------------------------------------------------

test("el saldo corrido arrastra movimiento a movimiento", () => {
  const ec = buildEstadoCuenta("Cliente A", "c1", [
    mov({ fecha: "2026-06-01", debito: 1000 }),
    mov({ fecha: "2026-06-15", tipo: "Cobro", credito: 400 }),
    mov({ fecha: "2026-07-01", debito: 250 }),
  ]);

  assert.deepEqual(
    ec.filas.map((f) => f.saldo),
    [1000, 600, 850]
  );
  assert.equal(ec.saldoFinal, 850);
});

test("saldo final = saldo inicial + débitos − créditos", () => {
  const ec = buildEstadoCuenta("Cliente A", "c1", [
    mov({ debito: 605 }),
    mov({ debito: 2140 }),
    mov({ tipo: "Cobro", credito: 150 }),
  ]);

  assert.equal(ec.totalDebito, 2745);
  assert.equal(ec.totalCredito, 150);
  assert.equal(ec.saldoFinal, 2595);
  assert.ok(cuadra(ec), "el invariante del reporte se cumple");
});

test("un saldo inicial distinto de cero se respeta y arrastra", () => {
  // Hoy la pantalla siempre pasa 0 porque la apertura no está repartida por
  // tercero. El día que exista ese detalle, el builder ya lo soporta.
  const ec = buildEstadoCuenta("Cliente A", "c1", [mov({ debito: 100 })], 500);
  assert.equal(ec.saldoInicial, 500);
  assert.equal(ec.filas[0].saldo, 600);
  assert.equal(ec.saldoFinal, 600);
  assert.ok(cuadra(ec));
});

test("un cobro que cancela toda la deuda deja el saldo en cero exacto", () => {
  const ec = buildEstadoCuenta("Cliente A", "c1", [
    mov({ debito: 1834.53 }),
    mov({ tipo: "Cobro", credito: 1834.53 }),
  ]);
  assert.equal(ec.saldoFinal, 0, "sin residuo de punto flotante");
  assert.ok(cuadra(ec));
});

test("los centavos se redondean a dos decimales en cada paso, no al final", () => {
  const ec = buildEstadoCuenta("Cliente A", "c1", [
    mov({ debito: 0.1 }),
    mov({ debito: 0.2 }),
  ]);
  assert.equal(ec.filas[1].saldo, 0.3, "0.1 + 0.2 no puede salir 0.30000000000000004");
  assert.ok(Math.abs(ec.totalDebito - 0.3) < EPSILON);
});

// ---------------------------------------------------------------------------
// SIN MOVIMIENTOS
// ---------------------------------------------------------------------------

test("un tercero sin movimientos da una estructura vacía, no un error", () => {
  const ec = buildEstadoCuenta("Cliente sin actividad", "c9", []);
  assert.deepEqual(ec.filas, []);
  assert.equal(ec.saldoInicial, 0);
  assert.equal(ec.totalDebito, 0);
  assert.equal(ec.totalCredito, 0);
  assert.equal(ec.saldoFinal, 0);
  assert.ok(cuadra(ec));
});

// ---------------------------------------------------------------------------
// EL ENLACE AL DOCUMENTO
// ---------------------------------------------------------------------------

test("cada fila conserva el id y el tipo de su documento para poder abrirlo", () => {
  const ec = buildEstadoCuenta("Cliente A", "c1", [
    mov({ documentoId: "f1", sourceType: "factura", debito: 100 }),
    mov({ documentoId: "p1", sourceType: "pago", tipo: "Cobro", credito: 100 }),
  ]);
  assert.equal(ec.filas[0].sourceType, "factura");
  assert.equal(ec.filas[1].documentoId, "p1");
});

test("un movimiento sin documento asociado no rompe el reporte", () => {
  // Ajustes manuales del ledger: existen en el mayor y no tienen documento.
  const ec = buildEstadoCuenta("Cliente A", "c1", [
    mov({ documentoId: null, sourceType: null, tipo: "Ajuste", debito: 50 }),
  ]);
  assert.equal(ec.filas[0].documentoId, null);
  assert.equal(ec.saldoFinal, 50);
});

// ---------------------------------------------------------------------------
// PROVEEDOR: sin id de tercero
// ---------------------------------------------------------------------------

test("un proveedor viaja sin terceroId — todavía no es una entidad del sistema", () => {
  const ec = buildEstadoCuenta("INMOBILIARIA COSTA DEL ESTE, S.A.", null, [
    mov({ tipo: "Gasto", documento: "Alquiler julio", sourceType: "gasto", debito: 1850 }),
  ]);
  assert.equal(ec.terceroId, null);
  assert.equal(ec.saldoFinal, 1850);
});

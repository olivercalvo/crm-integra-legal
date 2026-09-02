/**
 * Tests de la antigüedad de saldos.
 *
 * Lo importante acá es el reparto en tramos —que es lo que un contador mira
 * primero— y que la diferencia con la cuenta control se declare en vez de
 * esconderse.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAntiguedad,
  tramoDe,
  TRAMOS,
  type DocumentoPendiente,
} from "@/lib/finanzas/reports/antiguedad";

const EPSILON = 0.005;

function doc(over: Partial<DocumentoPendiente> = {}): DocumentoPendiente {
  return {
    id: "d1",
    numero: "FAC-HON-000001",
    tercero: "FERRETERÍA VALLARINO, S.A.",
    terceroId: "c1",
    fechaReferencia: "2026-07-01",
    diasVencido: 10,
    saldo: 1000,
    sourceType: "factura",
    ...over,
  };
}

const CONTROL_VACIO = {
  saldoCuentaControl: 0,
  saldoApertura: 0,
  cuentaCodigo: "100004",
  cuentaNombre: "Cuentas por Cobrar Clientes",
};

// ---------------------------------------------------------------------------
// LOS TRAMOS
// ---------------------------------------------------------------------------

test("cada documento cae en el tramo que le corresponde", () => {
  // Los bordes se toman como se leen los términos de pago: el día 1 de atraso ya
  // es "1 a 30", el 31 es "31 a 60", el 91 es "más de 91".
  assert.equal(tramoDe(-5), "corriente", "todavía no vence");
  assert.equal(tramoDe(0), "corriente", "vence hoy");
  assert.equal(tramoDe(1), "d1_30");
  assert.equal(tramoDe(30), "d1_30");
  assert.equal(tramoDe(31), "d31_60");
  assert.equal(tramoDe(60), "d31_60");
  assert.equal(tramoDe(61), "d61_90");
  assert.equal(tramoDe(90), "d61_90");
  assert.equal(tramoDe(91), "d91_mas");
  assert.equal(tramoDe(500), "d91_mas");
});

test("un documento de cada tramo cae donde debe y suma a su columna", () => {
  const r = buildAntiguedad(
    [
      doc({ id: "a", numero: "F-1", diasVencido: -3, saldo: 100 }),
      doc({ id: "b", numero: "F-2", diasVencido: 15, saldo: 200 }),
      doc({ id: "c", numero: "F-3", diasVencido: 45, saldo: 300 }),
      doc({ id: "d", numero: "F-4", diasVencido: 75, saldo: 400 }),
      doc({ id: "e", numero: "F-5", diasVencido: 120, saldo: 500 }),
    ],
    CONTROL_VACIO
  );

  const t = r.totalesPorTramo;
  assert.equal(t.corriente, 100);
  assert.equal(t.d1_30, 200);
  assert.equal(t.d31_60, 300);
  assert.equal(t.d61_90, 400);
  assert.equal(t.d91_mas, 500);
  assert.equal(r.total, 1500);
  assert.deepEqual(r.tramosVacios, [], "con uno de cada tramo, ninguno queda vacío");
});

// ---------------------------------------------------------------------------
// AGRUPACIÓN Y DETALLE POR DOCUMENTO — lo que pidió Josuarth
// ---------------------------------------------------------------------------

test("agrupa por tercero SIN perder el detalle de cada documento", () => {
  const r = buildAntiguedad(
    [
      doc({ id: "a", numero: "F-1", terceroId: "c1", tercero: "Cliente A", saldo: 100, diasVencido: 10 }),
      doc({ id: "b", numero: "F-2", terceroId: "c1", tercero: "Cliente A", saldo: 250, diasVencido: 70 }),
      doc({ id: "c", numero: "F-3", terceroId: "c2", tercero: "Cliente B", saldo: 900, diasVencido: 5 }),
    ],
    CONTROL_VACIO
  );

  assert.equal(r.filas.length, 2, "dos terceros");
  // Ordenados por saldo descendente: al contador le interesa quién debe más.
  assert.equal(r.filas[0].tercero, "Cliente B");
  assert.equal(r.filas[1].tercero, "Cliente A");

  const a = r.filas[1];
  assert.equal(a.total, 350);
  assert.equal(a.documentos.length, 2, "el detalle NO se pierde");
  assert.equal(a.porTramo.d1_30, 100);
  assert.equal(a.porTramo.d61_90, 250);
});

test("dentro de cada tercero, los documentos van del más vencido al menos", () => {
  const r = buildAntiguedad(
    [
      doc({ id: "a", numero: "F-nuevo", diasVencido: 5 }),
      doc({ id: "b", numero: "F-viejo", diasVencido: 200 }),
      doc({ id: "c", numero: "F-medio", diasVencido: 60 }),
    ],
    CONTROL_VACIO
  );
  assert.deepEqual(
    r.filas[0].documentos.map((d) => d.numero),
    ["F-viejo", "F-medio", "F-nuevo"]
  );
});

test("el total de cada tercero es la suma de sus tramos, y el global de los terceros", () => {
  const r = buildAntiguedad(
    [
      doc({ id: "a", terceroId: "c1", saldo: 100, diasVencido: 10 }),
      doc({ id: "b", terceroId: "c1", saldo: 200, diasVencido: 100 }),
      doc({ id: "c", terceroId: "c2", saldo: 50, diasVencido: 40 }),
    ],
    CONTROL_VACIO
  );

  for (const f of r.filas) {
    const suma = TRAMOS.reduce((s, t) => s + f.porTramo[t], 0);
    assert.ok(Math.abs(suma - f.total) < EPSILON, `${f.tercero}: ${suma} ≠ ${f.total}`);
  }
  assert.equal(r.total, 350);
});

// ---------------------------------------------------------------------------
// LA REGLA DE LA GUÍA: cuadrar con la cuenta control
// ---------------------------------------------------------------------------

test("cuando el auxiliar cuadra con su cuenta control, lo dice", () => {
  const r = buildAntiguedad([doc({ saldo: 3145 })], {
    ...CONTROL_VACIO,
    saldoCuentaControl: 3145,
    saldoApertura: 0,
  });
  assert.ok(r.control.cuadra);
  assert.equal(r.control.diferencia, 0);
});

test("cuando NO cuadra, la diferencia se calcula y se expone — no se esconde", () => {
  // El caso real de staging: el auxiliar suma 3.145,00 y la cuenta control
  // 194.842,55 porque la apertura vino sin detalle de documentos.
  const r = buildAntiguedad([doc({ saldo: 3145 })], {
    ...CONTROL_VACIO,
    saldoCuentaControl: 194842.55,
    saldoApertura: 191947.55,
  });

  assert.ok(!r.control.cuadra);
  assert.equal(r.control.totalAuxiliar, 3145);
  assert.equal(r.control.saldoCuentaControl, 194842.55);
  assert.ok(Math.abs(r.control.diferencia - 191697.55) < EPSILON);
  // La apertura viaja para que la pantalla pueda explicar de dónde sale.
  assert.equal(r.control.saldoApertura, 191947.55);
});

// ---------------------------------------------------------------------------
// SIN DATOS
// ---------------------------------------------------------------------------

test("sin documentos: la estructura queda en cero y todos los tramos vacíos", () => {
  const r = buildAntiguedad([], CONTROL_VACIO);
  assert.deepEqual(r.filas, []);
  assert.equal(r.total, 0);
  assert.equal(r.tramosVacios.length, TRAMOS.length);
  assert.ok(r.control.cuadra, "0 contra 0 cuadra");
});

test("un proveedor sin id se agrupa por su nombre — no es una entidad todavía", () => {
  const r = buildAntiguedad(
    [
      doc({ id: "g1", terceroId: null, tercero: "INMOBILIARIA COSTA DEL ESTE, S.A.", saldo: 1850, sourceType: "gasto" }),
      doc({ id: "g2", terceroId: null, tercero: "INMOBILIARIA COSTA DEL ESTE, S.A.", saldo: 150, sourceType: "gasto" }),
      doc({ id: "g3", terceroId: null, tercero: "ESTACIÓN DELTA VÍA ESPAÑA", saldo: 246.4, sourceType: "gasto" }),
    ],
    CONTROL_VACIO
  );
  assert.equal(r.filas.length, 2, "se agrupan por el texto del nombre");
  assert.equal(r.filas[0].total, 2000);
});

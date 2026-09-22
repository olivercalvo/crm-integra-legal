/**
 * EL TERCERO DE LA LÍNEA EN LOS REPORTES (Bloque 7, commit 3).
 *
 *   1. Mayor: la columna "Nombre" resuelve en tres escalones —el tercero de la
 *      propia línea, el de la línea de cuenta control del mismo asiento, y
 *      recién después el heurístico viejo del texto—. El tercer escalón sigue
 *      vivo porque todo lo anterior a la `054` no tiene FK.
 *   2. Excel: el tercero de la LÍNEA manda sobre el que se deduce del documento
 *      de origen, y trae su RUC y su DV — que siguen en columnas separadas.
 *   3. D5: un asiento manual contra la cuenta control explica parte de la
 *      diferencia del auxiliar, con su signo, y NO entra en los tramos.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  nombreDelTercero,
  type LineaHermana,
} from "@/lib/finanzas/reports/libro-mayor";
import { hojaDelMayor } from "@/lib/finanzas/reports/mayor-export";
import type { MayorDeCuenta, FilaMayor } from "@/lib/finanzas/reports/libro-mayor";
import type { TerceroFiscal } from "@/lib/finanzas/reports/tercero-fiscal";
import type { Celda } from "@/lib/finanzas/reports/exportar-xlsx";
import { buildAntiguedad, type ControlMedido } from "@/lib/finanzas/reports/antiguedad";

const CONTROL = { "100004": "clientes" } as Record<string, string | null>;

/** Los valores de una fila del Excel, sin la envoltura `Celda`. */
function valores(fila: readonly Celda[]): unknown[] {
  return fila.map((c) => ("valor" in c ? c.valor : null));
}

function hermana(over: Partial<LineaHermana> = {}): LineaHermana {
  return {
    code: "600001",
    name: "Gasto",
    debit: 10,
    credit: 0,
    line_order: 1,
    descripcion: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Mayor
// ---------------------------------------------------------------------------

test("el tercero de la PROPIA línea manda sobre todo lo demás", () => {
  const propia = hermana({
    terceroClave: "cliente:c1",
    terceroNombre: "FERRETERÍA VALLARINO, S.A.",
  });
  const hermanas = [
    propia,
    hermana({ code: "100004", line_order: 2, descripcion: "Otro nombre cualquiera" }),
  ];
  assert.equal(
    nombreDelTercero(hermanas, CONTROL, propia),
    "FERRETERÍA VALLARINO, S.A.",
    "un dato con FK gana contra un texto"
  );
});

test("si la propia no lo tiene, sirve el de la línea de cuenta control del mismo asiento", () => {
  const propia = hermana();
  const hermanas = [
    propia,
    hermana({ code: "100004", line_order: 2, terceroNombre: "INVERSIONES TOCUMEN REAL, S.A." }),
  ];
  assert.equal(nombreDelTercero(hermanas, CONTROL, propia), "INVERSIONES TOCUMEN REAL, S.A.");
});

test("sin ningún tercero cargado sigue el heurístico viejo: el texto de la línea de control", () => {
  // Es lo que sostiene la columna para TODO lo anterior a la 054, que es la
  // mayor parte del libro. Sacarlo dejaría ese reporte en blanco.
  const propia = hermana();
  const hermanas = [propia, hermana({ code: "100004", line_order: 2, descripcion: "ESTACIÓN DELTA" })];
  assert.equal(nombreDelTercero(hermanas, CONTROL, propia), "ESTACIÓN DELTA");
  // Y sin nada de nada, vacío: nunca un invento.
  assert.equal(nombreDelTercero([propia], CONTROL, propia), "");
});

// ---------------------------------------------------------------------------
// 2. Excel
// ---------------------------------------------------------------------------

function fila(over: Partial<FilaMayor> = {}): FilaMayor {
  return {
    kind: "movimiento",
    cuentaDistribucion: "100004",
    fecha: "2026-09-22",
    tipoTransaccion: "Asiento de diario",
    numero: "50",
    nombre: "El que muestra la pantalla",
    terceroClave: null,
    descripcion: "Ajuste",
    contrapartida: "200001",
    contrapartidaAmbigua: false,
    importe: 12,
    debito: 12,
    credito: 0,
    saldo: 12,
    entryId: "e1",
    sourceType: "manual",
    sourceId: null,
    lineOrderPropia: 1,
    ...over,
  } as FilaMayor;
}

const MAYOR: MayorDeCuenta = {
  cuenta: { code: "100004", name: "Cuentas por Cobrar Clientes" },
  filas: [],
  cantidadMovimientos: 1,
} as unknown as MayorDeCuenta;

test("🔴 el Excel usa el tercero de la LÍNEA, con su RUC y su DV, cuando la línea lo tiene", () => {
  const deLinea = new Map<string, TerceroFiscal>([
    ["cliente:c1", { nombre: "FERRETERÍA VALLARINO, S.A.", ruc: "1554821-1-741203", dv: "08" }],
  ]);
  const porAsiento = new Map<string, TerceroFiscal>([
    ["e1", { nombre: "Otro tercero", ruc: "999", dv: "99" }],
  ]);

  const hoja = hojaDelMayor(
    { ...MAYOR, filas: [fila({ terceroClave: "cliente:c1" })] },
    porAsiento,
    { bufete: "INTEGRA LEGAL", generadoEl: "22/09/2026" },
    deLinea
  );

  const f = valores(hoja.filas[0]);
  assert.ok(f.includes("FERRETERÍA VALLARINO, S.A."), `nombre de la línea: ${JSON.stringify(f)}`);
  assert.ok(f.includes("1554821-1-741203"), "RUC en su columna");
  assert.ok(f.includes("08"), "DV en OTRA columna, nunca pegado al RUC");
  assert.ok(!f.includes("1554821-1-741203 08"), "RUC y DV jamás concatenados");
});

test("sin tercero en la línea, el Excel sigue usando el del documento de origen", () => {
  const porAsiento = new Map<string, TerceroFiscal>([
    ["e1", { nombre: "INVERSIONES TOCUMEN REAL, S.A.", ruc: "1588210-1-713366", dv: "12" }],
  ]);
  const hoja = hojaDelMayor(
    { ...MAYOR, filas: [fila()] },
    porAsiento,
    { bufete: "INTEGRA LEGAL", generadoEl: "22/09/2026" },
    new Map()
  );
  const f = valores(hoja.filas[0]);
  assert.ok(f.includes("INVERSIONES TOCUMEN REAL, S.A."));
  assert.ok(f.includes("1588210-1-713366"));
});

// ---------------------------------------------------------------------------
// 3. D5 — la antigüedad los explica, no los lista
// ---------------------------------------------------------------------------

function control(over: Partial<ControlMedido> = {}): ControlMedido {
  return {
    saldoCuentaControl: 1000,
    saldoApertura: 0,
    cuentaCodigo: "100004",
    cuentaNombre: "Cuentas por Cobrar Clientes",
    sinAsiento: {
      documentos: { cantidad: 0, monto: 0 },
      cobros: { cantidad: 0, monto: 0 },
    },
    ...over,
  };
}

test("D5: un asiento manual contra la cuenta control EXPLICA la diferencia", () => {
  // Auxiliar 900, mayor 1000: los 100 son un asiento manual. Antes esto caía en
  // "hay una tercera causa que este reporte no sabe explicar".
  const r = buildAntiguedad(
    [
      {
        id: "i1",
        numero: "FAC-HON-000001",
        tercero: "Cliente",
        terceroId: "c1",
        fechaReferencia: "2026-09-01",
        diasVencido: 0,
        saldo: 900,
        sourceType: "factura",
      },
    ],
    control({
      sinAsiento: {
        documentos: { cantidad: 0, monto: 0 },
        cobros: { cantidad: 0, monto: 0 },
        manuales: { cantidad: 1, monto: 100, terceros: ["FERRETERÍA VALLARINO, S.A."] },
      },
    })
  );

  assert.equal(r.control.totalAuxiliar, 900);
  assert.equal(r.control.diferencia, 100);
  assert.equal(r.control.porCablear, 100);
  assert.equal(r.control.porCablearExplicado, true, "el asiento manual la explica entera");

  // Y NO entra en la tabla: un asiento manual no tiene vencimiento.
  assert.equal(r.filas.length, 1);
  assert.equal(r.total, 900);
  assert.ok(!r.filas.some((f) => f.tercero.includes("VALLARINO")));
});

test("D5: sin asientos manuales el cálculo es el de siempre", () => {
  const r = buildAntiguedad([], control({ saldoCuentaControl: 0 }));
  assert.equal(r.control.porCablear, 0);
  assert.equal(r.control.cuadra, true);
});

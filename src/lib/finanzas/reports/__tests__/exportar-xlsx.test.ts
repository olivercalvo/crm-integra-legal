/**
 * Tests del motor de exportación a Excel.
 *
 * Lo que se prueba acá es lo que se rompe en silencio: que el DV `05` no pierda
 * el cero, que una celda vacía sea VACÍA de verdad y no una cadena vacía, y que
 * las tildes sobrevivan. Nada de eso se nota mirando el archivo por encima.
 *
 * Los tests leen el buffer generado de vuelta con la misma librería, así que no
 * verifican lo que el código *quiso* escribir sino lo que quedó en el archivo.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  entero,
  fecha,
  generarXlsx,
  nombreDeArchivo,
  nombreDeHojaValido,
  numero,
  texto,
  VACIA,
  type HojaExport,
} from "@/lib/finanzas/reports/exportar-xlsx";

function hoja(over: Partial<HojaExport> = {}): HojaExport {
  return {
    nombre: "Prueba",
    columnas: [
      { titulo: "Nombre", ancho: 20 },
      { titulo: "RUC", ancho: 20 },
      { titulo: "DV", ancho: 6 },
      { titulo: "Importe", ancho: 12 },
    ],
    filas: [],
    ...over,
  };
}

/** Lee el buffer de vuelta y devuelve la hoja. */
function leer(buffer: Buffer, nombreHoja = "Prueba"): XLSX.WorkSheet {
  return XLSX.read(buffer, { type: "buffer" }).Sheets[nombreHoja];
}

function celda(ws: XLSX.WorkSheet, ref: string) {
  return ws[ref] as { t?: string; v?: unknown; z?: string } | undefined;
}

// ---------------------------------------------------------------------------
// 🔴 EL DV Y EL RUC SOBREVIVEN COMO TEXTO
// ---------------------------------------------------------------------------

test("el DV '05' conserva el cero: es texto, no número", () => {
  const buffer = generarXlsx([
    hoja({ filas: [[texto("PROVEEDOR"), texto("155-1-2015"), texto("05"), numero(10)]] }),
  ]);
  const ws = leer(buffer);

  const dv = celda(ws, "C2");
  assert.equal(dv?.t, "s", "el DV tiene que ser texto");
  assert.equal(dv?.v, "05", "perdió el cero delante — es el bug que xlsx evita y CSV no");
});

test("un RUC con guiones no se convierte en fecha ni en número", () => {
  const buffer = generarXlsx([
    hoja({ filas: [[texto("X"), texto("1554821-1-741203"), texto("48"), numero(1)]] }),
  ]);
  const ruc = celda(leer(buffer), "B2");
  assert.equal(ruc?.t, "s");
  assert.equal(ruc?.v, "1554821-1-741203");
});

test("las tildes y la eñe sobreviven al viaje por el archivo", () => {
  const buffer = generarXlsx([
    hoja({
      filas: [[texto("ESTACIÓN DELTA VÍA ESPAÑA"), texto("8-712-1904"), texto("48"), numero(246.4)]],
    }),
  ]);
  assert.equal(celda(leer(buffer), "A2")?.v, "ESTACIÓN DELTA VÍA ESPAÑA");
});

// ---------------------------------------------------------------------------
// LAS CELDAS VACÍAS SON VACÍAS
// ---------------------------------------------------------------------------

test("una celda vacía NO existe en el archivo, para que Excel la filtre", () => {
  const buffer = generarXlsx([
    hoja({ filas: [[texto("Asiento de diario"), VACIA, VACIA, numero(50)]] }),
  ]);
  const ws = leer(buffer);

  assert.equal(celda(ws, "B2"), undefined, "el RUC vacío dejó una celda");
  assert.equal(celda(ws, "C2"), undefined, "el DV vacío dejó una celda");
  // Y la fila sigue existiendo con sus otras columnas.
  assert.equal(celda(ws, "A2")?.v, "Asiento de diario");
  assert.equal(celda(ws, "D2")?.v, 50);
});

test("texto('') y texto(null) son celda vacía, no cadena vacía", () => {
  assert.deepEqual(texto(""), VACIA);
  assert.deepEqual(texto("   "), VACIA);
  assert.deepEqual(texto(null), VACIA);
  assert.deepEqual(texto(undefined), VACIA);

  const buffer = generarXlsx([hoja({ filas: [[texto(""), texto(null), VACIA, numero(1)]] })]);
  const ws = leer(buffer);
  assert.equal(celda(ws, "A2"), undefined, 'texto("") escribió una celda con cadena vacía');
});

test("nunca sale un guion ni un 'N/A' de relleno", () => {
  const buffer = generarXlsx([hoja({ filas: [[VACIA, VACIA, VACIA, VACIA]] })]);
  const ws = leer(buffer);
  const valores = Object.keys(ws)
    .filter((k) => !k.startsWith("!"))
    .map((k) => String((ws[k] as { v?: unknown }).v ?? ""));
  for (const v of valores) {
    assert.ok(v !== "—" && v !== "-" && v.toUpperCase() !== "N/A", `apareció relleno: "${v}"`);
  }
});

// ---------------------------------------------------------------------------
// NÚMEROS Y FECHAS
// ---------------------------------------------------------------------------

test("el importe es un número de verdad, sumable en Excel", () => {
  const buffer = generarXlsx([hoja({ filas: [[texto("X"), VACIA, VACIA, numero(1850.5)]] })]);
  const c = celda(leer(buffer), "D2");
  assert.equal(c?.t, "n");
  assert.equal(c?.v, 1850.5);
});

test("los importes se redondean a dos decimales", () => {
  assert.deepEqual(numero(10.005), { tipo: "numero", valor: 10.01 });
  assert.deepEqual(numero(0.1 + 0.2), { tipo: "numero", valor: 0.3 });
});

test("un importe que no es número da celda vacía en vez de NaN", () => {
  assert.deepEqual(numero(null), VACIA);
  assert.deepEqual(numero(undefined), VACIA);
  assert.deepEqual(numero(Number.NaN), VACIA);
  assert.deepEqual(numero(Number.POSITIVE_INFINITY), VACIA);
});

test("los días vencidos van como entero, no con formato de moneda", () => {
  // "183.00 días" hace frenar a quien lee para entender si son días o dinero.
  assert.deepEqual(entero(183), { tipo: "entero", valor: 183 });
  assert.deepEqual(entero(182.6), { tipo: "entero", valor: 183 });
  assert.deepEqual(entero(null), VACIA);
});

test("una fecha YYYY-MM-DD entra como fecha de Excel, no como texto", () => {
  const buffer = generarXlsx([
    hoja({
      columnas: [{ titulo: "Fecha", ancho: 12 }],
      filas: [[fecha("2026-02-22")]],
    }),
  ]);
  const c = celda(leer(buffer), "A2");
  assert.equal(c?.t, "n", "una fecha guardada como texto no se puede ordenar ni filtrar por rango");
  // 22/02/2026 en serial de Excel.
  assert.equal(c?.v, 46075);
});

test("una fecha inválida o nula da celda vacía", () => {
  assert.deepEqual(fecha(null), VACIA);
  assert.deepEqual(fecha(""), VACIA);
  assert.deepEqual(fecha("no-es-fecha"), VACIA);
});

test("la fecha no se corre por el huso horario de quien genera el archivo", () => {
  // Se calcula en UTC a propósito: una fecha contable no tiene hora.
  const buffer = generarXlsx([
    hoja({ columnas: [{ titulo: "F", ancho: 12 }], filas: [[fecha("2026-01-01")]] }),
  ]);
  const serial = celda(leer(buffer), "A2")?.v as number;
  const reconstruida = new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
  assert.equal(reconstruida, "2026-01-01");
});

// ---------------------------------------------------------------------------
// ESTRUCTURA DE LA HOJA
// ---------------------------------------------------------------------------

test("el encabezado va antes de los títulos, con una línea en blanco de por medio", () => {
  const buffer = generarXlsx([
    hoja({
      encabezado: [["INTEGRA LEGAL"], ["Cuenta", "610009 — Combustible"]],
      filas: [[texto("X"), VACIA, VACIA, numero(1)]],
    }),
  ]);
  const ws = leer(buffer);
  assert.equal(celda(ws, "A1")?.v, "INTEGRA LEGAL");
  assert.equal(celda(ws, "B2")?.v, "610009 — Combustible");
  assert.equal(celda(ws, "A3"), undefined, "falta la línea en blanco");
  assert.equal(celda(ws, "A4")?.v, "Nombre", "los títulos no quedaron donde se esperaba");
  assert.equal(celda(ws, "A5")?.v, "X");
});

test("Excel acepta el nombre de la hoja: sin signos prohibidos y hasta 31 caracteres", () => {
  assert.equal(nombreDeHojaValido("Mayor 610009"), "Mayor 610009");
  assert.equal(nombreDeHojaValido("Mayor/610009"), "Mayor 610009");
  assert.equal(nombreDeHojaValido("a".repeat(40)).length, 31);
  assert.equal(nombreDeHojaValido("  "), "Hoja1");
});

test("el nombre del archivo pierde las tildes, pero el contenido NO", () => {
  // El nombre viaja por una cabecera HTTP; el contenido, adentro del archivo.
  assert.equal(nombreDeArchivo(["Antigüedad", "Cuentas por Pagar"]), "Antiguedad_Cuentas_por_Pagar");
  assert.equal(nombreDeArchivo(["Mayor", "610009", "Combustible"]), "Mayor_610009_Combustible");
  assert.equal(nombreDeArchivo([null, "", "  "]), "reporte");
});

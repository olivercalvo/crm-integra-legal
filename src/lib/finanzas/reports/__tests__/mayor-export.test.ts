/**
 * Tests del armado de las hojas del Mayor y de la Antigüedad.
 *
 * Lo central: que el RUC y el DV salgan en DOS columnas, y que un movimiento sin
 * tercero deje esas columnas vacías en vez de rellenarlas.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { hojaDelMayor, hojaDeAntiguedad } from "@/lib/finanzas/reports/mayor-export";
import type { MayorDeCuenta, FilaMayor } from "@/lib/finanzas/reports/libro-mayor";
import { buildAntiguedad, type DocumentoPendiente } from "@/lib/finanzas/reports/antiguedad";
import type { TerceroFiscal } from "@/lib/finanzas/reports/tercero-fiscal";

const CTX = { bufete: "INTEGRA LEGAL", generadoEl: "02/09/2026" };

function fila(over: Partial<FilaMayor> = {}): FilaMayor {
  return {
    kind: "movimiento",
    cuentaDistribucion: "610009",
    fecha: "2026-02-22",
    tipoTransaccion: "Gasto / compra",
    numero: "2",
    nombre: "ESTACIÓN DELTA VÍA ESPAÑA",
    descripcion: "Combustible de la flota — febrero 2026",
    contrapartida: "Cuentas por pagar",
    contrapartidaAmbigua: false,
    importe: 246.4,
    saldo: 1346.96,
    entryId: "e1",
    sourceType: "gasto",
    sourceId: "g1",
    // El asiento completo viaja en la fila desde el 02/09/2026. La exportación
    // no lo usa —es de la pantalla— pero el tipo lo exige.
    lineas: [],
    lineOrderPropia: 0,
    ...over,
  };
}

function mayor(filas: FilaMayor[]): MayorDeCuenta {
  return {
    cuenta: {
      code: "610009",
      name: "Combustible",
      account_type: "expense",
      saldo_inicial: 1100.56,
      saldo_inicial_fecha: null,
    },
    filas,
    totales: {
      netoDelPeriodo: 246.4,
      saldoFinal: 1346.96,
      totalDebitos: 246.4,
      totalCreditos: 0,
    },
    cantidadMovimientos: filas.filter((f) => f.kind === "movimiento").length,
  } as MayorDeCuenta;
}

/** Índices de las columnas del mayor, para leer las filas sin contar a mano. */
const COL = {
  fecha: 0,
  tipo: 1,
  numero: 2,
  nombre: 3,
  ruc: 4,
  dv: 5,
  descripcion: 6,
  contrapartida: 7,
  importe: 8,
  saldo: 9,
};

const DELTA: TerceroFiscal = {
  nombre: "ESTACIÓN DELTA VÍA ESPAÑA",
  ruc: "8-712-1904",
  dv: "48",
};

// ---------------------------------------------------------------------------
// 🔴 DOS COLUMNAS, NUNCA UNA
// ---------------------------------------------------------------------------

test("el RUC y el DV salen en columnas separadas y consecutivas", () => {
  const hoja = hojaDelMayor(mayor([fila()]), new Map([["e1", DELTA]]), CTX);

  assert.equal(hoja.columnas[COL.ruc].titulo, "RUC");
  assert.equal(hoja.columnas[COL.dv].titulo, "DV");

  const f = hoja.filas[0];
  assert.deepEqual(f[COL.ruc], { tipo: "texto", valor: "8-712-1904" });
  assert.deepEqual(f[COL.dv], { tipo: "texto", valor: "48" });
});

test("ninguna celda del mayor contiene el RUC y el DV juntos", () => {
  const hoja = hojaDelMayor(mayor([fila()]), new Map([["e1", DELTA]]), CTX);
  for (const f of hoja.filas) {
    for (const celda of f) {
      if (celda.tipo !== "texto") continue;
      assert.ok(
        !(celda.valor.includes("8-712-1904") && celda.valor.includes("48")),
        `una celda trae RUC y DV juntos: "${celda.valor}"`
      );
    }
  }
});

test("las columnas son las que pidió Josuarth, en orden", () => {
  const hoja = hojaDelMayor(mayor([fila()]), new Map(), CTX);
  assert.deepEqual(
    hoja.columnas.map((c) => c.titulo),
    [
      "Fecha",
      "Tipo de transacción",
      "Número de documento",
      "Nombre",
      "RUC",
      "DV",
      "Descripción",
      "Contrapartida",
      "Importe",
      "Saldo",
    ]
  );
});

// ---------------------------------------------------------------------------
// SIN TERCERO: COLUMNAS VACÍAS, NO RELLENO
// ---------------------------------------------------------------------------

test("un asiento de diario deja Nombre, RUC y DV vacíos — sin guion ni N/A", () => {
  const manual = fila({
    tipoTransaccion: "Asiento de diario",
    nombre: "",
    sourceType: "manual",
    sourceId: null,
    entryId: "e-manual",
  });
  const hoja = hojaDelMayor(mayor([manual]), new Map(), CTX);
  const f = hoja.filas[0];

  assert.equal(f[COL.nombre].tipo, "vacia");
  assert.equal(f[COL.ruc].tipo, "vacia");
  assert.equal(f[COL.dv].tipo, "vacia");
});

test("la fila de saldo inicial no inventa un tercero ni un importe", () => {
  const inicial = fila({
    kind: "saldo-inicial",
    fecha: null,
    nombre: "",
    numero: "",
    descripcion: "Saldo inicial",
    contrapartida: "",
    importe: 0,
    saldo: 1100.56,
    entryId: null,
    sourceType: null,
    sourceId: null,
  });
  const hoja = hojaDelMayor(mayor([inicial]), new Map([["e1", DELTA]]), CTX);
  const f = hoja.filas[0];

  assert.deepEqual(f[COL.tipo], { tipo: "texto", valor: "Saldo inicial" });
  assert.equal(f[COL.nombre].tipo, "vacia");
  assert.equal(f[COL.ruc].tipo, "vacia");
  assert.equal(f[COL.dv].tipo, "vacia");
  assert.equal(f[COL.importe].tipo, "vacia", "el saldo inicial no es un movimiento");
  assert.deepEqual(f[COL.saldo], { tipo: "numero", valor: 1100.56 });
});

test("un cliente CON DV lo saca en su columna, separado del RUC", () => {
  // El caso normal: un receptor tipo 01 (contribuyente), que la DGI obliga a
  // tener DV. Sale de `clients.digito_verificador`, la misma columna que el
  // mapper le manda al PAC.
  const cliente: TerceroFiscal = {
    nombre: "FERRETERÍA VALLARINO, S.A.",
    ruc: "1554821-1-741203",
    dv: "08",
  };
  const hoja = hojaDelMayor(mayor([fila()]), new Map([["e1", cliente]]), CTX);
  const f = hoja.filas[0];

  assert.deepEqual(f[COL.ruc], { tipo: "texto", valor: "1554821-1-741203" });
  assert.deepEqual(f[COL.dv], { tipo: "texto", valor: "08" }, "el DV perdió el cero");
});

test("un DV '00' es un valor real y tiene que sobrevivir", () => {
  // No es teórico: en staging, INVERSIONES TOCUMEN REAL y CONSTRUCTORA CHIRIQUÍ
  // tienen DV "00". Es el caso extremo del cero delante — un CSV lo abriría
  // como 0, o directamente vacío.
  const cliente: TerceroFiscal = {
    nombre: "INVERSIONES TOCUMEN REAL, S.A.",
    ruc: "1588210-1-713366",
    dv: "00",
  };
  const hoja = hojaDelMayor(mayor([fila()]), new Map([["e1", cliente]]), CTX);
  assert.deepEqual(hoja.filas[0][COL.dv], { tipo: "texto", valor: "00" });
});

test("un cliente SIN DV deja vacía esa columna y NO el RUC", () => {
  // Un receptor tipo 02 (consumidor final): la DGI no le exige DV, así que
  // `digito_verificador` queda en NULL. La celda vacía es un dato ausente
  // LEGÍTIMO, no uno perdido por el camino — que es lo que pasaba antes del
  // arreglo del 02/09/2026, cuando el exportador mandaba `dv: ""` para todos.
  const cliente: TerceroFiscal = {
    nombre: "Nidia Espinosa Caballero",
    ruc: "4-209-6631",
    dv: "",
  };
  const hoja = hojaDelMayor(mayor([fila()]), new Map([["e1", cliente]]), CTX);
  const f = hoja.filas[0];

  assert.deepEqual(f[COL.ruc], { tipo: "texto", valor: "4-209-6631" });
  assert.equal(f[COL.dv].tipo, "vacia");
});

// ---------------------------------------------------------------------------
// EL NOMBRE
// ---------------------------------------------------------------------------

test("el nombre de la ficha manda sobre el texto del ledger", () => {
  const conFicha = fila({ nombre: "estacion delta (tipeado a mano)" });
  const hoja = hojaDelMayor(mayor([conFicha]), new Map([["e1", DELTA]]), CTX);
  assert.deepEqual(hoja.filas[0][COL.nombre], {
    tipo: "texto",
    valor: "ESTACIÓN DELTA VÍA ESPAÑA",
  });
});

test("sin ficha, queda el nombre que muestra la pantalla", () => {
  const hoja = hojaDelMayor(mayor([fila({ nombre: "PROVEEDOR SUELTO" })]), new Map(), CTX);
  assert.deepEqual(hoja.filas[0][COL.nombre], { tipo: "texto", valor: "PROVEEDOR SUELTO" });
});

// ---------------------------------------------------------------------------
// EL ENCABEZADO
// ---------------------------------------------------------------------------

test("el encabezado nombra la cuenta y cuántos movimientos trae", () => {
  const hoja = hojaDelMayor(mayor([fila()]), new Map(), CTX);
  const plano = (hoja.encabezado ?? []).flat().join(" | ");
  assert.match(plano, /610009 — Combustible/);
  assert.match(plano, /Movimientos/);
  assert.doesNotMatch(plano, /Período/, "sin rango no debería aparecer la línea de período");
});

test("con rango, el encabezado lo declara", () => {
  const hoja = hojaDelMayor(mayor([fila()]), new Map(), {
    ...CTX,
    desde: "2026-01-01",
    hasta: "2026-06-30",
  });
  const plano = (hoja.encabezado ?? []).flat().join(" | ");
  assert.match(plano, /2026-01-01 a 2026-06-30/);
});

// ---------------------------------------------------------------------------
// ANTIGÜEDAD
// ---------------------------------------------------------------------------

function doc(over: Partial<DocumentoPendiente> = {}): DocumentoPendiente {
  return {
    id: "g1",
    numero: "Combustible de la flota — febrero 2026",
    tercero: "ESTACIÓN DELTA VÍA ESPAÑA",
    terceroId: "s1",
    fechaReferencia: "2026-02-22",
    diasVencido: 192,
    saldo: 246.4,
    sourceType: "gasto",
    ...over,
  };
}

const CONTROL = {
  saldoCuentaControl: 6994.73,
  saldoApertura: 3400.48,
  sinAsiento: { documentos: { cantidad: 0, monto: 0 }, cobros: { cantidad: 0, monto: 0 } },
  cuentaCodigo: "200001",
  cuentaNombre: "Cuentas por pagar",
};

test("la antigüedad sale UNA FILA POR DOCUMENTO, no agrupada", () => {
  const rep = buildAntiguedad(
    [doc(), doc({ id: "g2", numero: "Otro gasto", saldo: 100, diasVencido: 10 })],
    CONTROL
  );
  const hoja = hojaDeAntiguedad(rep, "pagar", new Map(), CTX);
  assert.equal(hoja.filas.length, 2, "una planilla agrupada no se puede filtrar ni sumar");
});

test("la antigüedad también saca RUC y DV en columnas separadas", () => {
  const rep = buildAntiguedad([doc()], CONTROL);
  const hoja = hojaDeAntiguedad(rep, "pagar", new Map([["g1", DELTA]]), CTX);

  assert.equal(hoja.columnas[1].titulo, "RUC");
  assert.equal(hoja.columnas[2].titulo, "DV");
  assert.deepEqual(hoja.filas[0][1], { tipo: "texto", valor: "8-712-1904" });
  assert.deepEqual(hoja.filas[0][2], { tipo: "texto", valor: "48" });
});

test("el saldo cae en la columna de SU tramo y en ninguna otra", () => {
  const rep = buildAntiguedad([doc({ diasVencido: 45 })], CONTROL);
  const hoja = hojaDeAntiguedad(rep, "pagar", new Map(), CTX);
  const f = hoja.filas[0];

  // Columnas 7..11 son los cinco tramos; 12 es el total.
  const tramos = f.slice(7, 12);
  const conValor = tramos.filter((c) => c.tipo === "numero");
  assert.equal(conValor.length, 1, "el saldo apareció en más de un tramo");
  assert.deepEqual(conValor[0], { tipo: "numero", valor: 246.4 });
  assert.deepEqual(f[6], { tipo: "texto", valor: "31 a 60" });
  assert.deepEqual(f[12], { tipo: "numero", valor: 246.4 });
});

test("los días vencidos van como entero", () => {
  const rep = buildAntiguedad([doc({ diasVencido: 192 })], CONTROL);
  const hoja = hojaDeAntiguedad(rep, "pagar", new Map(), CTX);
  assert.deepEqual(hoja.filas[0][5], { tipo: "entero", valor: 192 });
});

test("el encabezado de la antigüedad trae las tres cifras de control", () => {
  const rep = buildAntiguedad([doc()], CONTROL);
  const hoja = hojaDeAntiguedad(rep, "pagar", new Map(), CTX);
  const plano = (hoja.encabezado ?? []).flat().join(" | ");
  assert.match(plano, /Total del auxiliar/);
  assert.match(plano, /Cuenta control 200001/);
  assert.match(plano, /Diferencia/);
});

test("el nombre de la hoja distingue cobrar de pagar", () => {
  const rep = buildAntiguedad([doc()], CONTROL);
  assert.equal(hojaDeAntiguedad(rep, "pagar", new Map(), CTX).nombre, "Antiguedad CxP");
  assert.equal(hojaDeAntiguedad(rep, "cobrar", new Map(), CTX).nombre, "Antiguedad CxC");
});

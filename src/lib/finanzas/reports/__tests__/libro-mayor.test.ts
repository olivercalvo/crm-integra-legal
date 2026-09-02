/**
 * Tests del armado del Libro Mayor.
 *
 * Los tres primeros bloques protegen las TRES DECISIONES PENDIENTES de Josuar.
 * Están escritos para que, cuando responda, quede claro de un vistazo qué
 * asserts hay que cambiar y cuáles no.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/reports/__tests__/libro-mayor.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMayorDeCuenta,
  efectoEnSaldo,
  importeDeLinea,
  nombreDelTercero,
  tipoTransaccionLabel,
  totalesDePie,
  type CuentaDelMayor,
  type LineaHermana,
  type MovimientoCrudo,
} from "@/lib/finanzas/reports/libro-mayor";

function assertMoney(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 0.005,
    `${message}: esperado ${expected}, obtenido ${actual}`
  );
}

const BANCO: CuentaDelMayor = {
  code: "100001",
  name: "Banco General Operativa",
  account_type: "asset",
  saldo_inicial: 14381.27,
  saldo_inicial_fecha: "2026-01-01",
};

function herm(
  code: string,
  name: string,
  debit: number,
  credit: number,
  line_order: number,
  descripcion: string | null = null
): LineaHermana {
  return { code, name, debit, credit, line_order, descripcion };
}

function mov(
  n: number,
  fecha: string,
  debit: number,
  credit: number,
  hermanas: LineaHermana[],
  extra: Partial<MovimientoCrudo> = {}
): MovimientoCrudo {
  return {
    entry_id: `e-${n}`,
    entry_number: n,
    transaction_date: fecha,
    source_type: "pago",
    source_id: `src-${n}`,
    entry_description: `Asiento ${n}`,
    line_description: null,
    line_order: 1,
    debit,
    credit,
    account_code: BANCO.code,
    account_name: BANCO.name,
    account_type: "asset",
    hermanas,
    ...extra,
  };
}

// ===========================================================================
// PENDIENTE 4 — el pie: neto vs saldo final
// ===========================================================================

test("PENDIENTE 4: el pie da el NETO de movimientos y el SALDO FINAL, separados", () => {
  // Los números son los del ejemplo real de Josuar (1021 Banco Pichincha).
  const t = totalesDePie(14381.27, [
    { debit: 12412.0, credit: 0 },
    { debit: 0, credit: 1712.0 },
    { debit: 0, credit: 351.25 },
    { debit: 0, credit: 3608.74 },
  ]);

  // El recuadro de SU modelo es el NETO, no el saldo. Es el detalle que más
  // fácil se lee mal.
  assertMoney(t.netoDelPeriodo, 6740.01, "neto del período");
  assertMoney(t.saldoFinal, 21121.28, "saldo final");
  assertMoney(t.totalDebitos, 12412.0, "total débitos");
  assertMoney(t.totalCreditos, 5671.99, "total créditos");

  assert.notEqual(t.netoDelPeriodo, t.saldoFinal, "no son lo mismo, y por eso se muestran los dos");
});

test("PENDIENTE 4: sin movimientos, el neto es 0 y el saldo final es el inicial", () => {
  const t = totalesDePie(500, []);
  assertMoney(t.netoDelPeriodo, 0, "neto");
  assertMoney(t.saldoFinal, 500, "saldo final");
});

// ===========================================================================
// PENDIENTE 5 — el importe: con signo, en convención de balanza
// ===========================================================================

test("PENDIENTE 5: el importe es débito − crédito (lo que muestra el modelo)", () => {
  assertMoney(importeDeLinea({ debit: 12412, credit: 0, account_type: "asset" }), 12412, "entrada");
  assertMoney(importeDeLinea({ debit: 0, credit: 1712, account_type: "asset" }), -1712, "salida");
});

test("PENDIENTE 5: hoy un PASIVO usa el mismo criterio — es lo que está por confirmar", () => {
  // Si Josuar pide "según la naturaleza de la cuenta", ESTE assert es el que
  // cambia: un pasivo que crece pasaría a verse en positivo.
  assertMoney(
    importeDeLinea({ debit: 0, credit: 1850, account_type: "liability" }),
    -1850,
    "pasivo que crece, hoy negativo"
  );
});

test("el saldo corrido NO depende de importeDeLinea: siempre es balanza", () => {
  // Van separados a propósito. Si el importe cambia de criterio, el saldo tiene
  // que seguir cerrando contra el Balance General.
  assertMoney(efectoEnSaldo({ debit: 0, credit: 1850 }), -1850, "efecto en saldo");
});

// ===========================================================================
// PENDIENTE 3 — la contrapartida (la decisión vive en contrapartida.ts)
// ===========================================================================

test("PENDIENTE 3: dos líneas → la contrapartida es la cuenta del otro lado", () => {
  const propia = herm("100001", "Banco General Operativa", 4815, 0, 1);
  const otra = herm("100004", "Cuentas por Cobrar Clientes", 0, 4815, 2);
  const m = buildMayorDeCuenta(BANCO, [mov(1, "2026-03-02", 4815, 0, [propia, otra])]);

  assert.equal(m.filas[1].contrapartida, "Cuentas por Cobrar Clientes");
  assert.equal(m.filas[1].contrapartidaAmbigua, false);
});

test("PENDIENTE 3: varias líneas contra UNA sola cuenta → sigue sin ser ambigua", () => {
  const propia = herm("610008", "Utiles de Oficina", 412.35, 0, 1);
  const m = buildMayorDeCuenta(
    { ...BANCO, code: "610008", name: "Utiles de Oficina", account_type: "expense", saldo_inicial: 0 },
    [
      mov(7, "2026-03-15", 412.35, 0, [
        propia,
        herm("610002", "Honorarios Profesionales", 900, 0, 2),
        herm("500003", "Mensajeria Especializada", 185.5, 0, 3),
        herm("200001", "Cuentas por pagar", 0, 1497.85, 4),
      ]),
    ]
  );
  assert.equal(m.filas[1].contrapartida, "Cuentas por pagar");
  assert.equal(m.filas[1].contrapartidaAmbigua, false);
});

test("PENDIENTE 3: dos cuentas de cada lado → ambigua, hoy 'Varios'", () => {
  const propia = herm("500005", "Costos tramites legales", 320, 0, 1);
  const m = buildMayorDeCuenta(
    { ...BANCO, code: "500005", name: "Costos tramites legales", account_type: "cost", saldo_inicial: 0 },
    [
      mov(8, "2026-03-28", 320, 0, [
        propia,
        herm("500003", "Mensajeria Especializada", 140, 0, 2),
        herm("610008", "Utiles de Oficina", 0, 260, 3),
        herm("610002", "Honorarios Profesionales", 0, 200, 4),
      ]),
    ]
  );
  assert.equal(m.filas[1].contrapartidaAmbigua, true, "hay dos cuentas del otro lado");
  assert.equal(m.filas[1].contrapartida, "Varios");
});

// ===========================================================================
// Estructura del mayor
// ===========================================================================

test("la primera fila SIEMPRE es el saldo inicial, aunque sea 0", () => {
  const m = buildMayorDeCuenta({ ...BANCO, saldo_inicial: 0 }, []);
  assert.equal(m.filas.length, 1);
  assert.equal(m.filas[0].kind, "saldo-inicial");
  assert.equal(m.filas[0].descripcion, "Saldo inicial");
  assertMoney(m.filas[0].saldo, 0, "arranca en 0");
});

test("el saldo corrido acumula desde el saldo inicial", () => {
  const m = buildMayorDeCuenta(BANCO, [
    mov(1, "2026-02-05", 1000, 0, [herm("100001", "Banco", 1000, 0, 1), herm("400001", "Ingreso", 0, 1000, 2)]),
    mov(2, "2026-02-10", 0, 300, [herm("100001", "Banco", 0, 300, 1), herm("610001", "Alquiler", 300, 0, 2)]),
  ]);
  assertMoney(m.filas[0].saldo, 14381.27, "saldo inicial");
  assertMoney(m.filas[1].saldo, 15381.27, "tras +1000");
  assertMoney(m.filas[2].saldo, 15081.27, "tras -300");
  assertMoney(m.totales.saldoFinal, 15081.27, "el pie coincide con el último saldo corrido");
  assertMoney(m.totales.netoDelPeriodo, 700, "neto");
});

test("las filas se ordenan por fecha, número y orden de línea", () => {
  // Llegan desordenadas a propósito: el saldo corrido no puede depender del
  // ORDER BY de la consulta.
  const m = buildMayorDeCuenta(BANCO, [
    mov(9, "2026-03-01", 0, 100, [herm("100001", "Banco", 0, 100, 1), herm("610001", "A", 100, 0, 2)]),
    mov(3, "2026-02-01", 500, 0, [herm("100001", "Banco", 500, 0, 1), herm("400001", "I", 0, 500, 2)]),
  ]);
  assert.deepEqual(
    m.filas.filter((f) => f.kind === "movimiento").map((f) => f.numero),
    ["3", "9"]
  );
});

test("el tipo de transacción se muestra en español", () => {
  assert.equal(tipoTransaccionLabel("factura"), "Factura");
  assert.equal(tipoTransaccionLabel("apertura"), "Asiento de apertura");
  assert.equal(tipoTransaccionLabel("manual"), "Asiento de diario");
  // Un valor desconocido se muestra tal cual en vez de romper.
  assert.equal(tipoTransaccionLabel("loquesea"), "loquesea");
});

test("la trazabilidad nivel 2 viaja en la fila", () => {
  const m = buildMayorDeCuenta(BANCO, [
    mov(1, "2026-02-05", 1000, 0, [herm("100001", "Banco", 1000, 0, 1), herm("400001", "I", 0, 1000, 2)], {
      source_type: "factura",
      source_id: "f-123",
      entry_id: "asiento-abc",
    }),
  ]);
  assert.equal(m.filas[1].sourceType, "factura");
  assert.equal(m.filas[1].sourceId, "f-123");
  assert.equal(m.filas[1].entryId, "asiento-abc");
  // La fila de saldo inicial no tiene origen: no viene de ningún asiento.
  assert.equal(m.filas[0].sourceId, null);
});

// ===========================================================================
// Nombre del tercero
// ===========================================================================

test("el nombre sale de la línea que toca la CUENTA CONTROL", () => {
  const control = { "100004": "clientes", "200001": "proveedores" };
  const hermanas = [
    herm("100001", "Banco", 4815, 0, 1, "Transferencia"),
    herm("100004", "CxC", 0, 4815, 2, "FERRETERÍA VALLARINO, S.A."),
  ];
  assert.equal(nombreDelTercero(hermanas, control), "FERRETERÍA VALLARINO, S.A.");
});

test("sin cuenta control en el asiento, el nombre queda vacío (no se inventa)", () => {
  const hermanas = [
    herm("500005", "Costos", 320, 0, 1, "Trámites"),
    herm("610008", "Utiles", 0, 320, 2, "Reclasificación"),
  ];
  assert.equal(nombreDelTercero(hermanas, { "100004": "clientes" }), "");
});

test("la descripción de la línea gana sobre la del asiento", () => {
  const m = buildMayorDeCuenta(BANCO, [
    mov(1, "2026-02-05", 1000, 0, [herm("100001", "Banco", 1000, 0, 1), herm("400001", "I", 0, 1000, 2)], {
      line_description: "Detalle de la línea",
      entry_description: "Descripción del asiento",
    }),
  ]);
  assert.equal(m.filas[1].descripcion, "Detalle de la línea");
});

test("sin descripción de línea, se usa la del asiento", () => {
  const m = buildMayorDeCuenta(BANCO, [
    mov(1, "2026-02-05", 1000, 0, [herm("100001", "Banco", 1000, 0, 1), herm("400001", "I", 0, 1000, 2)], {
      line_description: "   ",
      entry_description: "Cobro de factura FE-0001",
    }),
  ]);
  assert.equal(m.filas[1].descripcion, "Cobro de factura FE-0001");
});

// ---------------------------------------------------------------------------
// SALDO DE ARRANQUE CON FILTRO DE FECHAS  (Bloque 0, 01/09/2026)
// ---------------------------------------------------------------------------
// Hasta el 01/09 la fila "Saldo inicial" mostraba SIEMPRE el saldo de apertura,
// aunque el usuario filtrara desde junio. El saldo corrido quedaba desplazado de
// punta a punta: es el error más visible que puede tener un mayor, y el primero
// que un contador nota al abrirlo.
//
// Quién calcula el ajuste es `loadCuentaDelMayor` (capa de datos, suma los
// movimientos anteriores al `desde`). Lo que se prueba acá es que el armado lo
// USE: que arranque de `saldo_arranque` y no de `saldo_inicial`.

test("sin filtro de fechas, el arranque sigue siendo el saldo de apertura", () => {
  const m = buildMayorDeCuenta(BANCO, [
    mov(1, "2026-03-02", 1000, 0, [herm("100001", "Banco", 1000, 0, 1)]),
  ]);
  assertMoney(m.filas[0].saldo, 14381.27, "fila de arranque");
  assertMoney(m.totales.saldoFinal, 15381.27, "saldo final");
});

test("con `saldo_arranque`, la fila de arranque y el saldo corrido salen de ahí", () => {
  // La cuenta abre en 14,381.27 pero antes del rango se movió +2,000.00.
  const cuenta: CuentaDelMayor = {
    ...BANCO,
    saldo_arranque: 16381.27,
    arranque_fecha: "2026-06-01",
    arranque_ajustado: true,
  };
  const m = buildMayorDeCuenta(cuenta, [
    mov(9, "2026-06-15", 500, 0, [herm("100001", "Banco", 500, 0, 1)]),
  ]);

  assertMoney(m.filas[0].saldo, 16381.27, "la fila de arranque usa el ajustado");
  assertMoney(m.filas[1].saldo, 16881.27, "el saldo corrido sigue desde el ajustado");
  assertMoney(m.totales.saldoFinal, 16881.27, "saldo final = arranque + neto");
  assert.equal(m.filas[0].fecha, "2026-06-01", "la fila de arranque lleva la fecha del rango");
});

test("el NETO del pie NO cambia con el ajuste: son los movimientos del rango", () => {
  // Es la trampa del reporte: si el ajuste se colara en el neto, el pie
  // contaría dos veces los movimientos anteriores al rango.
  const conAjuste = buildMayorDeCuenta(
    { ...BANCO, saldo_arranque: 99999, arranque_fecha: "2026-06-01", arranque_ajustado: true },
    [mov(9, "2026-06-15", 500, 0, [herm("100001", "Banco", 500, 0, 1)])]
  );
  const sinAjuste = buildMayorDeCuenta(BANCO, [
    mov(9, "2026-06-15", 500, 0, [herm("100001", "Banco", 500, 0, 1)]),
  ]);
  assertMoney(conAjuste.totales.netoDelPeriodo, 500, "neto con ajuste");
  assertMoney(sinAjuste.totales.netoDelPeriodo, 500, "neto sin ajuste");
});

test("el ejemplo del modelo de Josuarth cierra: 14,381.27 + 6,740.01 = 21,121.28", () => {
  // Banco Pichincha, tal como está en `Temas Contables/image001.png`. Es el
  // caso que fija que el pie es el NETO y no el saldo final.
  const m = buildMayorDeCuenta(BANCO, [
    mov(1, "2026-07-07", 12412, 0, [herm("100001", "Banco", 12412, 0, 1)]),
    mov(2, "2026-07-09", 0, 1712, [herm("100001", "Banco", 0, 1712, 1)]),
    mov(3, "2026-07-09", 0, 351.25, [herm("100001", "Banco", 0, 351.25, 1)]),
    mov(4, "2026-07-09", 0, 3608.74, [herm("100001", "Banco", 0, 3608.74, 1)]),
  ]);

  assertMoney(m.totales.netoDelPeriodo, 6740.01, "el pie: NETO de movimientos");
  assertMoney(m.filas[m.filas.length - 1].saldo, 21121.28, "última fila de Saldo");
  assertMoney(m.totales.saldoFinal, 21121.28, "arranque + neto");
});

// ===========================================================================
// EL ASIENTO COMPLETO EN LA FILA  (02/09/2026)
// ===========================================================================
// El contador pidió desplegar el asiento entero desde el mayor, para ver "las
// fracciones" sin salir de la pantalla. Las líneas ya viajaban en el
// movimiento —`hermanas`, que se usaba solo para la contrapartida— y ahora se
// propagan a la fila.

test("la fila lleva TODAS las líneas del asiento, incluida la propia", () => {
  const hermanas = [
    herm("100001", "Banco General Operativa", 1070, 0, 1),
    herm("100004", "Cuentas por Cobrar Clientes", 0, 1000, 2),
    herm("200003", "ITBMS por Pagar", 0, 70, 3),
  ];
  const mayor = buildMayorDeCuenta(BANCO, [mov(5, "2026-04-05", 1070, 0, hermanas)]);
  const fila = mayor.filas[1];

  assert.equal(fila.lineas.length, 3, "el asiento tiene 3 líneas y la fila tiene que traerlas");
  assert.deepEqual(
    fila.lineas.map((l) => l.code),
    ["100001", "100004", "200003"]
  );
  // La propia ESTÁ adentro: si se excluyera, el pie del despliegue mostraría un
  // descuadre falso en todos los asientos.
  assert.ok(
    fila.lineas.some((l) => l.line_order === fila.lineOrderPropia),
    "la línea propia no está entre las del asiento"
  );
});

test("las líneas del asiento cuadran en cero — que es lo que el pie muestra", () => {
  const hermanas = [
    herm("100001", "Banco General Operativa", 1070, 0, 1),
    herm("100004", "Cuentas por Cobrar Clientes", 0, 1000, 2),
    herm("200003", "ITBMS por Pagar", 0, 70, 3),
  ];
  const fila = buildMayorDeCuenta(BANCO, [mov(5, "2026-04-05", 1070, 0, hermanas)]).filas[1];

  const debitos = fila.lineas.reduce((s, l) => s + l.debit, 0);
  const creditos = fila.lineas.reduce((s, l) => s + l.credit, 0);
  assertMoney(debitos, 1070, "débitos del asiento");
  assertMoney(creditos, 1070, "créditos del asiento");
  assertMoney(debitos - creditos, 0, "el asiento tiene que cuadrar");
});

test("las líneas salen ordenadas por line_order, no como venga la consulta", () => {
  const desordenadas = [
    herm("200003", "ITBMS por Pagar", 0, 70, 3),
    herm("100001", "Banco General Operativa", 1070, 0, 1),
    herm("100004", "Cuentas por Cobrar Clientes", 0, 1000, 2),
  ];
  const fila = buildMayorDeCuenta(BANCO, [mov(5, "2026-04-05", 1070, 0, desordenadas)]).filas[1];
  assert.deepEqual(
    fila.lineas.map((l) => l.line_order),
    [1, 2, 3]
  );
});

test("🔴 un asiento que toca la MISMA cuenta dos veces resalta la línea correcta", () => {
  // Es el caso que los datos de staging NO pueden probar: hoy ningún asiento
  // repite cuenta. Por eso vive acá.
  //
  // Un asiento que toca Banco dos veces genera DOS renglones en el mayor, y
  // cada uno tiene que resaltar SU propia línea. Resaltar "la línea de esta
  // cuenta" resaltaría las dos, y el contador vería dos filas idénticas.
  const hermanas = [
    herm("100001", "Banco General Operativa", 500, 0, 1, "Depósito sucursal A"),
    herm("100001", "Banco General Operativa", 300, 0, 2, "Depósito sucursal B"),
    herm("400001", "Ingresos por Honorarios", 0, 800, 3),
  ];

  const mayor = buildMayorDeCuenta(BANCO, [
    mov(7, "2026-05-01", 500, 0, hermanas, { line_order: 1 }),
    mov(7, "2026-05-01", 300, 0, hermanas, { line_order: 2, entry_id: "e-7" }),
  ]);

  const [, primera, segunda] = mayor.filas;

  assert.equal(primera.lineOrderPropia, 1);
  assert.equal(segunda.lineOrderPropia, 2);

  // Cada fila resalta una línea distinta, y las dos son de la MISMA cuenta.
  const resaltadaEn = (f: typeof primera) =>
    f.lineas.find((l) => l.line_order === f.lineOrderPropia);
  assert.equal(resaltadaEn(primera)?.descripcion, "Depósito sucursal A");
  assert.equal(resaltadaEn(segunda)?.descripcion, "Depósito sucursal B");

  // Y las dos ven el asiento COMPLETO, no media parte.
  assert.equal(primera.lineas.length, 3);
  assert.equal(segunda.lineas.length, 3);
});

test("la fila de saldo inicial no trae asiento: no pertenece a ninguno", () => {
  const mayor = buildMayorDeCuenta(BANCO, [
    mov(5, "2026-04-05", 100, 0, [herm("100001", "Banco", 100, 0, 1)]),
  ]);
  const inicial = mayor.filas[0];

  assert.equal(inicial.kind, "saldo-inicial");
  assert.deepEqual(inicial.lineas, []);
  assert.equal(inicial.lineOrderPropia, null);
  assert.equal(inicial.entryId, null);
});

test("propagar las líneas NO movió ningún saldo", () => {
  // La red contra el riesgo de este cambio: se toca el armado de la fila, y lo
  // único que NO puede cambiar son los números que ya cuadran.
  const hermanas = [
    herm("100001", "Banco General Operativa", 1070, 0, 1),
    herm("100004", "Cuentas por Cobrar Clientes", 0, 1070, 2),
  ];
  const mayor = buildMayorDeCuenta(BANCO, [
    mov(5, "2026-04-05", 1070, 0, hermanas),
    mov(6, "2026-04-20", 0, 351.25, hermanas),
  ]);

  assertMoney(mayor.filas[0].saldo, 14381.27, "saldo inicial");
  assertMoney(mayor.filas[1].saldo, 15451.27, "saldo tras el primer movimiento");
  assertMoney(mayor.filas[2].saldo, 15100.02, "saldo tras el segundo");
  assertMoney(mayor.totales.netoDelPeriodo, 718.75, "neto del período");
  assertMoney(mayor.totales.saldoFinal, 15100.02, "saldo final");
  assert.equal(mayor.cantidadMovimientos, 2);
});

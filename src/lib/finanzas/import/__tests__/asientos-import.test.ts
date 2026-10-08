/**
 * 🔒 IMPORTAR ASIENTOS DESDE EXCEL (7.5): la validación, todo junto y por fila.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADVERTENCIA_GASTO_SIN_PROVEEDOR,
  ENCABEZADOS,
  FORMATO_DE_FECHA_POR_DEFECTO,
  FORMATOS_DE_FECHA,
  fechaEnPalabras,
  parsearFecha,
  parsearMonto,
  validarImportacion,
  type ContextoDeImportacion,
} from "../asientos-import";
import { generarPlantillaDeAsientos, leerHojaDeAsientos } from "../asientos-workbook";
import { leerHojaDeApertura } from "../apertura-workbook";
import * as XLSX from "xlsx";

const ctx = (over: Partial<ContextoDeImportacion> = {}): ContextoDeImportacion => ({
  cuentasExistentes: new Set(["600001", "100001", "4101"]),
  cuentasActivas: new Set(["600001", "100001"]),
  mesesCerrados: new Set(["2026-08"]),
  mesesConPeriodo: new Set(["2026-08", "2026-09"]),
  aniosConPeriodoAutomatico: new Set([2026, 2027]),
  ...over,
});
const H = [...ENCABEZADOS];
// E3: la columna Tercero va entre Cuenta y Descripción de la línea.
const fila = (a: string, f: unknown, d: string, cta: string, deb: unknown, cre: unknown, ref = "", ter = "") =>
  [a, f, d, ref, cta, ter, "", deb, cre];

test("un archivo válido: dos asientos, cuadrados, sin errores", () => {
  const r = validarImportacion(
    [
      H,
      fila("1", "25/09/2026", "Depreciación", "600001", 150, ""),
      fila("1", "25/09/2026", "", "100001", "", 150),
      fila("2", "2026-09-25", "Provisión", "600001", "80,50", ""),
      fila("2", "2026-09-25", "", "100001", "", "80.50"),
    ],
    ctx()
  );
  assert.deepEqual(r.errores, []);
  assert.equal(r.asientos.length, 2);
  assert.equal(r.asientos[1].total, 80.5);
  assert.equal(r.totalDebitos, 230.5);
  assert.equal(r.asientos[0].transaction_date, "2026-09-25");
});

test("🔴 todos los errores juntos, con fila y columna", () => {
  const r = validarImportacion(
    [
      H,
      fila("1", "25/09/2026", "Descuadrado", "600001", 100, ""),
      fila("1", "25/09/2026", "", "100001", "", 90),
      fila("2", "25/09/2026", "Cuenta inactiva", "4101", 10, ""),
      fila("2", "25/09/2026", "", "999999", "", 10),
      fila("3", "15/08/2026", "Mes cerrado", "600001", 5, ""),
      fila("3", "15/08/2026", "", "100001", "", 5),
      fila("4", "25/09/2026", "Débito y crédito", "600001", 5, 5),
      fila("4", "25/09/2026", "", "100001", -5, ""),
    ],
    ctx()
  );
  const msg = r.errores.map((e) => `${e.fila}|${e.columna}|${e.mensaje}`).join("\n");
  assert.match(msg, /^2\|Débito\|El asiento "1" no cuadra: débitos B\/\. 100\.00, créditos B\/\. 90\.00; faltan B\/\. 10\.00 en el crédito\./m);
  assert.match(msg, /^4\|Cuenta\|La cuenta 4101 está desactivada/m);
  assert.match(msg, /^5\|Cuenta\|La cuenta 999999 no existe/m);
  assert.match(msg, /^6\|Fecha\|El mes 08\/2026 está cerrado\./m);
  assert.match(msg, /^8\|Débito\|La línea tiene débito y crédito\. Deja solo uno\./m);
  assert.match(msg, /^9\|Débito\|El monto no puede ser negativo/m);
});

test("montos: positivos con dos decimales; texto basura es ERROR, nunca 0", () => {
  assert.deepEqual(parsearMonto("1.234,56"), { ok: true, valor: 1234.56 });
  assert.deepEqual(parsearMonto("1,234.56"), { ok: true, valor: 1234.56 });
  assert.deepEqual(parsearMonto(12.5), { ok: true, valor: 12.5 });
  assert.equal(parsearMonto("12.345").ok, false, "ambiguo (¿doce mil o doce con tres decimales?): se rechaza, no se adivina");
  assert.equal(parsearMonto(1.005).ok, false, "tres decimales");
  assert.equal(parsearMonto("abc").ok, false);
  assert.equal(parsearMonto("-3").ok, false);
  assert.deepEqual(parsearMonto(""), { ok: true, valor: 0 });
});

test("fechas en DD/MM: DD/MM/AAAA, ISO y serial de Excel; no se adivina MM/DD", () => {
  assert.equal(parsearFecha("25/09/2026", "DD/MM"), "2026-09-25");
  assert.equal(parsearFecha("2026-09-25", "DD/MM"), "2026-09-25");
  assert.equal(parsearFecha(46290, "DD/MM"), "2026-09-25", "serial de Excel");
  assert.equal(parsearFecha("09/25/2026", "DD/MM"), null, "mes 25 no existe: no se adivina MM/DD");
  assert.equal(parsearFecha("31/02/2026", "DD/MM"), null);
});

test("E3, decisión (c): en MM/DD la misma cadena es OTRA fecha, y la imposible es error", () => {
  assert.equal(parsearFecha("09/25/2026", "MM/DD"), "2026-09-25");
  assert.equal(parsearFecha("03/04/2026", "MM/DD"), "2026-03-04", "4 de marzo");
  assert.equal(parsearFecha("03/04/2026", "DD/MM"), "2026-04-03", "3 de abril");
  assert.equal(parsearFecha("13/25/2026", "MM/DD"), null, "mes 13: error de fila, no se adivina");
  // La ISO y el serial no dependen del formato.
  assert.equal(parsearFecha("2026-09-25", "MM/DD"), "2026-09-25");
  assert.equal(parsearFecha(46290, "MM/DD"), "2026-09-25");
});

test("E3: el formato del contexto manda en la validación y el error lo nombra", () => {
  const filas = [H, fila("1", "09/25/2026", "Depreciación", "600001", 10, ""), fila("1", "09/25/2026", "", "100001", "", 10)];
  assert.deepEqual(validarImportacion(filas, ctx({ formatoDeFecha: "MM/DD" })).errores, []);
  const r = validarImportacion(filas, ctx({ formatoDeFecha: "DD/MM" }));
  assert.ok(r.errores.some((e) => e.columna === "Fecha" && /DD\/MM\/AAAA/.test(e.mensaje)));
});

// ---------------------------------------------------------------------------
// E3 (071): EL TERCERO EN LAS CUENTAS CONTROL
// ---------------------------------------------------------------------------

const ctxTerceros = (over: Partial<ContextoDeImportacion> = {}) =>
  ctx({
    cuentasExistentes: new Set(["600001", "100001", "100004", "200001"]),
    cuentasActivas: new Set(["600001", "100001", "100004", "200001"]),
    cuentasControl: new Map([["100004", "clientes"], ["200001", "proveedores"]]),
    clientesPorCodigo: new Map([["CLI-0001", "cli-uuid"]]),
    proveedoresPorCodigo: new Map([["PRV-0001", "prv-uuid"]]),
    ...over,
  });

test("E3: con el código del tercero, la línea lleva el id resuelto", () => {
  const r = validarImportacion(
    [
      H,
      fila("1", "25/09/2026", "Ajuste CxC", "100004", 10, "", "", "cli-0001"),
      fila("1", "25/09/2026", "", "200001", "", 10, "", "PRV-0001"),
    ],
    ctxTerceros()
  );
  assert.deepEqual(r.errores, []);
  assert.equal(r.asientos[0].lines[0].client_id, "cli-uuid", "el código se compara sin mayúsculas");
  assert.equal(r.asientos[0].lines[0].supplier_id, null);
  assert.equal(r.asientos[0].lines[1].supplier_id, "prv-uuid");
});

test("🔴 E3: 100004 sin cliente, 200001 con un CLIENTE y un código inexistente: tres errores en la columna Tercero", () => {
  const r = validarImportacion(
    [
      H,
      fila("1", "25/09/2026", "Ajuste", "100004", 10, ""),
      fila("1", "25/09/2026", "", "200001", "", 10, "", "CLI-0001"),
      fila("2", "25/09/2026", "Otro", "600001", 5, "", "", "CLI-9999"),
      fila("2", "25/09/2026", "", "100001", "", 5),
    ],
    ctxTerceros()
  );
  const msg = r.errores.map((e) => `${e.fila}|${e.columna}|${e.mensaje}`).join("\n");
  assert.match(msg, /^2\|Tercero\|La cuenta 100004 es de clientes/m);
  assert.match(msg, /^3\|Tercero\|La cuenta 200001 es de proveedores/m);
  assert.match(msg, /^4\|Tercero\|No hay ningún cliente ni proveedor con el código CLI-9999/m);
});

test("E3: en una cuenta que no es de control el tercero es opcional", () => {
  const r = validarImportacion(
    [H, fila("1", "25/09/2026", "Depreciación", "600001", 10, ""), fila("1", "25/09/2026", "", "100001", "", 10)],
    ctxTerceros()
  );
  assert.deepEqual(r.errores, []);
  assert.equal(r.asientos[0].lines[0].client_id, null);
});

test("las filas de un asiento tienen que estar juntas", () => {
  const r = validarImportacion(
    [
      H,
      fila("1", "25/09/2026", "A", "600001", 10, ""),
      fila("2", "25/09/2026", "B", "600001", 5, ""),
      fila("2", "25/09/2026", "", "100001", "", 5),
      fila("1", "25/09/2026", "", "100001", "", 10),
    ],
    ctx()
  );
  assert.ok(r.errores.some((e) => e.fila === 5 && /tienen que estar juntas/.test(e.mensaje)));
});

test("asiento de una sola línea y sin descripción: rechazados", () => {
  const r = validarImportacion([H, fila("1", "25/09/2026", "", "600001", 10, "")], ctx());
  const m = r.errores.map((e) => e.mensaje).join(" ");
  assert.match(m, /una sola línea/);
  assert.match(m, /descripción de al menos 3/);
});

test("un año sin período automático ni cargado: rechazado", () => {
  const r = validarImportacion(
    [H, fila("1", "10/01/2030", "Futuro", "600001", 1, ""), fila("1", "10/01/2030", "", "100001", "", 1)],
    ctx()
  );
  assert.ok(r.errores.some((e) => /No hay período contable abierto para 01\/2030/.test(e.mensaje)));
});

test("encabezados que faltan: un solo error que dice cuáles", () => {
  const r = validarImportacion([["Fecha", "Cuenta"], ["25/09/2026", "600001"]], ctx());
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0].mensaje, /asiento, descripcion del asiento, debito, credito/);
});

test("la plantilla se vuelve a leer: el ejemplo trae la cuenta vacía y lo dice", () => {
  const buf = Buffer.from(generarPlantillaDeAsientos([{ code: "600001", name: "Gasto", account_type: "expense" }]));
  const matriz = leerHojaDeAsientos(buf);
  // El ejemplo de la plantilla viene en DD/MM, el formato por defecto (08/10/2026).
  const r = validarImportacion(matriz, ctx({ formatoDeFecha: FORMATO_DE_FECHA_POR_DEFECTO }));
  assert.equal(r.asientos.length, 2, "dos asientos de ejemplo");
  assert.ok(r.errores.every((e) => e.columna === "Cuenta" && /Falta la cuenta/.test(e.mensaje)));
});

test("🔒 el commit re-lee el archivo, exige el hash de la vista previa y postea en lote", () => {
  const raiz = path.resolve(__dirname, "../../../../..");
  const api = readFileSync(path.join(raiz, "src/lib/finanzas/api/importacion-asientos.ts"), "utf8");
  const ruta = readFileSync(path.join(raiz, "src/app/api/finanzas/asientos/importar/route.ts"), "utf8");
  assert.match(api, /hash !== hashDeLaVistaPrevia/);
  assert.match(api, /rpc\("post_journal_entries_batch"/);
  assert.doesNotMatch(api, /postJournalEntry\(/, "nunca un posteo por asiento desde la app");
  assert.match(api, /construirAsientoDeReversion\(/, "deshacer usa la misma función que todas las reversiones");
  assert.doesNotMatch(api, /MAX_LINEAS_MANUALES/, "el tope del formulario no es del importador");
  assert.match(ruta, /\["admin", "contador"\]/, "los mismos roles que el asiento manual");
});

test("🔴 K-5: un asiento con fecha posterior a hoy es error de la fila (Josuarth, 02/10)", () => {
  const filas = [
    H,
    fila("1", "28/09/2026", "Futuro", "600001", 10, ""),
    fila("1", "28/09/2026", "", "100001", "", 10),
  ];
  const r = validarImportacion(filas, ctx({ hoy: "2026-09-25" }));
  assert.equal(r.errores.length, 1);
  assert.equal(r.errores[0].columna, "Fecha");
  assert.match(r.errores[0].mensaje, /posterior a hoy \(25\/09\/2026\)/);
  // El mismo día de hoy, sin error.
  assert.deepEqual(validarImportacion(filas, ctx({ hoy: "2026-09-28" })).errores, []);
});

test("🔴 098: un mes contabilizado desde los documentos del CRM no se importa, y lo dice con la fecha", () => {
  const filas = [H, fila("1", "25/09/2026", "Depreciación", "600001", 150, ""), fila("1", "25/09/2026", "", "100001", "", 150)];
  const r = validarImportacion(filas, ctx({ mesesDesdeDocumentos: new Map([["2026-09", "07/10/2026"]]) }));
  assert.deepEqual(
    r.errores.map((e) => [e.fila, e.columna, e.mensaje]),
    [[2, "Fecha", "Este mes ya se contabilizó desde los documentos del CRM el 07/10/2026. No se importan asientos de documentos para ese período."]]
  );
  // Otro mes, el mismo archivo: entra.
  assert.deepEqual(validarImportacion(filas, ctx({ mesesDesdeDocumentos: new Map([["2026-07", "07/10/2026"]]) })).errores, []);
});

test("098: el bloqueo es SÓLO de la importación masiva; el asiento de ajuste a mano no lo mira", () => {
  const raiz = process.cwd();
  const importacion = readFileSync(path.join(raiz, "src/lib/finanzas/api/importacion-asientos.ts"), "utf8");
  assert.match(importacion, /from\("posteos_retroactivos"\)/);
  for (const manual of ["src/lib/finanzas/api/asientos.ts", "src/app/api/finanzas/asientos/route.ts"]) {
    const fuente = readFileSync(path.join(raiz, manual), "utf8");
    assert.doesNotMatch(fuente, /posteos_retroactivos|mesesDesdeDocumentos/, `${manual} no debe bloquear los ajustes a mano`);
  }
});

// ---------------------------------------------------------------------------
// 07/10/2026: GASTO O COSTO SIN PROVEEDOR = ADVERTENCIA, NO ERROR
// ---------------------------------------------------------------------------

test("🔴 una línea de gasto o costo sin proveedor se ADVIERTE con su fila, y la importación no se bloquea", () => {
  const r = validarImportacion(
    [
      H,
      fila("1", "25/09/2026", "Útiles", "600001", 10, "", "", "PRV-0001"), // 2: con proveedor
      fila("1", "25/09/2026", "", "100001", "", 10), // 3: banco, no es gasto
      fila("2", "25/09/2026", "Mensajería", "600001", 5, ""), // 4: sin tercero
      fila("2", "25/09/2026", "", "100001", "", 5),
      fila("3", "25/09/2026", "Costo", "500001", 7, "", "", "CLI-0001"), // 6: un CLIENTE no es proveedor
      fila("3", "25/09/2026", "", "100001", "", 7),
    ],
    ctxTerceros({
      cuentasExistentes: new Set(["600001", "500001", "100001", "100004", "200001"]),
      cuentasActivas: new Set(["600001", "500001", "100001", "100004", "200001"]),
      cuentasDeGasto: new Set(["600001", "500001"]),
    })
  );
  assert.deepEqual(r.errores, [], "no bloquea");
  assert.equal(r.asientos.length, 3);
  assert.deepEqual(
    r.advertencias.map((a) => [a.fila, a.columna, a.mensaje]),
    [
      [4, "Tercero", ADVERTENCIA_GASTO_SIN_PROVEEDOR],
      [6, "Tercero", ADVERTENCIA_GASTO_SIN_PROVEEDOR],
    ]
  );
  assert.equal(ADVERTENCIA_GASTO_SIN_PROVEEDOR, "Esta línea no tiene proveedor: no saldrá en el anexo de compras.");
});

test("un código de tercero inexistente en un gasto es ERROR, no también advertencia", () => {
  const r = validarImportacion(
    [H, fila("1", "25/09/2026", "Útiles", "600001", 10, "", "", "PRV-9999"), fila("1", "25/09/2026", "", "100001", "", 10)],
    ctxTerceros({ cuentasDeGasto: new Set(["600001"]) })
  );
  assert.equal(r.errores.length, 1);
  assert.deepEqual(r.advertencias, []);
});

test("las advertencias se ven en la vista previa y el contexto real carga las cuentas de gasto y costo", () => {
  const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const ui = leer("src/app/finanzas/asientos/importar/_components/importar-asientos.tsx");
  assert.match(ui, /vista\?\.resultado\.advertencias/);
  assert.match(ui, /advertencias\.map\(\(a, i\) => \(/);
  assert.match(ui, /\{a\.fila\}/);
  const api = leer("src/lib/finanzas/api/importacion-asientos.ts");
  assert.match(api, /c\.account_type === "expense" \|\| c\.account_type === "cost"/);
  assert.match(api, /cuentasDeGasto,/);
});

// ---------------------------------------------------------------------------
// 08/10/2026: FORMATO DE FECHA. DD/MM por defecto, CSV sin conversión de la
// librería, celdas de fecha de Excel (con hora) y la fecha leída en la vista previa.
// ---------------------------------------------------------------------------

test("el formato por defecto es DD/MM/AAAA y va primero en el selector", () => {
  assert.equal(FORMATO_DE_FECHA_POR_DEFECTO, "DD/MM");
  assert.equal(FORMATOS_DE_FECHA[0], "DD/MM");
  const ui = readFileSync(path.join(process.cwd(), "src/app/finanzas/asientos/importar/_components/importar-asientos.tsx"), "utf8");
  assert.ok(ui.indexOf('value="DD/MM"') < ui.indexOf('value="MM/DD"'), "DD/MM es la primera opción");
});

test("03/04/2026 en texto: 3 de abril en DD/MM y 4 de marzo en MM/DD", () => {
  const filas = (f: string) => [H, fila("1", f, "Prueba", "600001", 10, ""), fila("1", f, "", "100001", "", 10)];
  const dd = validarImportacion(filas("03/04/2026"), ctx({ formatoDeFecha: "DD/MM", mesesConPeriodo: new Set(["2026-03", "2026-04"]) }));
  const mm = validarImportacion(filas("03/04/2026"), ctx({ formatoDeFecha: "MM/DD", mesesConPeriodo: new Set(["2026-03", "2026-04"]) }));
  assert.equal(dd.asientos[0].transaction_date, "2026-04-03");
  assert.equal(mm.asientos[0].transaction_date, "2026-03-04");
  // La vista previa muestra la fecha leída en palabras y cómo venía en el archivo.
  assert.equal(fechaEnPalabras(dd.asientos[0].transaction_date), "3 de abril de 2026");
  assert.equal(fechaEnPalabras(mm.asientos[0].transaction_date), "4 de marzo de 2026");
  assert.equal(dd.asientos[0].fecha_en_archivo, "03/04/2026");
});

test("celda de fecha de Excel: no depende del formato, y la hora no corre el día", () => {
  // 46085 = 04/03/2026; con 18:00 (0,75) antes se redondeaba al 05/03.
  for (const f of ["DD/MM", "MM/DD"] as const) {
    assert.equal(parsearFecha(46085, f), "2026-03-04");
    assert.equal(parsearFecha(46085.75, f), "2026-03-04");
    assert.equal(parsearFecha(46085.25, f), "2026-03-04");
  }
  const r = validarImportacion([H, fila("1", 46085.75, "Prueba", "600001", 10, ""), fila("1", 46085.75, "", "100001", "", 10)],
    ctx({ mesesConPeriodo: new Set(["2026-03"]) }));
  assert.equal(r.asientos[0].fecha_en_archivo, "celda de fecha de Excel");
});

test("un .xlsx real: celda de fecha y texto se leen distinto, y el texto respeta el formato", () => {
  const ws = XLSX.utils.aoa_to_sheet([H, ["1", "03/04/2026", "Texto", "", "600001", "", "", 10, ""]]);
  ws["B3"] = { t: "n", v: 46085, z: "dd/mm/yyyy" }; // celda con formato de fecha
  ws["!ref"] = "A1:I3";
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Asientos");
  const m = leerHojaDeAsientos(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  assert.equal(m[1][1], "03/04/2026");
  assert.equal(m[2][1], 46085);
  assert.equal(parsearFecha(m[1][1], "DD/MM"), "2026-04-03");
  assert.equal(parsearFecha(m[2][1], "DD/MM"), "2026-03-04");
});

const NL = String.fromCharCode(10);

test("un CSV: «03/04/2026» llega como TEXTO (antes la librería lo volvía 4 de marzo sin mirar el formato)", () => {
  // Con BOM, como lo guarda Excel en «CSV UTF-8».
  const csv = Buffer.from(String.fromCharCode(0xfeff) + [H.join(","), "1,03/04/2026,Prueba,,600001,,,10,", "1,03/04/2026,,,100001,,,,10"].join(NL));
  const m = leerHojaDeAsientos(csv);
  assert.equal(m[1][1], "03/04/2026");
  const r = validarImportacion(m, ctx({ formatoDeFecha: "DD/MM", mesesConPeriodo: new Set(["2026-04"]) }));
  assert.deepEqual(r.errores, []);
  assert.equal(r.asientos[0].transaction_date, "2026-04-03");
  assert.equal(r.asientos[0].total, 10);
  // La apertura lee igual.
  assert.equal(leerHojaDeApertura(Buffer.from(["Cuenta,Fecha del documento", "100004,03/04/2026"].join(NL)))[1][1], "03/04/2026");
});

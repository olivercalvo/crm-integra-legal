/**
 * 🔒 ASIENTO DE APERTURA (100/101).
 *
 * Fija: la validación de la plantilla (cuadre, tercero y documento en las
 * cuentas control, cuentas existentes y activas, sólo balance al 31/12), la
 * plantilla que se baja y se vuelve a leer igual, el cuadre al corte, las
 * partidas de apertura por documento en la antigüedad, que los reportes dejan
 * de sumar `saldo_inicial` con apertura (en las tres fuentes), y que la
 * reversión lleva SIEMPRE la fecha de la apertura.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  AVISO_FUENTE_DE_LA_APERTURA,
  ENCABEZADOS_APERTURA,
  cuadreAlCorte,
  esCierreDelAnio,
  saldosDeLasLineas,
  validarApertura,
  type ContextoDeApertura,
} from "../apertura";
import { generarPlantillaDeApertura, leerHojaDeApertura } from "@/lib/finanzas/import/apertura-workbook";
import { partidasDeApertura, partidasDeDiario } from "@/lib/finanzas/reports/partidas-de-diario";
import { saldoInicialEfectivo } from "@/lib/finanzas/reports/apertura-registrada";

// Los ejemplos de este archivo escriben las fechas como texto DD/MM/AAAA: se lo
// dice el contexto, como lo elige la persona en la pantalla.
const ctx = (fecha = "2026-06-30"): ContextoDeApertura => ({
  formatoDeFecha: "DD/MM",
  fechaApertura: fecha,
  cuentas: new Map([
    ["100001", { code: "100001", name: "Banco", account_type: "asset", active: true, cuenta_control: null }],
    ["100004", { code: "100004", name: "Cuentas por cobrar", account_type: "asset", active: true, cuenta_control: "clientes" }],
    ["200001", { code: "200001", name: "Cuentas por pagar", account_type: "liability", active: true, cuenta_control: "proveedores" }],
    ["300002", { code: "300002", name: "Resultados acumulados", account_type: "equity", active: true, cuenta_control: null }],
    ["400001", { code: "400001", name: "Honorarios", account_type: "income", active: true, cuenta_control: null }],
    ["3101", { code: "3101", name: "Capital viejo", account_type: "equity", active: false, cuenta_control: null }],
  ]),
  clientes: new Map([
    ["CLI-012", { id: "c12", nombre: "Cliente Doce", dePrueba: false }],
    ["0TEST-FE-001", { id: "t1", nombre: "Prueba", dePrueba: true }],
  ]),
  proveedores: new Map([["PRV-004", { id: "p4", nombre: "Proveedor Cuatro" }]]),
});
const H = [...ENCABEZADOS_APERTURA];
const fila = (cta: string, ter: string, doc: string, f: unknown, deb: unknown, cre: unknown, vence: unknown = "") => [cta, ter, doc, f, vence, deb, cre];

const EJEMPLO = [
  H,
  fila("100004", "CLI-012", "FAC-HON-000398", "15/05/2026", 1070, ""),
  fila("200001", "PRV-004", "F-88231", "28/06/2026", "", 214),
  fila("100001", "", "", "", 5000, ""),
  fila("300002", "", "", "", "", 5856),
];

test("el ejemplo del diseño valida y cuadra", () => {
  const r = validarApertura(EJEMPLO, ctx());
  assert.deepEqual(r.errores, []);
  assert.equal(r.totalDebitos, 6070);
  assert.equal(r.totalCreditos, 6070);
  assert.equal(r.lineas[0].client_id, "c12");
  assert.equal(r.lineas[0].fecha_documento, "2026-05-15");
  assert.equal(r.lineas[1].supplier_id, "p4");
});

test("🔴 errores con fila y columna: descuadre, tercero y documento, cuenta inactiva, cliente de prueba", () => {
  const r = validarApertura(
    [
      H,
      fila("100004", "", "", "", 100, ""),
      fila("200001", "CLI-012", "F-1", "01/06/2026", "", 50),
      fila("3101", "", "", "", "", 10),
      fila("100004", "0TEST-FE-001", "X-1", "10/07/2026", 5, ""),
      fila("9999", "", "", "", 1, 1),
    ],
    ctx()
  );
  const msgs = r.errores.map((e) => `${e.fila}|${e.columna}`);
  for (const esperado of [
    "2|Tercero", "2|Documento externo", "2|Fecha del documento",
    "3|Tercero",
    "4|Cuenta",
    "5|Tercero", "5|Fecha del documento",
    "6|Cuenta", "6|Débito",
    "1|Débito",
  ]) assert.ok(msgs.includes(esperado), `falta ${esperado}: ${msgs.join(", ")}`);
});

test("al 31/12 (cierre del año) sólo cuentas de balance; a mitad de año las de resultado entran", () => {
  assert.equal(esCierreDelAnio("2025-12-31"), true);
  assert.equal(esCierreDelAnio("2026-06-30"), false);
  const conResultado = [...EJEMPLO.slice(0, 4), fila("400001", "", "", "", "", 1000), fila("300002", "", "", "", "", 4856)];
  assert.deepEqual(validarApertura(conResultado, ctx("2026-06-30")).errores, []);
  const r = validarApertura(
    conResultado.map((f, i) => (i === 1 ? fila("100004", "CLI-012", "FAC-HON-000398", "15/12/2025", 1070, "") : i === 2 ? fila("200001", "PRV-004", "F-88231", "20/12/2025", "", 214) : f)),
    ctx("2025-12-31")
  );
  assert.ok(r.errores.some((e) => e.columna === "Cuenta" && /sólo cuentas de balance/.test(e.mensaje)));
});

test("el mismo documento del mismo tercero dos veces: error", () => {
  const r = validarApertura([...EJEMPLO, fila("100004", "CLI-012", "FAC-HON-000398", "15/05/2026", 1, ""), fila("300002", "", "", "", "", 1)], ctx());
  assert.ok(r.errores.some((e) => /repetido/.test(e.mensaje)));
});

test("la plantilla precargada se vuelve a leer igual (fechas incluidas) y lleva el aviso de la fuente", () => {
  const buf = generarPlantillaDeApertura({
    fechaApertura: "2026-06-30",
    inicioContable: "2026-07-01",
    cuentas: [{ code: "100004", name: "CxC", account_type: "asset", cuenta_control: "clientes" }],
    clientes: [{ codigo: "CLI-012", nombre: "Cliente Doce" }],
    proveedores: [],
    precarga: [{ cuenta: "100004", tercero: "CLI-012", documento: "FAC-HON-000398", fecha: "2026-05-15", vencimiento: "2026-06-14", debito: 1070, credito: 0 }],
  });
  const m = leerHojaDeApertura(Buffer.from(buf));
  assert.deepEqual(m[0], H);
  const r = validarApertura([...m, fila("300002", "", "", "", "", 1070)], ctx());
  assert.deepEqual(r.errores, []);
  assert.equal(r.lineas[0].fecha_documento, "2026-05-15");
  assert.equal(r.lineas[0].vencimiento, "2026-06-14");
  assert.match(AVISO_FUENTE_DE_LA_APERTURA, /QuickBooks/);
  assert.match(AVISO_FUENTE_DE_LA_APERTURA, /ayuda/);
  const vacia = leerHojaDeApertura(Buffer.from(generarPlantillaDeApertura({
    fechaApertura: "2026-06-30", inicioContable: "2026-07-01", cuentas: [], clientes: [], proveedores: [], precarga: [],
  })));
  assert.equal(vacia.length, 1);
});

test("cuadre al corte: por tercero y por documento, con su estado", () => {
  const r = validarApertura(EJEMPLO, ctx());
  const apertura = saldosDeLasLineas(r.lineas, ctx().cuentas);
  const c = cuadreAlCorte(apertura, [
    { lado: "cliente", terceroId: "c12", terceroCodigo: "CLI-012", terceroNombre: "Cliente Doce", documento: "FAC-HON-000398", fecha: "2026-05-15", saldo: 1070 },
    { lado: "cliente", terceroId: "c99", terceroCodigo: "CLI-099", terceroNombre: "Otro", documento: "FAC-HON-000400", fecha: "2026-06-01", saldo: 50 },
  ]);
  const por = Object.fromEntries(c.filas.map((f) => [f.terceroId, f]));
  assert.equal(por.c12.estado, "cuadra");
  assert.equal(por.c99.estado, "solo_en_el_crm");
  assert.equal(por.p4.estado, "solo_en_la_apertura");
  assert.equal(por.p4.segunApertura, 214);
  assert.deepEqual(c.totales.cliente, { segunApertura: 1070, segunCrm: 1120, diferencia: -50 });
});

test("antigüedad: la apertura cuenta por documento, con su vencimiento, y no dos veces", () => {
  const p = {
    id: "x1", entryId: "e1", referencia: "AD-000001", cuenta: "cobrar" as const, terceroId: "c12", terceroNombre: "Cliente Doce",
    documento: "FAC-HON-000398", fechaDocumento: "2026-05-15", vencimiento: "2026-06-14", fechaApertura: "2026-06-30", debit: 1070, credit: 0,
  };
  const docs = partidasDeApertura([p], "cobrar", new Set(), new Date("2026-07-14T12:00:00"));
  assert.equal(docs.length, 1);
  assert.equal(docs[0].fechaReferencia, "2026-06-14");
  assert.equal(docs[0].diasVencido, 30);
  assert.equal(docs[0].numero, "FAC-HON-000398 (apertura)");
  assert.equal(partidasDeApertura([p], "cobrar", new Set(["e1"])).length, 0, "una apertura reversada no cuenta");
  // La misma línea del libro no se cuenta otra vez como partida de diario.
  const linea = { entryId: "e1", entryNumber: 1, sourceType: "apertura", fecha: "2026-06-30", referencia: "AD-000001", debit: 1070,
    credit: 0, clientId: "c12", supplierId: null, terceroNombre: "Cliente Doce" };
  assert.equal(partidasDeDiario([linea], "cobrar", new Set(), new Date(), new Set(["e1"])).length, 0);
  assert.equal(partidasDeDiario([linea], "cobrar", new Set()).length, 1);
});

test("con apertura el saldo_inicial deja de contar, en las tres fuentes", () => {
  assert.equal(saldoInicialEfectivo("191947.55", false), 191947.55);
  assert.equal(saldoInicialEfectivo("191947.55", true), 0);
  for (const f of ["accounting-source.ts", "libro-mayor-source.ts", "antiguedad-source.ts"]) {
    const s = readFileSync(path.join(process.cwd(), "src/lib/finanzas/reports", f), "utf8");
    assert.match(s, /saldoInicialEfectivo\(/, `${f} no pasa por saldoInicialEfectivo`);
    assert.doesNotMatch(s, /Number\(\s*(r|c)\.saldo_inicial/, `${f} vuelve a sumar saldo_inicial directo`);
  }
});

test("🔴 la reversión de la apertura lleva SIEMPRE la fecha de la apertura", () => {
  const s = readFileSync(path.join(process.cwd(), "src/lib/finanzas/api/apertura.ts"), "utf8");
  const i = s.indexOf("export async function reversarApertura");
  const cuerpo = s.slice(i, s.indexOf("\n}\n", i));
  assert.match(cuerpo, /fecha: original\.transaction_date/);
  assert.match(cuerpo, /if \(!estado\.mesAbierto\)/);
  assert.doesNotMatch(cuerpo, /resolverFechaDeRegistro|hoyEnPanama/);
  const m = readFileSync(path.join(process.cwd(), "sql/pending/101_reversar_apertura.sql"), "utf8");
  assert.match(m, /p_transaction_date <> v_orig_date/);
});

test("08/10/2026: la fecha escrita como texto se lee con el formato elegido; por defecto MM/DD (decisión (c))", () => {
  const archivo = [
    [...ENCABEZADOS_APERTURA],
    ["100004", "CLI-012", "FAC-1", "05/03/2026", "", 100, ""],
    ["300002", "", "", "", "", "", 100],
  ];
  const sinFormato = { ...ctx(), formatoDeFecha: undefined };
  assert.equal(validarApertura(archivo, sinFormato).lineas[0].fecha_documento, "2026-05-03", "por defecto MM/DD: 3 de mayo");
  assert.equal(validarApertura(archivo, ctx()).lineas[0].fecha_documento, "2026-03-05", "DD/MM: 5 de marzo");
  const imposible = [...archivo.slice(0, 1), ["100004", "CLI-012", "FAC-1", "25/03/2026", "", 100, ""], archivo[2]];
  const r = validarApertura(imposible, sinFormato);
  assert.ok(r.errores.some((e) => e.columna === "Fecha del documento" && /MM\/DD\/AAAA/.test(e.mensaje)));
  // La pantalla ofrece el selector y manda el formato en la revisión y al contabilizar.
  const panel = readFileSync(path.join(process.cwd(), "src/app/finanzas/asientos/apertura/_components/apertura-panel.tsx"), "utf8");
  assert.match(panel, /fd\.append\("date_format", formato\)/);
  assert.ok(panel.indexOf('value="MM/DD"') < panel.indexOf('value="DD/MM"'));
});

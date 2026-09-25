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
  ENCABEZADOS,
  parsearFecha,
  parsearMonto,
  validarImportacion,
  type ContextoDeImportacion,
} from "../asientos-import";
import { generarPlantillaDeAsientos, leerHojaDeAsientos } from "../asientos-workbook";

const ctx = (over: Partial<ContextoDeImportacion> = {}): ContextoDeImportacion => ({
  cuentasExistentes: new Set(["600001", "100001", "4101"]),
  cuentasActivas: new Set(["600001", "100001"]),
  mesesCerrados: new Set(["2026-08"]),
  mesesConPeriodo: new Set(["2026-08", "2026-09"]),
  aniosConPeriodoAutomatico: new Set([2026, 2027]),
  ...over,
});
const H = [...ENCABEZADOS];
const fila = (a: string, f: unknown, d: string, cta: string, deb: unknown, cre: unknown, ref = "") =>
  [a, f, d, ref, cta, "", deb, cre];

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

test("fechas: DD/MM/AAAA, ISO y serial de Excel; nunca MM/DD", () => {
  assert.equal(parsearFecha("25/09/2026"), "2026-09-25");
  assert.equal(parsearFecha("2026-09-25"), "2026-09-25");
  assert.equal(parsearFecha(46290), "2026-09-25", "serial de Excel");
  assert.equal(parsearFecha("09/25/2026"), null, "mes 25 no existe: no se adivina MM/DD");
  assert.equal(parsearFecha("31/02/2026"), null);
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
  const r = validarImportacion(matriz, ctx());
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

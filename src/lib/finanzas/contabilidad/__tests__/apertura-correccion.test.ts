/**
 * 🔒 CORREGIR LA APERTURA (102).
 *
 * Fija: la tabla editable se valida con la MISMA regla del Excel
 * (`validarApertura`), con el número de línea de la pantalla; «sin cambios» se
 * detecta; la corrección va por UNA función de la base que reversa y postea en
 * la misma transacción (nunca dos llamadas desde la app) y usa el MISMO espejo
 * que «Reversar la apertura».
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  firmaDeLasLineas,
  matrizDeFilasEditables,
  validarApertura,
  validarFilasEditables,
  ENCABEZADOS_APERTURA,
  type ContextoDeApertura,
  type FilaEditableDeApertura,
} from "../apertura";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const ctx = (fecha = "2025-12-31"): ContextoDeApertura => ({
  fechaApertura: fecha,
  cuentas: new Map([
    ["100001", { code: "100001", name: "Banco", account_type: "asset", active: true, cuenta_control: null }],
    ["100004", { code: "100004", name: "Cuentas por cobrar", account_type: "asset", active: true, cuenta_control: "clientes" }],
    ["200001", { code: "200001", name: "Cuentas por pagar", account_type: "liability", active: true, cuenta_control: "proveedores" }],
    ["300002", { code: "300002", name: "Resultados acumulados", account_type: "equity", active: true, cuenta_control: null }],
    ["400001", { code: "400001", name: "Honorarios", account_type: "income", active: true, cuenta_control: null }],
  ]),
  clientes: new Map([["CLI-012", { id: "c12", nombre: "Cliente Doce", dePrueba: false }]]),
  proveedores: new Map([["PRV-004", { id: "p4", nombre: "Proveedor Cuatro" }]]),
});

const f = (cuenta: string, debito: number, credito: number, extra: Partial<FilaEditableDeApertura> = {}): FilaEditableDeApertura => ({
  cuenta, tercero: "", documento: "", fecha: "", vencimiento: "", debito, credito, ...extra,
});

const VIGENTE: FilaEditableDeApertura[] = [
  f("100004", 100000, 0, { tercero: "CLI-012", documento: "QB-1", fecha: "2025-11-30", vencimiento: "2026-01-15" }),
  f("200001", 0, 5000, { tercero: "PRV-004", documento: "F-9", fecha: "2025-12-20" }),
  f("100001", 5000, 0),
  f("300002", 0, 100000),
];

test("la tabla es la plantilla: mismas columnas, y valida igual que el Excel", () => {
  const m = matrizDeFilasEditables(VIGENTE);
  assert.deepEqual(m[0], [...ENCABEZADOS_APERTURA]);
  const porExcel = validarApertura(m, ctx());
  const porTabla = validarFilasEditables(VIGENTE, ctx());
  assert.deepEqual(porTabla.errores, []);
  assert.equal(porTabla.totalDebitos, porExcel.totalDebitos);
  assert.deepEqual(porTabla.lineas.map((l) => l.client_id), porExcel.lineas.map((l) => l.client_id));
  assert.equal(porTabla.lineas[0].fecha_documento, "2025-11-30");
});

test("CxC de 100,000 a 90,000 con la diferencia al banco: cuadra", () => {
  const corregida = VIGENTE.map((x, i) => (i === 0 ? { ...x, debito: 90000 } : i === 2 ? { ...x, debito: 15000 } : x));
  const r = validarFilasEditables(corregida, ctx());
  assert.deepEqual(r.errores, []);
  assert.equal(r.totalDebitos, 105000);
});

test("🔴 los errores llevan la LÍNEA de la pantalla, y 0 lo que es de toda la apertura", () => {
  const r = validarFilasEditables(
    [VIGENTE[0], f("100004", 10, 0, { tercero: "CLI-012", fecha: "2025-12-01" }), f("400001", 0, 10), ...VIGENTE.slice(1)],
    ctx()
  );
  const lugares = r.errores.map((e) => `${e.fila}|${e.columna}`);
  assert.ok(lugares.includes("2|Documento externo"), lugares.join(", "));
  assert.ok(lugares.includes("3|Cuenta"), "al 31/12 sólo balance: " + lugares.join(", "));
  // Descuadre (los 10 de la línea 3 no entran por ser de resultado, pero suman): general.
  const sinResultado = validarFilasEditables([VIGENTE[0], ...VIGENTE.slice(1, 3), f("300002", 0, 99000)], ctx());
  assert.ok(sinResultado.errores.some((e) => e.fila === 0 && /No cuadra/.test(e.mensaje)));
});

test("una fila vacía (línea quitada a medias) no corre la numeración", () => {
  const r = validarFilasEditables([VIGENTE[0], f("", 0, 0), f("100004", 1, 0), ...VIGENTE.slice(1)], ctx());
  assert.ok(r.errores.some((e) => e.fila === 3 && e.columna === "Tercero"));
});

test("«sin cambios»: la firma no cambia si nada de lo que va al libro cambia", () => {
  const c = ctx();
  const a = validarFilasEditables(VIGENTE, c).lineas;
  // La fecha de una línea sin tercero ni documento no se guarda: no es un cambio.
  const b = validarFilasEditables(VIGENTE.map((x, i) => (i === 2 ? { ...x, fecha: "2025-12-01" } : x)), c).lineas;
  assert.equal(firmaDeLasLineas(a, c.cuentas), firmaDeLasLineas(b, c.cuentas));
  const d = validarFilasEditables(VIGENTE.map((x, i) => (i === 0 ? { ...x, vencimiento: "2026-02-01" } : x)), c).lineas;
  assert.notEqual(firmaDeLasLineas(a, c.cuentas), firmaDeLasLineas(d, c.cuentas));
});

test("🔴 una sola transacción en la base, con el espejo de «Reversar» y la regla de post_apertura", () => {
  const api = leer("src/lib/finanzas/api/apertura.ts");
  const corregir = api.slice(api.indexOf("export async function corregirApertura"));
  assert.match(corregir, /rpc\("corregir_apertura"/);
  assert.doesNotMatch(corregir, /rpc\("(reverse_journal_entry|post_apertura)"/, "dos llamadas desde la app dejarían una apertura a medias");
  assert.match(corregir, /espejoDeLaApertura\(/);
  assert.match(api.slice(api.indexOf("export async function reversarApertura")), /espejoDeLaApertura\(/);
  // El commit exige el hash de «Revisar».
  assert.match(corregir, /hashDeLaVistaPrevia/);

  const sql = leer("sql/pending/102_corregir_apertura.sql");
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.corregir_apertura\([^)]*\) TO service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.corregir_apertura\([^)]*\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /public\.reverse_journal_entry\(/);
  assert.match(sql, /public\.post_apertura\(/);
});

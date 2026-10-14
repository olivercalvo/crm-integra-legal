/**
 * 🔒 UN GASTO DE TRÁMITE EN EL LIBRO NO SE EDITA NI SE ELIMINA (14/10/2026).
 *
 * Fija: qué cambios se rechazan (monto, concepto, fechas; un N.º de factura ya
 * cargado) y cuáles siguen (comprobante, completar el N.º vacío, el mismo valor);
 * que la ruta responde 409 con el mensaje de la pantalla y nunca 500; que el
 * DELETE mira el libro ANTES de borrar el comprobante; y que la pantalla no abre
 * el formulario con el gasto en el libro.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_EDITA,
  cambiaNumeroDeFacturaCargado,
  tocaCamposCongelados,
} from "../gasto-tramite-en-el-libro";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const ACTUAL = { amount: "100.00", concept: "Copias", date: "2026-10-01", accounting_date: "2026-10-01" };

test("el mensaje es el pedido, sin guion largo", () => {
  assert.equal(
    MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_EDITA,
    "Este gasto ya está en el libro contable y no se edita. Si hay un error, el contador lo corrige con un asiento de diario."
  );
  assert.doesNotMatch(MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_EDITA, /—/);
});

test("monto, concepto y fechas: tocarlos es un cambio congelado", () => {
  assert.equal(tocaCamposCongelados(ACTUAL, { amount: 120 }), true);
  assert.equal(tocaCamposCongelados(ACTUAL, { concept: "Otra cosa" }), true);
  assert.equal(tocaCamposCongelados(ACTUAL, { date: "2026-10-02" }), true);
  assert.equal(tocaCamposCongelados(ACTUAL, { accounting_date: "2026-10-03" }), true);
});

test("el comprobante solo, o los mismos valores, no son un cambio congelado", () => {
  assert.equal(tocaCamposCongelados(ACTUAL, {}), false, "el alta adjunta el comprobante con un PATCH sin estos campos");
  assert.equal(tocaCamposCongelados(ACTUAL, { amount: 100, concept: " Copias ", date: "2026-10-01" }), false);
});

test("el N.º de factura: completarlo si estaba vacío sí; cambiar uno cargado no", () => {
  assert.equal(cambiaNumeroDeFacturaCargado(null, "F-1"), false);
  assert.equal(cambiaNumeroDeFacturaCargado("F-1", undefined), false);
  assert.equal(cambiaNumeroDeFacturaCargado("F-1", "F-1"), false);
  assert.equal(cambiaNumeroDeFacturaCargado("F-1", "F-2"), true);
  assert.equal(cambiaNumeroDeFacturaCargado("F-1", ""), true);
});

test("🔒 la ruta: 409 con el gasto en el libro, y el DELETE mira el libro ANTES de borrar el comprobante", () => {
  const r = leer("src/app/api/expenses/[id]/route.ts");
  const patch = r.slice(r.indexOf("export const PATCH"), r.indexOf("export const DELETE"));
  const del = r.slice(r.indexOf("export const DELETE"));
  assert.ok(patch.indexOf("gastosConAsiento(") > 0 && patch.indexOf("gastosConAsiento(") < patch.indexOf(".update("),
    "el PATCH mira el libro antes de escribir");
  assert.match(patch, /MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_EDITA \}, \{ status: 409 \}/);
  assert.ok(del.indexOf("gastosConAsiento(") > 0, "el DELETE mira el libro");
  assert.ok(del.indexOf("gastosConAsiento(") < del.indexOf('storage.from("documents").remove'),
    "antes de borrar el comprobante: si no, el gasto queda sin su archivo");
  assert.match(del, /MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_ELIMINA \}, \{ status: 409 \}/);
  // Si igual llega a la base, el congelado (23001) es 409 y no 500.
  assert.equal((r.match(/ES_GASTO_CONGELADO\((updateError|deleteError)\)/g) ?? []).length, 2);
});

test("🔒 la pantalla: el lápiz con el gasto en el libro no abre el formulario y dice por qué", () => {
  const c = leer("src/components/expenses/expense-actions.tsx");
  const start = c.slice(c.indexOf("const startEdit"), c.indexOf("const handleSaveEdit"));
  assert.ok(start.indexOf("if (bloqueoEditar)") < start.indexOf('setMode("edit")'));
  assert.match(c, /title=\{bloqueoEditar \?\? "Editar gasto"\}/);
  const pagina = leer("src/app/legal/casos/[id]/page.tsx");
  assert.equal((pagina.match(/bloqueoEditar=\{enElLibro\.has\(e\.id\) \? MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_EDITA : null\}/g) ?? []).length, 2,
    "trámite y administrativos");
});

/**
 * 🔒 ASIGNACIONES EN LOTE (07/10/2026): proveedor y cuenta a gastos de trámite,
 * banco a cobros, para contabilizar los documentos existentes.
 *
 * Lo que fija:
 *   1. Un documento CON asiento no se toca, ni uno de prueba, ni uno anterior
 *      al inicio contable; y si uno del lote no se puede, no se escribe ninguno.
 *   2. Sólo admin y contador (las dos rutas declaran los mismos roles que la
 *      pantalla, que vive bajo /finanzas/asientos: admin y contador).
 *   3. Las escrituras van DESPUÉS de verificar el lote, y la del proveedor
 *      vuelve a filtrar por `posted_entry_id IS NULL`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { rechazosDelLote, type DocumentoDelLote } from "../asignaciones-documentos";

const doc = (id: string, o: Partial<DocumentoDelLote> = {}): DocumentoDelLote => ({
  id, numero: `N-${id}`, fecha: "2026-07-10", conAsiento: false, dePrueba: false, inactivo: null, ...o,
});
const INICIO = "2026-07-01";

test("un lote sano no tiene rechazos", () => {
  assert.deepEqual(rechazosDelLote(["a", "b"], [doc("a"), doc("b")], INICIO), []);
});

test("🔴 con asiento, de prueba, anterior al inicio, anulado o inexistente: cada uno nombrado", () => {
  const r = rechazosDelLote(
    ["a", "b", "c", "d", "e", "ffffffff-x"],
    [
      doc("a", { conAsiento: true }),
      doc("b", { dePrueba: true }),
      doc("c", { fecha: "2026-06-30" }),
      doc("d", { inactivo: "está anulado" }),
      doc("e"),
    ],
    INICIO
  );
  assert.deepEqual(r, [
    "N-a: ya está en el libro contable y no se toca",
    "N-b: es un documento de prueba",
    "N-c: es anterior al inicio contable (01/07/2026), está contabilizado fuera",
    "N-d: está anulado",
    "ffffffff: no existe",
  ]);
});

test("el día del inicio contable sí se puede", () => {
  assert.deepEqual(rechazosDelLote(["a"], [doc("a", { fecha: INICIO })], INICIO), []);
});

const raiz = process.cwd();
const leer = (p: string) => readFileSync(path.join(raiz, p), "utf8").replace(/\r\n/g, "\n");

test("las dos rutas: sólo admin y contador, y el tenant del perfil", () => {
  for (const r of ["gastos", "bancos"]) {
    const f = leer(`src/app/api/finanzas/asientos/documentos-existentes/${r}/route.ts`);
    assert.match(f, /const ROLES = \["admin", "contador"\] as const;/);
    assert.match(f, /requireRole\(ctx\.userRole, ROLES\)/);
    assert.match(f, /ctx\.tenantId/);
    assert.doesNotMatch(f, /body\.tenant|tenant_id\s*:/);
  }
});

test("se escribe DESPUÉS de verificar el lote; el proveedor sólo en gastos sin asiento", () => {
  const f = leer("src/lib/finanzas/api/asignaciones-documentos.ts");
  for (const [fn, escritura] of [
    ["asignarAGastos", '.from("expense_lines").update('],
    ["asignarBancoACobros", '.from("payments").update('],
  ] as const) {
    const cuerpo = f.slice(f.indexOf(`export async function ${fn}`));
    const verif = cuerpo.indexOf("if (rechazos.length > 0) throw noSePuede(rechazos);");
    assert.ok(verif > 0, `${fn} no verifica el lote`);
    assert.ok(cuerpo.indexOf(escritura) > verif, `${fn} escribe antes de verificar`);
  }
  assert.match(f, /\.from\("expenses"\)\.update\(\{ supplier_id[^;]*\.is\("posted_entry_id", null\)/s);
});

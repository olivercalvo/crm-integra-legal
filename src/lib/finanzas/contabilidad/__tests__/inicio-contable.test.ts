/**
 * 🔒 INICIO CONTABLE (096): lo anterior está «contabilizado fuera».
 *
 *   npm test
 *
 * Tres cosas:
 *   1. El borde de la fecha: el día ANTERIOR al inicio queda fuera; el MISMO día
 *      y los siguientes postean. Un `<=` en lugar de `<` correría el corte un día
 *      y nadie lo notaría hasta el cierre de julio.
 *   2. La validación del valor que manda la pantalla.
 *   3. Que CADA punto de posteo de un documento consulte el corte ANTES de
 *      postear, leyendo el código. La base lo rechaza igual (trigger de la 096),
 *      pero un punto que no consulta convierte un documento de junio en un 422
 *      con el documento deshecho, en vez de un documento registrado sin asiento.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  INICIO_CONTABLE_POR_DEFECTO,
  esContabilizadoFuera,
  fechaCorta,
  explicacionContabilizadoFuera,
  validarInicioContable,
} from "../inicio-contable";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.resolve(RAIZ, rel), "utf8");

const INICIO = "2026-07-01";

test("el valor por defecto es el 01/07/2026, el mismo de la 096", () => {
  assert.equal(INICIO_CONTABLE_POR_DEFECTO, "2026-07-01");
  const sql = leer("sql/pending/096_inicio_contable.sql");
  assert.match(sql, /fecha_inicio_contable date NOT NULL DEFAULT DATE '2026-07-01'/);
});

test("🔴 el borde: antes queda fuera; el mismo día y después postean", () => {
  assert.equal(esContabilizadoFuera("2026-06-30", INICIO), true, "el día anterior");
  assert.equal(esContabilizadoFuera("2026-01-15", INICIO), true, "meses antes");
  assert.equal(esContabilizadoFuera("2026-07-01", INICIO), false, "el mismo día del inicio postea");
  assert.equal(esContabilizadoFuera("2026-07-02", INICIO), false, "el día siguiente");
  assert.equal(esContabilizadoFuera("2027-01-01", INICIO), false);
});

test("compara el DÍA, aunque llegue un timestamp (sin husos)", () => {
  assert.equal(esContabilizadoFuera("2026-06-30T23:59:59-05:00", INICIO), true);
  assert.equal(esContabilizadoFuera("2026-07-01T00:00:00.000Z", INICIO), false);
  assert.equal(esContabilizadoFuera("2026-06-30", "2026-07-01T05:00:00.000Z"), true);
});

test("sin fecha no está fuera (no se inventa el corte)", () => {
  assert.equal(esContabilizadoFuera(null, INICIO), false);
  assert.equal(esContabilizadoFuera(undefined, INICIO), false);
  assert.equal(esContabilizadoFuera("", INICIO), false);
});

test("fechaCorta y la explicación, sin guion largo", () => {
  assert.equal(fechaCorta("2026-07-01"), "01/07/2026");
  const t = explicacionContabilizadoFuera(INICIO);
  assert.match(t, /01\/07\/2026/);
  assert.doesNotMatch(t, /—/);
});

test("validarInicioContable", () => {
  assert.deepEqual(validarInicioContable({ fecha_inicio_contable: "2026-07-01" }), { ok: true, fecha: "2026-07-01" });
  assert.equal(validarInicioContable({ fecha_inicio_contable: " 2026-08-01 " }).ok, true);
  assert.equal(validarInicioContable({}).ok, false);
  assert.equal(validarInicioContable({ fecha_inicio_contable: "01/07/2026" }).ok, false);
  assert.equal(validarInicioContable({ fecha_inicio_contable: "2026-02-30" }).ok, false, "día que no existe");
  assert.equal(validarInicioContable({ fecha_inicio_contable: "1999-12-31" }).ok, false);
});

// ---------------------------------------------------------------------------
// Cada punto de posteo consulta el corte ANTES de postear
// ---------------------------------------------------------------------------

/** Archivo, función y la llamada que postea. */
const PUNTOS = [
  { archivo: "src/lib/finanzas/api/invoices.ts", desde: "export async function emitInvoice", postea: "postJournalEntry(" },
  { archivo: "src/lib/finanzas/api/credit-notes.ts", desde: "export async function emitCreditNote", postea: "postJournalEntry(" },
  { archivo: "src/lib/finanzas/api/business-expenses.ts", desde: "export async function createBusinessExpense", postea: "postJournalEntry(" },
  { archivo: "src/lib/finanzas/api/payments.ts", desde: "export async function createPayment", postea: "postJournalEntry(" },
  { archivo: "src/lib/finanzas/api/supplier-payments.ts", desde: "export async function createSupplierPayment", postea: "postJournalEntry(" },
  { archivo: "src/lib/finanzas/api/expense-tramite.ts", desde: "export async function postearGastoTramite", postea: "postJournalEntry(" },
  { archivo: "src/app/api/expenses/route.ts", desde: "export const POST", postea: "postearGastoTramite(" },
];

for (const p of PUNTOS) {
  test(`🔒 ${p.archivo}: consulta el inicio contable antes de postear`, () => {
    const src = leer(p.archivo);
    const i = src.indexOf(p.desde);
    assert.ok(i >= 0, `no se encontró «${p.desde}»: ¿se renombró? Actualizar este test.`);
    const cuerpo = src.slice(i);
    const corte = cuerpo.search(/documentoContabilizadoFuera\(|esContabilizadoFuera\(/);
    const posteo = cuerpo.indexOf(p.postea);
    assert.ok(posteo > 0, `no se encontró «${p.postea}» en ${p.archivo}`);
    assert.ok(
      corte > 0 && corte < posteo,
      `${p.archivo}: el posteo no pregunta antes si el documento es anterior al inicio contable`
    );
  });
}

test("🔒 todo archivo que postea un DOCUMENTO está en la lista de arriba", () => {
  // El asiento manual (`/api/finanzas/asientos`) no es un documento: no tiene
  // fecha de documento y no entra en el corte.
  const conocidos = new Set(PUNTOS.map((p) => p.archivo));
  const candidatos = [
    "src/lib/finanzas/api/invoices.ts",
    "src/lib/finanzas/api/credit-notes.ts",
    "src/lib/finanzas/api/business-expenses.ts",
    "src/lib/finanzas/api/payments.ts",
    "src/lib/finanzas/api/supplier-payments.ts",
    "src/lib/finanzas/api/expense-tramite.ts",
  ];
  for (const f of candidatos) {
    if (leer(f).includes("postJournalEntry(")) {
      assert.ok(conocidos.has(f), `${f} postea y no está en PUNTOS`);
    }
  }
});

test("el gasto de trámite: el botón no se ofrece y la ruta responde 409", () => {
  const api = leer("src/lib/finanzas/api/expense-tramite.ts");
  assert.match(api, /contabilizado fuera\. \$\{explicacionContabilizadoFuera\(inicio\)\}`, 409\)/);
  const pagina = leer("src/app/finanzas/gastos-tramite/[id]/page.tsx");
  assert.match(pagina, /!posteado &&\s*!contabilizadoFuera &&/, "puedePostear excluye lo contabilizado fuera");
});

test("el pago de un gasto de trámite contabilizado fuera se permite sin su asiento", () => {
  const src = leer("src/lib/finanzas/api/supplier-payments.ts");
  assert.match(src, /!gasto\.posted_entry_id &&\s*!\(await documentoContabilizadoFuera\(/);
});

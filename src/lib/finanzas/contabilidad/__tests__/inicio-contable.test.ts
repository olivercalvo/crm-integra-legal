/**
 * 🔒 INICIO CONTABLE (096): lo anterior está «contabilizado fuera».
 *
 *   npm test
 *
 * Lo que fija:
 *   1. El borde de la fecha: el día ANTERIOR al inicio queda fuera; el MISMO día
 *      y los siguientes postean. Un `<=` en lugar de `<` correría el corte un día
 *      y nadie lo notaría hasta el cierre de julio.
 *   2. La validación del valor que manda la pantalla.
 *   3. Que CADA alta, edición de fecha, anulación y eliminación pregunte por el
 *      inicio ANTES de escribir, leyendo el código (ajuste del 06/10: lo
 *      anterior no se crea, no se mueve, no se anula ni se elimina). La base lo
 *      rechaza igual (triggers de la 096): eso es el respaldo, no el camino.
 *   4. Que la app y la base digan lo mismo.
 *   5. La matriz de la anulación: anterior al inicio → «contabilizada_fuera».
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
  mensajeFechaAnteriorAlInicio,
  mensajeContabilizadoFueraNoSeAnula,
} from "../inicio-contable";
import { decidirAccionFiscal } from "@/lib/finanzas/efactura/orchestration/decidir-accion-fiscal";

const RAIZ = path.resolve(__dirname, "../../../../..");
// Sin CRLF: en Windows git puede dejar los fuentes con CRLF y las anclas usan LF.
const leer = (rel: string) => readFileSync(path.resolve(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

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
// 4b: la app corta ANTES de que la base tenga que rechazar
//
// El trigger del libro (096) es el RESPALDO. Ningún flujo de la app tiene que
// llegar a él: cada alta y cada edición de fecha preguntan antes de tomar un
// número, y cada anulación o eliminación antes de tocar nada. Esto lo fija
// leyendo el código: si alguien agrega un camino nuevo y no pregunta, falla.
// ---------------------------------------------------------------------------

const PREGUNTA = /asegurarFechaDesdeElInicio\(|asegurarQueNoEsContabilizadoFuera\(|esContabilizadoFuera\(/;

/** Que en `archivo`, dentro de la función que empieza en `desde`, el corte se consulte antes de `accion`. */
function preguntaAntes(archivo: string, desde: string, accion: string): void {
  const src = leer(archivo);
  const i = src.indexOf(desde);
  assert.ok(i >= 0, `no se encontró «${desde}» en ${archivo}: ¿se renombró? Actualizar este test.`);
  const cuerpo = src.slice(i);
  const corte = cuerpo.search(PREGUNTA);
  const hecho = cuerpo.indexOf(accion);
  assert.ok(hecho > 0, `no se encontró «${accion}» en ${archivo}`);
  assert.ok(corte > 0 && corte < hecho, `${archivo} (${desde}): «${accion}» sin preguntar antes por el inicio contable`);
}

/** Altas: la fecha se valida antes del número y del INSERT (o del RPC que los hace). */
const ALTAS: [string, string, string][] = [
  ["src/lib/finanzas/api/invoices.ts", "export async function createInvoice", '.from("invoices")'],
  ["src/lib/finanzas/api/invoices.ts", "export async function emitInvoice", 'rpc(\n      "get_next_sequence_number"'],
  ["src/lib/finanzas/api/credit-notes.ts", "export async function createCreditNote", 'rpc("get_next_sequence_number"'],
  ["src/lib/finanzas/api/payments.ts", "export async function createPayment", '.from("payments")'],
  ["src/lib/finanzas/api/business-expenses.ts", "export async function createBusinessExpense", '.from("business_expenses")'],
  ["src/lib/finanzas/api/supplier-payments.ts", "export async function createSupplierPayment", "allocateSupplierPaymentNumber("],
  ["src/app/api/expenses/route.ts", "export const POST", '.from("expenses")\n      .insert'],
  ["src/lib/finanzas/api/facturas-externas.ts", "export async function registrarFacturaExterna", 'rpc("register_external_invoice"'],
  ["src/lib/finanzas/api/supplier-credit-notes.ts", "export async function createSupplierCreditNote", 'rpc("create_supplier_credit_note"'],
];
for (const [archivo, desde, accion] of ALTAS) {
  test(`🔒 alta: ${archivo} › ${desde.replace(/^export (async function|const) /, "")} valida la fecha antes de escribir`, () => {
    preguntaAntes(archivo, desde, accion);
  });
}

/** Ediciones de la fecha. */
const EDICIONES: [string, string, string][] = [
  ["src/lib/finanzas/api/invoices.ts", "export async function updateInvoice", '.from("invoices")\n    .update'],
  ["src/lib/finanzas/api/business-expenses.ts", "export async function updateBusinessExpense", '.from("business_expenses")\n    .update'],
  ["src/app/api/expenses/[id]/route.ts", "export const PATCH", "updates.date = date"],
];
for (const [archivo, desde, accion] of EDICIONES) {
  test(`🔒 edición: ${archivo} › ${desde.replace(/^export (async function|const) /, "")} no mueve la fecha a antes del inicio`, () => {
    preguntaAntes(archivo, desde, accion);
  });
}

/** Anular y eliminar: lo contabilizado fuera no se toca. */
const BAJAS: [string, string, string][] = [
  ["src/lib/finanzas/api/invoices.ts", "export async function cancelInvoice", "createCreditNoteFromInvoice("],
  ["src/lib/finanzas/api/payments.ts", "export async function deletePayment", '.from("payments")\n    .delete'],
  ["src/lib/finanzas/api/supplier-payments.ts", "export async function deleteSupplierPayment", '.from("supplier_payments")\n    .delete'],
  ["src/lib/finanzas/api/business-expenses.ts", "export async function deleteBusinessExpense", ".storage.from("],
  ["src/app/api/expenses/[id]/route.ts", "export const DELETE", ".storage.from("],
];
for (const [archivo, desde, accion] of BAJAS) {
  test(`🔒 baja: ${archivo} › ${desde.replace(/^export (async function|const) /, "")} rechaza lo contabilizado fuera antes de tocar nada`, () => {
    preguntaAntes(archivo, desde, accion);
  });
}

test("🔒 la anulación ante la DGI pasa por la matriz con el inicio contable, antes del PAC", () => {
  const src = leer("src/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi.ts");
  assert.match(src, /inicioContable: await cargarInicioContable\(db, tenantId\)/);
  const pagina = leer("src/app/finanzas/facturas/[id]/page.tsx");
  assert.match(pagina, /inicioContable: esDePrueba \? null : inicio/, "la pantalla usa la MISMA matriz");
});

test("🔒 el posteo del gasto de trámite (reintento) responde 409 a lo contabilizado fuera", () => {
  preguntaAntes("src/lib/finanzas/api/expense-tramite.ts", "export async function postearGastoTramite", "postJournalEntry(");
  const api = leer("src/lib/finanzas/api/expense-tramite.ts");
  assert.match(api, /contabilizado fuera\. \$\{explicacionContabilizadoFuera\(inicio\)\}`, 409\)/);
  const pagina = leer("src/app/finanzas/gastos-tramite/[id]/page.tsx");
  assert.match(pagina, /!posteado &&\s*!contabilizadoFuera &&/, "puedePostear excluye lo contabilizado fuera");
});

test("el pago de un gasto de trámite contabilizado fuera se permite sin su asiento", () => {
  const src = leer("src/lib/finanzas/api/supplier-payments.ts");
  assert.match(src, /!gasto\.posted_entry_id &&\s*!\(await documentoContabilizadoFuera\(/);
});

test("🔒 ningún archivo de la app postea un documento sin estar en estas listas", () => {
  // Quien llama a `postJournalEntry` con un documento, o a un RPC que postea uno.
  const conocidos = new Set([...ALTAS, ...BAJAS].map(([a]) => a).concat("src/lib/finanzas/api/expense-tramite.ts"));
  const candidatos = [
    "src/lib/finanzas/api/invoices.ts",
    "src/lib/finanzas/api/credit-notes.ts",
    "src/lib/finanzas/api/business-expenses.ts",
    "src/lib/finanzas/api/payments.ts",
    "src/lib/finanzas/api/supplier-payments.ts",
    "src/lib/finanzas/api/expense-tramite.ts",
    "src/lib/finanzas/api/facturas-externas.ts",
    "src/lib/finanzas/api/supplier-credit-notes.ts",
  ];
  for (const f of candidatos) {
    const src = leer(f);
    if (/postJournalEntry\(|register_external_invoice|create_supplier_credit_note"/.test(src)) {
      assert.ok(conocidos.has(f), `${f} postea un documento y no está en ALTAS/BAJAS`);
    }
  }
});

// ---------------------------------------------------------------------------
// Los textos de la app y los de la base son los mismos
// ---------------------------------------------------------------------------

test("🔒 la 096 dice lo mismo que la app (anular, eliminar, fecha anterior)", () => {
  const sql = leer("sql/pending/096_inicio_contable.sql");
  for (const fragmento of [
    "es anterior al inicio contable (%s). Lo anterior al inicio está en los libros del contador: no se registran documentos con esa fecha.",
    "fuera: su fecha es anterior al inicio contable (%s). No se %s: se corrige con %s con fecha igual o posterior al inicio.",
    "'una nota de crédito'",
    "'una nota de crédito del proveedor'",
    "'un asiento de diario'",
    "'la nota de crédito del proveedor'",
    "'el pago al proveedor'",
    "'^de el ', 'del '",
  ]) {
    assert.ok(sql.includes(fragmento), `la 096 no tiene «${fragmento}»`);
  }
  assert.equal(
    mensajeFechaAnteriorAlInicio("cobro", "2026-06-30", INICIO),
    "La fecha del cobro (30/06/2026) es anterior al inicio contable (01/07/2026). Lo anterior al inicio " +
      "está en los libros del contador: no se registran documentos con esa fecha."
  );
  assert.equal(
    mensajeContabilizadoFueraNoSeAnula("factura", "FAC-HON-000489", "2026-06-20", INICIO),
    "La factura FAC-HON-000489 (20/06/2026) está contabilizada fuera: su fecha es anterior al inicio " +
      "contable (01/07/2026). No se anula: se corrige con una nota de crédito con fecha igual o posterior al inicio."
  );
  assert.equal(
    mensajeContabilizadoFueraNoSeAnula("cobro", null, "2026-06-28", INICIO),
    "El cobro (28/06/2026) está contabilizado fuera: su fecha es anterior al inicio contable (01/07/2026). " +
      "No se elimina: se corrige con un asiento de diario con fecha igual o posterior al inicio."
  );
  assert.match(mensajeContabilizadoFueraNoSeAnula("gasto_tramite", "Timbres", "2026-06-26", INICIO), /^El gasto de trámite Timbres .* nota de crédito del proveedor/);
  assert.match(mensajeContabilizadoFueraNoSeAnula("compra", null, "2026-06-26", INICIO), /^La compra .*contabilizada fuera.*No se elimina/);
});

// ---------------------------------------------------------------------------
// La matriz: anterior al inicio → no se anula
// ---------------------------------------------------------------------------

const BASE_MATRIZ = {
  status: "emitida",
  feEstado: "no_emitida" as const,
  dgiCufe: null,
  issueDate: "2026-06-20",
  dgiFechaAutorizacion: null,
  creditedTotal: 0,
  amountPaid: 0,
  mesCerrado: false,
};
const AHORA = new Date("2026-10-06T12:00:00-05:00");

test("🔴 matriz: una factura anterior al inicio responde «contabilizada_fuera», con el mensaje de la NC", () => {
  const a = decidirAccionFiscal({ ...BASE_MATRIZ, inicioContable: INICIO, numero: "FAC-HON-000489" }, AHORA);
  assert.equal(a.accion, "contabilizada_fuera");
  assert.match(a.mensaje, /^La factura FAC-HON-000489 \(20\/06\/2026\) está contabilizada fuera/);
  assert.match(a.mensaje, /se corrige con una nota de crédito con fecha igual o posterior al inicio/);
  const nd = decidirAccionFiscal({ ...BASE_MATRIZ, inicioContable: INICIO, esNotaDeDebito: true, numero: "ND-000001" }, AHORA);
  assert.match(nd.mensaje, /^La nota de débito ND-000001/);
});

test("matriz: el mismo día del inicio, sin el dato o ya anulada, no cambia nada", () => {
  assert.notEqual(decidirAccionFiscal({ ...BASE_MATRIZ, issueDate: INICIO, inicioContable: INICIO }, AHORA).accion, "contabilizada_fuera");
  assert.notEqual(decidirAccionFiscal({ ...BASE_MATRIZ }, AHORA).accion, "contabilizada_fuera", "sin inicio no decide por esto");
  assert.equal(decidirAccionFiscal({ ...BASE_MATRIZ, status: "anulada", inicioContable: INICIO }, AHORA).accion, "nada_que_hacer");
});

// ---------------------------------------------------------------------------
// Regenerar staging: las semillas bajan el inicio y lo devuelven SIEMPRE
// ---------------------------------------------------------------------------

test("🔒 las tres semillas bajan el inicio contable y lo devuelven en un finally", () => {
  for (const f of ["scripts/seed-staging.ts", "scripts/seed-asientos.ts", "scripts/seed-gasto-tramite-demo.mts"]) {
    const src = leer(f);
    const baja = src.indexOf("bajarInicioParaSembrar(");
    const fin = src.indexOf("finally {", baja);
    const restaura = src.indexOf("await restaurarInicio()", fin);
    assert.ok(baja > 0 && fin > baja && restaura > fin, `${f}: el inicio no se devuelve en un finally`);
  }
  const helper = leer("scripts/seed-data/inicio-contable-semilla.ts");
  assert.match(helper, /INICIO_DE_STAGING = "2026-07-01"/);
  assert.match(helper, /uqmmkklbhzxqybljiecs/, "candado anti-producción");
  assert.match(helper, /DISABLE TRIGGER trg_inicio_contable_guard[\s\S]*ENABLE TRIGGER trg_inicio_contable_guard[\s\S]*COMMIT/);
});

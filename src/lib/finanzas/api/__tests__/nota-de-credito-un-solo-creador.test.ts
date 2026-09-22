/**
 * 🔒 UN SOLO CREADOR DE NOTAS DE CRÉDITO (Bloque 5, D2 aprobado por Oliver).
 *
 * La NC total automática (al anular) y la NC manual (parcial o total, cuando
 * el mes está cerrado) salen de la MISMA función, `createCreditNote`. Si
 * `cancelInvoice` o cualquier otro camino vuelve a armar líneas por su cuenta,
 * los dos caminos divergen: distinto número, distinta fecha, distinto tope.
 *
 * Lee los archivos y falla si:
 *   · `cancelInvoice` no llama a `createCreditNoteFromInvoice`, o inserta en
 *     `credit_notes` / `credit_note_lines` por su cuenta;
 *   · `credit-notes.ts` tiene más de UN insert en `credit_note_lines`, o
 *     `createCreditNoteFromInvoice` no delega en `createCreditNote`;
 *   · la fecha de la NC deja de ser la de HOY (aparece `issue_date` de la
 *     factura en el select que alimenta el insert, o el insert no usa
 *     `issueDateIso`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const CREADOR = "src/lib/finanzas/api/credit-notes.ts";
const INVOICES = "src/lib/finanzas/api/invoices.ts";

test("credit-notes.ts: un solo insert en credit_note_lines, y el mirror delega en createCreditNote", () => {
  const src = leer(CREADOR);
  const inserts = src.match(/\.from\("credit_note_lines"\)\s*\.insert\(/g) ?? [];
  assert.equal(inserts.length, 1, "las líneas de una NC se insertan en UN solo lugar");
  const cabeceras = src.match(/\.from\("credit_notes"\)\s*\.insert\(/g) ?? [];
  assert.equal(cabeceras.length, 1, "la cabecera de una NC se inserta en UN solo lugar");

  const mirror = src.slice(src.indexOf("export async function createCreditNoteFromInvoice"));
  assert.match(mirror, /await createCreditNote\(db, tenantId, userId, \{/, "el mirror es createCreditNote con todas las líneas");
  assert.doesNotMatch(mirror, /\.insert\(/, "el mirror no inserta nada por su cuenta");
});

test("cancelInvoice no arma líneas: delega en createCreditNoteFromInvoice", () => {
  const src = leer(INVOICES);
  const fn = src.slice(src.indexOf("export async function cancelInvoice"), src.indexOf("// Helpers", src.indexOf("export async function cancelInvoice")));
  assert.match(fn, /createCreditNoteFromInvoice\(/);
  assert.doesNotMatch(fn, /credit_note_lines/);
  assert.doesNotMatch(fn, /\.from\("credit_notes"\)\s*\.insert/);
  assert.doesNotMatch(fn, /get_next_sequence_number/, "el número NC- lo toma el creador, no la anulación");
});

test("🔴 la NC lleva la fecha de HOY, nunca la de la factura", () => {
  const src = leer(CREADOR);
  const fn = src.slice(src.indexOf("export async function createCreditNote("), src.indexOf("export async function createCreditNoteFromInvoice"));
  assert.match(fn, /const issueDateIso = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/);
  assert.match(fn, /issue_date: issueDateIso,/);
  // El select de la factura que alimenta el creador no trae su issue_date:
  // no hay de dónde copiarla por error.
  const selectFactura = fn.match(/\.from\("invoices"\)\s*\.select\(\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(selectFactura.length > 0, "se esperaba el select de la factura");
  assert.doesNotMatch(selectFactura, /issue_date/);
});

test("el creador valida con la regla pura antes de tomar el número (un 400 no quema correlativo)", () => {
  const src = leer(CREADOR);
  const fn = src.slice(src.indexOf("export async function createCreditNote("), src.indexOf("export async function createCreditNoteFromInvoice"));
  const iValida = fn.indexOf("validarLineasDeNotaDeCredito(");
  const iNumero = fn.indexOf('"get_next_sequence_number"');
  assert.ok(iValida > 0 && iNumero > 0);
  assert.ok(iValida < iNumero, "la validación va ANTES del correlativo");
});

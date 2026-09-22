/**
 * El asiento PROPIO de una nota de crédito (Bloque 5, D5) y la anulación con
 * reversión:
 *
 *   1. La NC es la factura al revés, por líneas: DEBE la cuenta de ingreso de
 *      cada línea (130003 en los reembolsos), DEBE 200003 por su ITBMS, HABER
 *      100004 por el total. source_type `nota_credito`, source_id = la NC,
 *      reference = NC-…, fecha = la de la NC (hoy). Una NC parcial da el ITBMS
 *      proporcional exacto.
 *   2. Las validaciones de la factura se heredan: línea sin servicio o cuenta
 *      inactiva → no se postea.
 *   3. `cancelInvoice`: sin el "GATE CONTABLE (02/09/2026)", con el bloqueo por
 *      mes cerrado (D4) y con la reversión armada por
 *      `construirAsientoDeReversion` (una sola implementación), sin postear la
 *      NC aparte (D5). La ruta pasa el cliente de servicio.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  construirAsientoDeNotaDeCredito,
  type NotaDeCreditoParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-nota-credito";

const NC: NotaDeCreditoParaAsiento = {
  id: "nc-1",
  credit_note_number: "NC-000001",
  issue_date: "2026-09-22",
  grand_total: 414,
  invoice_number: "FAC-HON-000011",
  client_name: "Aurelio Barría Quintero",
  lineas: [
    // 2 × 100 al 7% = 214 (ingreso 400004)
    { line_order: 1, description: "Honorarios", subtotal: 200, tax_amount: 14, service_code: "HON-CORP", revenue_account: "400004", cuenta_valida: true },
    // reembolso exento = 200 (activo 130003)
    { line_order: 2, description: "Timbres", subtotal: 200, tax_amount: 0, service_code: "REIM-TIM", revenue_account: "130003", cuenta_valida: true },
  ],
};

test("la NC es la factura al revés: DEBE ingreso y 130003, DEBE 200003 por el ITBMS, HABER 100004 por el total", () => {
  const r = construirAsientoDeNotaDeCredito(NC);
  assert.ok(r.ok);
  const a = r.asiento;
  assert.equal(a.source_type, "nota_credito");
  assert.equal(a.source_id, "nc-1", "el source_id es la NC, no la factura (varias NC por factura)");
  assert.equal(a.reference, "NC-000001");
  assert.equal(a.transaction_date, "2026-09-22", "la fecha de la NC (hoy), no la de la factura");
  assert.match(a.description, /Nota de crédito NC-000001 — Factura FAC-HON-000011/);

  const por = new Map(a.lines.map((l) => [l.account_code, l]));
  assert.equal(por.get("400004")?.debit, 200);
  assert.equal(por.get("130003")?.debit, 200, "el reembolso vuelve al fondo de clientes, no a ingreso");
  assert.equal(por.get("200003")?.debit, 14, "el ITBMS proporcional exacto, al débito");
  assert.equal(por.get("100004")?.credit, 414);
  const d = a.lines.reduce((s, l) => s + l.debit, 0);
  const c = a.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(d * 100), Math.round(c * 100), "cuadra");
});

test("una línea con cuenta inactiva o sin servicio no se postea (las validaciones de la factura se heredan)", () => {
  const inactiva = construirAsientoDeNotaDeCredito({
    ...NC,
    lineas: [{ ...NC.lineas[0], cuenta_valida: false }],
  });
  assert.equal(inactiva.ok, false);
  const sinServicio = construirAsientoDeNotaDeCredito({
    ...NC,
    lineas: [{ ...NC.lineas[0], service_code: null, revenue_account: null, cuenta_valida: false }],
  });
  assert.equal(sinServicio.ok, false);
});

// ---------------------------------------------------------------------------
// cancelInvoice, leído
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const REIMPLEMENTACION = /\b(debit|debe)\s*:\s*[\w.]*\b(credit|haber)\b|\b(credit|haber)\s*:\s*[\w.]*\b(debit|debe)\b/;

function cuerpoDeCancel(): string {
  const src = leer("src/lib/finanzas/api/invoices.ts");
  const i = src.indexOf("export async function cancelInvoice");
  return src.slice(i, src.indexOf("export function MENSAJE_MES_CERRADO", i));
}

test("🔒 cancelInvoice: sin el gate del 02/09, con el bloqueo por mes cerrado, y la reversión de una sola implementación", () => {
  const fn = cuerpoDeCancel();
  assert.doesNotMatch(fn, /GATE CONTABLE/, "el gate del 02/09 se reemplazó por la reversión real (D4)");
  assert.doesNotMatch(fn, /Avisale a Oliver/);
  assert.match(fn, /periodoDeLaFacturaCerrado\(/, "el MES de la factura, no el de hoy (D4)");
  assert.match(fn, /MENSAJE_MES_CERRADO\(/);
  assert.match(fn, /construirAsientoDeReversion\(original,/, "el espejo lo arma la función pura");
  assert.match(fn, /lines = armado\.asiento\.lines\.map/, "lo que va al RPC sale de armado.asiento");
  assert.doesNotMatch(fn, REIMPLEMENTACION, "no intercambia débito y crédito por su cuenta");
  assert.match(fn, /\.rpc\("cancel_invoice_with_reversal"/);
  assert.doesNotMatch(fn, /construirAsientoDeNotaDeCredito|nota_credito/, "la anulación NO postea la NC aparte (D5)");
  assert.match(fn, /compensarNotaDeCredito\(/, "si el RPC falla, la NC se deshace");
});

test("el texto del mes cerrado es el de D4", () => {
  const src = leer("src/lib/finanzas/api/invoices.ts");
  assert.match(src, /está cerrado: no se anula, `\s*\+\s*`se emite una nota de crédito con fecha de hoy\./);
});

test("la ruta de anulación pasa el cliente de SERVICIO y la ruta de NC declara admin y abogada", () => {
  const cancel = leer("src/app/api/finanzas/invoices/[id]/cancel/route.ts");
  assert.match(cancel, /createAdminClient\(\)/);
  const nc = leer("src/app/api/finanzas/credit-notes/route.ts");
  assert.match(nc, /const MUTATING_ROLES = \["admin", "abogada"\] as const;/);
  assert.match(nc, /emitCreditNote\(/);
  assert.doesNotMatch(nc, /tenant_id/, "el tenant nunca sale del body");
});

test("emitCreditNote postea con construirAsientoDeNotaDeCredito y compensa si el posteo falla", () => {
  const src = leer("src/lib/finanzas/api/credit-notes.ts");
  const fn = src.slice(src.indexOf("export async function emitCreditNote"), src.indexOf("export async function createCreditNoteFromInvoice"));
  assert.match(fn, /await createCreditNote\(/);
  assert.match(fn, /construirAsientoDeNotaDeCredito\(/);
  assert.match(fn, /postJournalEntry\(/);
  assert.match(fn, /compensarNotaDeCredito\(/);
  const comp = src.slice(src.indexOf("export async function compensarNotaDeCredito"), src.indexOf("export async function emitCreditNote"));
  assert.match(comp, /"finanzas_compensar_nota_de_credito"/, "la válvula y el DELETE van juntos, en la base");
});

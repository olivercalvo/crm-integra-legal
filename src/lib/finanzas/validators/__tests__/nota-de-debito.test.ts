/**
 * 🔒 NOTA DE DÉBITO (077, decisión 14): mismo efecto que una factura de venta,
 * como tipo de documento.
 *
 *   1. Es un `invoice_kind` más: serie propia `ND-`, mismo formulario.
 *   2. Lleva servicios de honorarios (un recargo, un ajuste), no de reembolso.
 *   3. La factura que ajusta es opcional y SÓLO en una nota de débito.
 *   4. Su asiento es el de la factura (el emisor no distingue el tipo).
 *   5. Todavía no va a la DGI: una sola constante lo corta.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { validateCreateInvoice, validarConsistenciaDeKind } from "@/lib/finanzas/validators/invoice";
import { INVOICE_KIND_LABEL, PREFIX_BY_KIND, SEQUENCE_TYPE_BY_KIND } from "@/lib/finanzas/types/invoice";
import { tipoDocumentoDeKind } from "@/lib/finanzas/efactura/mapper/map-invoice";

const RAIZ = path.resolve(__dirname, "../../../../..");
const CLI = "11111111-1111-1111-1111-111111111111";
const FAC = "22222222-2222-2222-2222-222222222222";

const base = {
  client_id: CLI,
  issue_date: "2026-10-01",
  due_date: "2026-10-31",
  notes: null,
  case_id: null,
  lines: [{ service_id: null, description: "Recargo por pago tardío", quantity: 1, unit_price: 50, tax_code_id: "77777777-7777-7777-7777-777777777777", tax_code: "ITBMS_7", tax_rate: 0.07 }],
};

test("es un tipo de documento más: serie ND-, su secuencia y su etiqueta", () => {
  assert.equal(PREFIX_BY_KIND.NOTA_DEBITO, "ND");
  assert.equal(SEQUENCE_TYPE_BY_KIND.NOTA_DEBITO, "debit_note");
  assert.equal(INVOICE_KIND_LABEL.NOTA_DEBITO, "Nota de débito");
  assert.equal(tipoDocumentoDeKind("NOTA_DEBITO"), "05");
  const r = validateCreateInvoice({ ...base, invoice_kind: "NOTA_DEBITO" });
  assert.ok(r.ok);
});

test("la factura que ajusta: opcional, y sólo en una nota de débito", () => {
  const con = validateCreateInvoice({ ...base, invoice_kind: "NOTA_DEBITO", referenced_invoice_id: FAC });
  assert.ok(con.ok);
  if (con.ok) assert.equal(con.data.referenced_invoice_id, FAC);
  const sin = validateCreateInvoice({ ...base, invoice_kind: "NOTA_DEBITO" });
  assert.ok(sin.ok);
  if (sin.ok) assert.equal(sin.data.referenced_invoice_id, null);
  const enFactura = validateCreateInvoice({ ...base, invoice_kind: "HONORARIOS", referenced_invoice_id: FAC });
  assert.equal(enFactura.ok, false);
  assert.ok(enFactura.errors?.referenced_invoice_id);
  // En una factura la clave ni siquiera viaja: antes de la 077 la columna no existe.
  const hon = validateCreateInvoice({ ...base, invoice_kind: "HONORARIOS" });
  assert.ok(hon.ok);
  if (hon.ok) assert.equal("referenced_invoice_id" in hon.data, false);
});

test("lleva servicios de honorarios; uno de reembolso se rechaza", () => {
  const servicios = new Map([
    ["h", { code: "HON-COR", name: "Honorarios", service_type: "honorarios" }],
    ["r", { code: "REIM-TIM", name: "Timbres", service_type: "reembolso" }],
  ]);
  assert.deepEqual(validarConsistenciaDeKind([{ service_id: "h" }], servicios, "NOTA_DEBITO"), {});
  const mal = validarConsistenciaDeKind([{ service_id: "r" }], servicios, "NOTA_DEBITO");
  assert.match(String(mal["lines.0.service"]), /Este servicio es de Reembolso; una factura de Nota de débito no puede llevarlo/);
});

test("🔴 todavía no va a la DGI: una sola constante, y se corta antes de todo", () => {
  const src = readFileSync(path.join(RAIZ, "src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura.ts"), "utf8");
  assert.match(src, /export const PERMITIR_ND_A_LA_DGI = false;/);
  const corte = src.indexOf('inv.invoice_kind === "NOTA_DEBITO" && !PERMITIR_ND_A_LA_DGI');
  const bundle = src.indexOf("fetchInvoiceEfacturaBundle(db, tenantId, invoiceId)");
  assert.ok(corte > 0 && corte < bundle, "el corte va antes de armar el envío");
  const detalle = readFileSync(path.join(RAIZ, "src/app/finanzas/facturas/[id]/page.tsx"), "utf8");
  assert.match(detalle, /const canEmitToPac = puedeAccionar && !ndSinDgi;/, "la pantalla no ofrece el botón");
});

test("la columna nueva sólo se nombra en una nota de débito (antes de la 077 no existe)", () => {
  const api = readFileSync(path.join(RAIZ, "src/lib/finanzas/api/invoices.ts"), "utf8");
  assert.match(api, /\.\.\.\(input\.invoice_kind === "NOTA_DEBITO" \? \{ referenced_invoice_id: input\.referenced_invoice_id \?\? null \} : \{\}\)/);
  const q = readFileSync(path.join(RAIZ, "src/lib/finanzas/queries/invoices.ts"), "utf8");
  const getById = q.slice(q.indexOf("export async function getInvoiceById"), q.indexOf("export async function getInvoiceById") + 1500);
  assert.doesNotMatch(getById, /referenced_invoice_id/, "el detalle de toda factura no la pide");
});

/**
 * Render REAL del `ReceiptDocument` con @react-pdf/renderer: el PDF sale con
 * cabecera `%PDF` y con más de una página cero. Existe porque un error de
 * estilos o de props en una plantilla React-PDF no lo ve `tsc`: se descubre
 * cuando alguien aprieta "Recibo" en la pantalla. Se renderiza el caso
 * vigente y el reversado (la banda roja).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateReceiptPdfBuffer } from "@/lib/finanzas/pdf/generate-receipt-pdf";
import { buildReceiptDocumentProps, type ReceiptPdfBundle } from "@/lib/finanzas/pdf/receipt-pdf-data";

const BUNDLE: ReceiptPdfBundle = {
  payment: {
    id: "p4",
    payment_number: "REC-000004",
    payment_date: "2026-09-21",
    amount: 250,
    method: "transferencia",
    reference: "Verificacion deploy",
    notes: "Notas de prueba con acentos: áéíóú ñ",
    status: "registrado",
    payment_account_code: "100001",
    created_by_name: "Ileana Barrios",
  },
  client: {
    name: "INVERSIONES TOCUMEN REAL, S.A.",
    client_number: "CLI-004",
    tax_id: "1588210-1-713366",
    tax_id_type: "ruc",
    digito_verificador: "05",
    email: "contacto@tocumen.test",
    phone: null,
    address: null,
  },
  aplicaciones: [
    { invoice_id: "i1", invoice_number: "FAC-HON-000002", issue_date: "2026-05-20", grand_total: 1605, amount_applied: 250, balance_due: 1355 },
  ],
  banco: { code: "100001", name: "Banco General Operativa" },
  asiento: { entry_number: 22, transaction_date: "2026-09-21" },
  reversion: null,
};

test("el recibo vigente se renderiza a un PDF", async () => {
  const props = buildReceiptDocumentProps(BUNDLE, { generated_at: new Date("2026-09-21T15:00:00"), generated_by_name: "Ileana" });
  const buf = await generateReceiptPdfBuffer(props);
  assert.ok(buf.length > 1000, `PDF demasiado chico: ${buf.length} bytes`);
  assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF");
});

test("el recibo reversado también (banda roja + asiento espejo)", async () => {
  const reversado: ReceiptPdfBundle = {
    ...BUNDLE,
    payment: { ...BUNDLE.payment, status: "anulado" },
    reversion: { entry_number: 23, reversed_at: "2026-09-21T20:00:00Z", reason: "Cheque devuelto por el banco" },
  };
  const props = buildReceiptDocumentProps(reversado, { generated_at: new Date(), generated_by_name: null });
  assert.equal(props.reversado, true);
  const buf = await generateReceiptPdfBuffer(props);
  assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF");
});

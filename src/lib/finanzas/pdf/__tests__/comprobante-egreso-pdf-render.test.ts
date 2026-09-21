/**
 * Render REAL del `SupplierPaymentDocument` con @react-pdf/renderer: el PDF
 * sale con cabecera `%PDF`. Existe porque un error de estilos o de props en
 * una plantilla React-PDF no lo ve `tsc`: se descubre cuando alguien aprieta
 * "Comprobante" en la pantalla. Se renderiza el caso vigente, el reversado (la
 * banda roja) y el de un proveedor sin ficha (RUC de texto libre, sin DV).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateSupplierPaymentPdfBuffer } from "@/lib/finanzas/pdf/generate-supplier-payment-pdf";
import {
  buildSupplierPaymentDocumentProps,
  type SupplierPaymentPdfBundle,
} from "@/lib/finanzas/pdf/supplier-payment-pdf-data";

const BUNDLE: SupplierPaymentPdfBundle = {
  payment: {
    id: "sp1",
    payment_number: "CE-000001",
    payment_date: "2026-09-21",
    amount: 400,
    method: "transferencia",
    reference: "TRF-778899",
    notes: "Notas de prueba con acentos: áéíóú ñ",
    status: "registrado",
    payment_account_code: "100001",
    created_by_name: "Elías Pimentel",
  },
  proveedor: {
    name: "DISTRIBUIDORA OFIPLUS, S.A.",
    supplier_number: "PRV-003",
    ruc: "155612345-2-2019",
    dv: "05",
    email: "ventas@ofiplus.test",
    phone: null,
  },
  compra: {
    id: "c1",
    description: "Compra consolidada de insumos y servicios — marzo 2026",
    expense_date: "2026-03-15",
    supplier_invoice_number: "F-00123",
    total: 1605,
    saldo_actual: 1205,
  },
  banco: { code: "100001", name: "Banco General Operativa" },
  asiento: { entry_number: 28, transaction_date: "2026-09-21" },
  reversion: null,
};

test("el comprobante vigente se renderiza a un PDF", async () => {
  const props = buildSupplierPaymentDocumentProps(BUNDLE, { generated_at: new Date("2026-09-21T15:00:00"), generated_by_name: "Elías" });
  const buf = await generateSupplierPaymentPdfBuffer(props);
  assert.ok(buf.length > 1000, `PDF demasiado chico: ${buf.length} bytes`);
  assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF");
});

test("el comprobante reversado también (banda roja + asiento espejo)", async () => {
  const reversado: SupplierPaymentPdfBundle = {
    ...BUNDLE,
    payment: { ...BUNDLE.payment, status: "anulado" },
    reversion: { entry_number: 30, reversed_at: "2026-09-21T20:00:00Z", reason: "Transferencia rechazada por el banco" },
  };
  const props = buildSupplierPaymentDocumentProps(reversado, { generated_at: new Date(), generated_by_name: null });
  assert.equal(props.reversado, true);
  const buf = await generateSupplierPaymentPdfBuffer(props);
  assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF");
});

test("un proveedor sin ficha (texto libre, sin DV) también se renderiza", async () => {
  const sinFicha: SupplierPaymentPdfBundle = {
    ...BUNDLE,
    proveedor: { name: "Ferretería del barrio", supplier_number: null, ruc: "8-123-456", dv: null, email: null, phone: null },
    compra: { ...BUNDLE.compra, supplier_invoice_number: null },
    banco: null,
    asiento: null,
  };
  const props = buildSupplierPaymentDocumentProps(sinFicha, { generated_at: new Date(), generated_by_name: null });
  const buf = await generateSupplierPaymentPdfBuffer(props);
  assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF");
});

/**
 * Unit tests de la lógica del modal de anulación (detección de CUFE + gating
 * del botón por el checkbox DGI).
 *
 * Ejecución:
 *   npx tsx --test src/app/finanzas/facturas/_components/cancel-invoice-dialog.logic.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  invoiceHasAuthorizedCufe,
  isCancelConfirmDisabled,
} from "@/app/finanzas/facturas/_components/cancel-invoice-dialog.logic";

// ---------------------------------------------------------------------------
// invoiceHasAuthorizedCufe — detección
// ---------------------------------------------------------------------------

test("fe_estado 'authorized' → tiene CUFE (aplica disclaimer)", () => {
  assert.equal(invoiceHasAuthorizedCufe("authorized", null), true);
});

test("dgi_cufe presente (registro manual) → tiene CUFE aunque fe_estado sea no_emitida", () => {
  assert.equal(invoiceHasAuthorizedCufe("no_emitida", "FE01-CUFE-123"), true);
});

test("factura vieja sin CUFE (no_emitida + dgi_cufe null) → NO aplica disclaimer", () => {
  assert.equal(invoiceHasAuthorizedCufe("no_emitida", null), false);
});

test("dgi_cufe vacío o solo espacios → NO cuenta como CUFE", () => {
  assert.equal(invoiceHasAuthorizedCufe("no_emitida", ""), false);
  assert.equal(invoiceHasAuthorizedCufe("no_emitida", "   "), false);
});

test("fe_estado pending / error sin cufe → NO aplica disclaimer", () => {
  assert.equal(invoiceHasAuthorizedCufe("pending", null), false);
  assert.equal(invoiceHasAuthorizedCufe("error", null), false);
});

test("undefined/null (props ausentes en factura no-electrónica) → NO aplica", () => {
  assert.equal(invoiceHasAuthorizedCufe(undefined, undefined), false);
  assert.equal(invoiceHasAuthorizedCufe(null, null), false);
});

// ---------------------------------------------------------------------------
// isCancelConfirmDisabled — gating del botón
// ---------------------------------------------------------------------------

test("factura CON CUFE y checkbox SIN marcar → botón deshabilitado", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: true, dgiConfirmed: false }),
    true
  );
});

test("factura CON CUFE y checkbox marcado → botón habilitado", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: true, dgiConfirmed: true }),
    false
  );
});

test("factura SIN CUFE → botón nunca se deshabilita por el checkbox (marcado o no)", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: false }),
    false
  );
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: true }),
    false
  );
});

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
//
// Dos motivos independientes: el motivo corto y el checkbox de la DGI. Los
// tests los cruzan porque el bug natural acá es que uno tape al otro — que el
// checkbox marcado "habilite" un botón que igual va a rebotar por el largo.
// ---------------------------------------------------------------------------

/** Un motivo que cumple el mínimo de la DGI (15). Son 31 caracteres. */
const MOTIVO_OK = "Datos del receptor incorrectos.";
/** Diez caracteres: pasaba con el mínimo viejo de 3, rebota con el nuevo. */
const MOTIVO_CORTO = "monto mal.";

test("factura CON CUFE y checkbox SIN marcar → botón deshabilitado", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: true, dgiConfirmed: false, reason: MOTIVO_OK }),
    true
  );
});

test("factura CON CUFE y checkbox marcado → botón habilitado", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: true, dgiConfirmed: true, reason: MOTIVO_OK }),
    false
  );
});

test("factura SIN CUFE → el checkbox no la deshabilita (marcado o no)", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: false, reason: MOTIVO_OK }),
    false
  );
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: true, reason: MOTIVO_OK }),
    false
  );
});

test("🔴 motivo corto → botón deshabilitado, aunque todo lo demás esté bien", () => {
  // Con el mínimo viejo de 3, "monto mal." pasaba y el error aparecía DESPUÉS
  // de apretar. Con 15 ese sería el caso corriente, no la excepción.
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: true, reason: MOTIVO_CORTO }),
    true
  );
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: true, dgiConfirmed: true, reason: MOTIVO_CORTO }),
    true,
    "el checkbox marcado NO compensa un motivo corto"
  );
});

test("motivo vacío → botón deshabilitado", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: false, reason: "" }),
    true
  );
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: false, reason: "      " }),
    true,
    "espacios no son un motivo"
  );
});

test("motivo justo en el borde (15) → el botón se habilita", () => {
  assert.equal(
    isCancelConfirmDisabled({ hasCufe: false, dgiConfirmed: false, reason: "a".repeat(15) }),
    false
  );
});

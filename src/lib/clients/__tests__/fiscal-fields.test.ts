/**
 * Tests de las reglas de campos fiscales de cliente (FE DGI).
 *
 * Ejecución:
 *   npx tsx --test src/lib/clients/__tests__/fiscal-fields.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  tipoRequiresDV,
  suggestTipoReceptorFe,
  isTipoReceptorFe,
  validateFiscalFields,
} from "@/lib/clients/fiscal-fields";

test("tipoRequiresDV: DV obligatorio solo para 01 y 03", () => {
  assert.equal(tipoRequiresDV("01"), true, "01 contribuyente requiere DV");
  assert.equal(tipoRequiresDV("03"), true, "03 gobierno requiere DV");
  assert.equal(tipoRequiresDV("02"), false, "02 consumidor final NO requiere DV");
  assert.equal(tipoRequiresDV("04"), false, "04 extranjero NO requiere DV");
  assert.equal(tipoRequiresDV(null), false);
  assert.equal(tipoRequiresDV(undefined), false);
  assert.equal(tipoRequiresDV(""), false);
});

test("suggestTipoReceptorFe: juridica → 01; natural → sin default", () => {
  assert.equal(suggestTipoReceptorFe("persona_juridica"), "01");
  // Persona natural NO se fuerza a 02: puede tener RUC y ser contribuyente.
  assert.equal(suggestTipoReceptorFe("persona_natural"), "");
  assert.equal(suggestTipoReceptorFe(null), "");
  assert.equal(suggestTipoReceptorFe(undefined), "");
});

test("isTipoReceptorFe: valida el dominio 01/02/03/04", () => {
  for (const t of ["01", "02", "03", "04"]) assert.equal(isTipoReceptorFe(t), true);
  for (const t of ["00", "05", "1", "", null, undefined, 1]) {
    assert.equal(isTipoReceptorFe(t), false, `${String(t)} no es tipo válido`);
  }
});

test("validateFiscalFields: 01 sin DV → error accionable", () => {
  const errs = validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "" });
  assert.ok(errs.digito_verificador, "debe faltar el DV");
  assert.match(errs.digito_verificador, /obligatorio/i);
});

test("validateFiscalFields: 03 sin DV → error", () => {
  const errs = validateFiscalFields({ tipo_receptor_fe: "03", digito_verificador: null });
  assert.ok(errs.digito_verificador);
});

test("validateFiscalFields: 01 con DV válido → ok", () => {
  const errs = validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "40" });
  assert.deepEqual(errs, {});
});

test("validateFiscalFields: 02 consumidor final sin DV → ok (no lo requiere)", () => {
  const errs = validateFiscalFields({ tipo_receptor_fe: "02", digito_verificador: "" });
  assert.deepEqual(errs, {}, "02 no requiere DV");
});

test("validateFiscalFields: 04 extranjero sin DV → ok", () => {
  const errs = validateFiscalFields({ tipo_receptor_fe: "04" });
  assert.deepEqual(errs, {});
});

test("validateFiscalFields: DV con formato inválido → error, aun en 02", () => {
  assert.ok(validateFiscalFields({ tipo_receptor_fe: "02", digito_verificador: "abc" }).digito_verificador);
  assert.ok(validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "123" }).digito_verificador, "3 dígitos es inválido");
  assert.deepEqual(validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "7" }), {}, "1 dígito es válido");
});

test("validateFiscalFields: tipo inválido → error", () => {
  assert.ok(validateFiscalFields({ tipo_receptor_fe: "09" }).tipo_receptor_fe);
});

test("validateFiscalFields: todo vacío → ok (campos opcionales para no-FE)", () => {
  assert.deepEqual(validateFiscalFields({}), {});
});

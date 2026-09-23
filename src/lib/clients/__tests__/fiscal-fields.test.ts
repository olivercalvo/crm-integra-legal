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

test("validateFiscalFields: 01 con DV y RUC válidos → ok", () => {
  const errs = validateFiscalFields({
    tipo_receptor_fe: "01",
    digito_verificador: "40",
    ruc: "8-123-456",
  });
  assert.deepEqual(errs, {});
});

test("🔴 validateFiscalFields: 01 SIN RUC → error en tax_id", () => {
  // Desde el 23/09/2026 el RUC se verifica al GUARDAR, no recién al emitir.
  // El caso real: una factura rechazada con 1601/1602, el cliente corregido
  // después del rechazo, y la factura nunca reenviada.
  const errs = validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "40" });
  assert.ok(errs.ruc, "el error tiene que nombrar el campo del RUC");
  assert.match(errs.ruc, /RUC/);
});

test("🔒 el error del RUC sale bajo la clave `ruc`, que es el campo en pantalla", () => {
  // Un error bajo una clave que ningún campo renderiza no se ve: el formulario
  // deja de avanzar y no dice por qué. Pasó, y lo encontró un clic.
  const errs = validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "40" });
  assert.ok(errs.ruc);
  assert.equal(errs.tax_id, undefined, "NO bajo `tax_id`: ese campo no existe en el formulario");
});

test("🔒 validateFiscalFields mira `tax_id ?? ruc`, que es lo que viaja", () => {
  // El mapper lee `tax_id ?? ruc`. Verificar sólo uno deja pasar lo que el
  // otro va a mandar — ya costó un intento de emisión.
  assert.deepEqual(
    validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "40", ruc: "8-123-456" }),
    {},
    "con `ruc` solo, alcanza"
  );
  assert.ok(
    validateFiscalFields({
      tipo_receptor_fe: "01",
      digito_verificador: "40",
      tax_id: "@@@@",
      ruc: "8-123-456",
    }).ruc,
    "un `tax_id` inválido NO lo tapa un `ruc` bueno: tax_id es el que viaja"
  );
});

test("validateFiscalFields: 03 gobierno también exige RUC", () => {
  assert.ok(validateFiscalFields({ tipo_receptor_fe: "03", digito_verificador: "1" }).ruc);
});

test("validateFiscalFields: 02 y 04 NO exigen RUC", () => {
  assert.deepEqual(validateFiscalFields({ tipo_receptor_fe: "02" }), {});
  assert.deepEqual(validateFiscalFields({ tipo_receptor_fe: "04" }), {});
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
  assert.deepEqual(
    validateFiscalFields({ tipo_receptor_fe: "01", digito_verificador: "7", ruc: "8-123-456" }),
    {},
    "1 dígito es válido"
  );
});

test("validateFiscalFields: tipo inválido → error", () => {
  assert.ok(validateFiscalFields({ tipo_receptor_fe: "09" }).tipo_receptor_fe);
});

test("validateFiscalFields: todo vacío → ok (campos opcionales para no-FE)", () => {
  assert.deepEqual(validateFiscalFields({}), {});
});

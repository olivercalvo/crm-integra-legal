/**
 * Alta y edición de una tasa de impuesto (2.4).
 *
 * El caso que estos tests existen para atrapar es uno solo y es el mismo de
 * siempre: alguien escribe **7** donde la base guarda **0.07**. La columna es
 * `NUMERIC(6,4)` y aguanta hasta 9.9999, así que sin la cota una factura saldría
 * con 700% de ITBMS y el error recién se vería en el total.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateCreateTaxCode,
  validateUpdateTaxCode,
} from "@/lib/finanzas/validators/tax-code";
import { parseTaxRatePercent, TAX_CODE_RE } from "@/lib/finanzas/types/tax-code";

const VALIDO = { code: "ITBMS_10", name: "ITBMS 10%", rate: 0.1, active: true };

test("un alta válida pasa y normaliza el código a mayúsculas", () => {
  const r = validateCreateTaxCode({ ...VALIDO, code: "itbms_10" });
  assert.ok(r.ok, "debería pasar");
  if (!r.ok) return;
  assert.equal(r.data.code, "ITBMS_10", "el código se guarda en mayúsculas");
  assert.equal(r.data.rate, 0.1);
  assert.equal(r.data.active, true);
});

test("🔴 rechaza la tasa escrita como porcentaje", () => {
  const r = validateCreateTaxCode({ ...VALIDO, rate: 7 });
  assert.ok(!r.ok, "7 no es una tasa: es 700%");
  if (r.ok) return;
  assert.match(r.errors.rate, /0\.07/, "el mensaje muestra cómo se escribe");
});

test("la tasa 0 es válida — una tasa exenta existe", () => {
  const r = validateCreateTaxCode({ ...VALIDO, code: "EXENTO_2", rate: 0 });
  assert.ok(r.ok, "0% tiene que poder cargarse");
});

test("rechaza tasa negativa y más de cuatro decimales", () => {
  assert.ok(!validateCreateTaxCode({ ...VALIDO, rate: -0.07 }).ok);
  assert.ok(!validateCreateTaxCode({ ...VALIDO, rate: 0.071234 }).ok);
  assert.ok(validateCreateTaxCode({ ...VALIDO, rate: 0.0725 }).ok, "4 decimales sí");
});

test("los tres campos son obligatorios en un alta", () => {
  for (const falta of ["code", "name", "rate"] as const) {
    const body: Record<string, unknown> = { ...VALIDO };
    delete body[falta];
    const r = validateCreateTaxCode(body);
    assert.ok(!r.ok, `sin ${falta} no debería pasar`);
    if (!r.ok) assert.ok(r.errors[falta], `el error tiene que nombrar ${falta}`);
  }
});

test("el código admite mayúsculas, números y guión bajo, y nada más", () => {
  for (const ok of ["ITBMS_7", "IVA21", "AB", "A_1"]) {
    assert.ok(TAX_CODE_RE.test(ok), `${ok} debería ser válido`);
  }
  for (const mal of ["a", "con espacio", "ITBMS-7", "ITBMS%", "ÑOÑO", "X".repeat(21)]) {
    assert.ok(!TAX_CODE_RE.test(mal), `${mal} NO debería ser válido`);
  }
});

test("un código con espacios o guión se rechaza con un mensaje que da el ejemplo", () => {
  const r = validateCreateTaxCode({ ...VALIDO, code: "ITBMS 10" });
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.match(r.errors.code, /ITBMS_10/, "el mensaje muestra la forma correcta");
});

test("parseTaxRatePercent convierte lo que la persona escribe", () => {
  // La pantalla pide el PORCENTAJE (D7) y manda el decimal.
  assert.equal(parseTaxRatePercent("7"), 0.07);
  assert.equal(parseTaxRatePercent("7.5"), 0.075);
  assert.equal(parseTaxRatePercent("7,5"), 0.075, "la coma decimal es normal en Panamá");
  assert.equal(parseTaxRatePercent("10%"), 0.1);
  assert.equal(parseTaxRatePercent("0"), 0);
  assert.equal(parseTaxRatePercent(""), null);
  assert.equal(parseTaxRatePercent("hola"), null);
});

/**
 * 🔒 EL PAYLOAD DEL BOTÓN DESACTIVAR / REACTIVAR.
 *
 * El control de la pantalla manda `{ active: !t.active }` y nada más. Si el
 * validador algún día exigiera `name` o `rate`, ese botón dejaría de funcionar
 * y el síntoma sería "no pasa nada al hacer clic" — el peor de todos, porque no
 * hay error que leer.
 *
 * Desactivar es lo más parecido a borrar que hay: cinco FK apuntan a
 * `tax_codes`, así que borrar rompería documentos ya emitidos.
 */
test("`{ active: false }` solo es un payload válido — es lo que manda el botón", () => {
  const r = validateUpdateTaxCode({ active: false });
  assert.ok(r.ok, "desactivar no necesita mandar nombre ni tasa");
  if (!r.ok) return;
  assert.equal(r.data.active, false);
  assert.ok(!("name" in r.data), "no inventa un nombre");
  assert.ok(!("rate" in r.data), "ni una tasa");
});

test("`{ active: true }` solo también — reactivar es el mismo camino", () => {
  const r = validateUpdateTaxCode({ active: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.data.active, true);
});

test("un payload vacío sigue siendo un error", () => {
  const r = validateUpdateTaxCode({});
  assert.ok(!r.ok, "sin cambios no hay nada que guardar");
  if (r.ok) return;
  assert.ok(r.errors.general, "y el error lo dice");
});

test("`active` tiene que ser booleano, no la cadena \"false\"", () => {
  const r = validateUpdateTaxCode({ active: "false" });
  assert.ok(!r.ok, '"false" es truthy: aceptarlo activaría lo que se quiso desactivar');
});

test("la edición sigue sin admitir el código: se elige una vez", () => {
  const r = validateUpdateTaxCode({ code: "OTRO", name: "Nombre nuevo" });
  assert.ok(r.ok, "el resto del payload es válido");
  if (!r.ok) return;
  assert.ok(
    !("code" in r.data),
    "cambiar el código dejaría documentos apuntando a uno que ya no existe"
  );
});

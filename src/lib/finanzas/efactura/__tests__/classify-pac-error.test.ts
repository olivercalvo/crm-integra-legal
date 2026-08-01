/**
 * Tests del clasificador de errores del PAC (rechazo duro vs duplicado).
 *
 * Caso real (2026-08): al emitir con un RUC inválido el diálogo mostraba a la
 * vez "El PAC indicó que el documento ya existe. Posiblemente ya fue
 * autorizado" JUNTO con "1601: Regla de formación del RUC inválida" y "1602:
 * RUC inexistente...". La licenciada creyó que debía ANULAR cuando en realidad
 * era un rechazo por RUC.
 *
 * Dos bugs: (1) `includes("existente")` matcheaba dentro de "inEXISTENTE";
 * (2) `.some()` dejaba que un match dudoso reclasificara todo el rechazo.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/classify-pac-error.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPacError,
  hintForCodRes,
  isDuplicateSignal,
  isHardRejection,
  isNonRejectionCode,
  RUC_REJECTION_CODES,
  type CodRes,
} from "@/lib/finanzas/efactura/orchestration/classify-pac-error";

const FALLBACK = "El PAC rechazó el documento.";

/** El payload exacto que produjo la confusión. */
const CODRES_RUC_INVALIDO: CodRes[] = [
  { dCodRes: "1601", dMsgRes: "Regla de formación del RUC inválida" },
  {
    dCodRes: "1602",
    dMsgRes: "RUC inexistente en el Registro Único de Contribuyentes",
  },
];

const CODRES_DUPLICADO: CodRes[] = [
  { dCodRes: "0300", dMsgRes: "El documento ya existe y fue autorizado previamente" },
];

// ---------------------------------------------------------------------------
// 1) El caso que rompió: códigos de rechazo → NO duplicado
// ---------------------------------------------------------------------------

test("CASO REAL: 1601+1602 clasifica como RECHAZO, no como duplicado", () => {
  const c = classifyPacError(CODRES_RUC_INVALIDO, FALLBACK);
  assert.equal(c.errorKind, "pac_rejected");
});

test("CASO REAL: el mensaje NO contiene el texto de duplicado/autorizado", () => {
  const c = classifyPacError(CODRES_RUC_INVALIDO, FALLBACK);
  const msg = c.errorMessage.toLowerCase();
  assert.equal(msg.includes("ya existe"), false, "no debe decir 'ya existe'");
  assert.equal(msg.includes("posiblemente"), false, "no debe decir 'posiblemente'");
  assert.equal(msg.includes("autorizado"), false, "no debe decir 'autorizado'");
  assert.equal(msg.includes("anular"), false);
});

test("CASO REAL: el mensaje SÍ contiene el motivo real (ambos códigos)", () => {
  const c = classifyPacError(CODRES_RUC_INVALIDO, FALLBACK);
  assert.match(c.errorMessage, /1601/);
  assert.match(c.errorMessage, /Regla de formación del RUC inválida/);
  assert.match(c.errorMessage, /1602/);
});

test("CASO REAL: agrega la guía accionable de RUC", () => {
  const c = classifyPacError(CODRES_RUC_INVALIDO, FALLBACK);
  assert.equal(
    c.errorHint,
    "El RUC del cliente parece inválido o incompleto. " +
      "Verifica el RUC en la ficha del cliente y reintenta."
  );
});

test("REGRESIÓN substring: 'RUC inexistente' NO es señal de duplicado", () => {
  assert.equal(
    isDuplicateSignal({
      dCodRes: "1602",
      dMsgRes: "RUC inexistente en el Registro Único de Contribuyentes",
    }),
    false
  );
});

test("REGRESIÓN substring: otras negaciones tampoco son duplicado", () => {
  for (const msg of [
    "El RUC no existe",
    "Receptor no se encuentra registrado",
    "Documento inexistente",
  ]) {
    assert.equal(isDuplicateSignal({ dMsgRes: msg }), false, `falló: ${msg}`);
  }
});

// ---------------------------------------------------------------------------
// 2) El duplicado legítimo sigue funcionando
// ---------------------------------------------------------------------------

test("Duplicado SIN códigos de rechazo → sí clasifica pac_duplicate", () => {
  const c = classifyPacError(CODRES_DUPLICADO, FALLBACK);
  assert.equal(c.errorKind, "pac_duplicate");
  assert.match(c.errorMessage, /ya existe/);
  assert.match(c.errorMessage, /Posiblemente ya fue autorizado/);
  assert.equal(c.errorHint, null);
});

test("Variantes de mensaje de duplicado siguen detectándose", () => {
  for (const msg of [
    "Documento duplicado",
    "La factura ya fue autorizada",
    "El documento ya fue emitido",
    "Comprobante ya existe en DGI",
    "Documento existente en el sistema",
  ]) {
    assert.equal(
      classifyPacError([{ dCodRes: "0300", dMsgRes: msg }], FALLBACK).errorKind,
      "pac_duplicate",
      `falló: ${msg}`
    );
  }
});

test("PRECEDENCIA: duplicado + un código de rechazo → gana el RECHAZO", () => {
  const mixto: CodRes[] = [
    ...CODRES_DUPLICADO,
    { dCodRes: "1601", dMsgRes: "Regla de formación del RUC inválida" },
  ];
  const c = classifyPacError(mixto, FALLBACK);
  assert.equal(c.errorKind, "pac_rejected");
  // y el texto de duplicado se descarta del mensaje
  assert.equal(c.errorMessage.toLowerCase().includes("ya existe"), false);
  assert.match(c.errorMessage, /1601/);
});

// ---------------------------------------------------------------------------
// 3) Predicados y bordes
// ---------------------------------------------------------------------------

test("isNonRejectionCode: 0260 (autorizado) y ceros no son rechazo", () => {
  assert.equal(isNonRejectionCode("0260"), true);
  assert.equal(isNonRejectionCode("0000"), true);
  assert.equal(isNonRejectionCode("0"), true);
  assert.equal(isNonRejectionCode("1601"), false);
  assert.equal(isNonRejectionCode(undefined), false);
});

test("isHardRejection: 0260 no rechaza; 1601 sí", () => {
  assert.equal(isHardRejection({ dCodRes: "0260", dMsgRes: "Autorizado el uso de la FE" }), false);
  assert.equal(isHardRejection({ dCodRes: "1601", dMsgRes: "RUC inválido" }), true);
  assert.equal(isHardRejection({}), false, "entrada vacía no es rechazo");
});

test("Un 0260 suelto junto a un duplicado NO impide clasificar duplicado", () => {
  const c = classifyPacError(
    [{ dCodRes: "0260", dMsgRes: "Autorizado el uso de la FE" }, ...CODRES_DUPLICADO],
    FALLBACK
  );
  assert.equal(c.errorKind, "pac_duplicate");
});

test("Sin códigos → rechazo con el fallback, sin guía", () => {
  const c = classifyPacError([], FALLBACK);
  assert.equal(c.errorKind, "pac_rejected");
  assert.equal(c.errorMessage, FALLBACK);
  assert.equal(c.errorHint, null);
});

test("Código de rechazo sin guía asociada → errorHint null", () => {
  const c = classifyPacError([{ dCodRes: "1571", dMsgRes: "Ubicación del emisor requerida" }], FALLBACK);
  assert.equal(c.errorKind, "pac_rejected");
  assert.equal(c.errorHint, null);
});

test("hintForCodRes cubre ambos códigos de RUC por separado", () => {
  for (const code of RUC_REJECTION_CODES) {
    assert.notEqual(hintForCodRes([{ dCodRes: code, dMsgRes: "x" }]), null, `falló: ${code}`);
  }
});

test("La guía usa tuteo neutro panameño (voseo es anti-patrón, CLAUDE.md)", () => {
  const hint = hintForCodRes([{ dCodRes: "1601" }])!;
  assert.match(hint, /Verifica/);
  assert.match(hint, /reintenta/);
  assert.equal(/Verificá|reintentá/.test(hint), false);
});

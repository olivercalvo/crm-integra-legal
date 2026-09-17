/**
 * `invoice_kind` ↔ `service_type` — una factura de REEMBOLSO no puede llevar
 * una línea de HONORARIOS, y viceversa.
 *
 * Josuarth Torres, por correo el 17/09/2026: *"Las facturas de reembolso solo
 * deben ser usadas para la facturación de lo que realmente representa un
 * reembolso de gasto y es exenta del impuesto."* Tres facturas de producción
 * (jul-ago/2026) tenían líneas HON-COR dentro de una FAC-REI-*.
 *
 * Este archivo prueba el módulo PURO (`validarConsistenciaDeKind` +
 * `motivoDeInconsistenciaDeKind`). No toca la base — eso lo cubre
 * `api/__tests__/invoice-kind-gate.test.ts`, con el fake-db.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  validarConsistenciaDeKind,
  motivoDeInconsistenciaDeKind,
  type ServicioParaConsistenciaDeKind,
} from "@/lib/finanzas/validators/invoice";

const HON_COR: ServicioParaConsistenciaDeKind = {
  code: "HON-COR",
  name: "Honorarios corporativos",
  service_type: "honorarios",
};
const REIM_JUD: ServicioParaConsistenciaDeKind = {
  code: "REIM-JUD",
  name: "Reembolso de gastos judiciales",
  service_type: "reembolso",
};

function mapaCon(...pares: [string, ServicioParaConsistenciaDeKind][]) {
  return new Map(pares);
}

test("🔴 el caso real: HON-COR dentro de una factura de REEMBOLSO se rechaza", () => {
  const servicios = mapaCon(["s1", HON_COR]);
  const errors = validarConsistenciaDeKind(
    [{ service_id: "s1" }],
    servicios,
    "REEMBOLSO"
  );
  assert.match(errors["lines.0.service"], /Honorarios/);
  assert.match(errors["lines.0.service"], /Reembolso/);
});

test("el caso espejo: REIM-JUD dentro de una factura de HONORARIOS también se rechaza", () => {
  const servicios = mapaCon(["s1", REIM_JUD]);
  const errors = validarConsistenciaDeKind(
    [{ service_id: "s1" }],
    servicios,
    "HONORARIOS"
  );
  assert.match(errors["lines.0.service"], /Reembolso/);
  assert.match(errors["lines.0.service"], /Honorarios/);
});

test("una línea que combina no genera error", () => {
  const servicios = mapaCon(["s1", HON_COR], ["s2", REIM_JUD]);
  assert.deepEqual(
    validarConsistenciaDeKind([{ service_id: "s1" }], servicios, "HONORARIOS"),
    {}
  );
  assert.deepEqual(
    validarConsistenciaDeKind([{ service_id: "s2" }], servicios, "REEMBOLSO"),
    {}
  );
});

test("una línea Personalizada (service_id: null) nunca se juzga", () => {
  const servicios = mapaCon(["s1", HON_COR]);
  assert.deepEqual(
    validarConsistenciaDeKind([{ service_id: null }], servicios, "REEMBOLSO"),
    {}
  );
});

test("un service_id que no está en el Map (borrado, u otro tenant) no rompe: se ignora", () => {
  const servicios = mapaCon(["s1", HON_COR]);
  assert.deepEqual(
    validarConsistenciaDeKind([{ service_id: "no-existe" }], servicios, "REEMBOLSO"),
    {}
  );
});

test("nombra la LÍNEA correcta entre varias, no solo la primera con problema", () => {
  const servicios = mapaCon(["s1", REIM_JUD], ["s2", HON_COR]);
  const errors = validarConsistenciaDeKind(
    [{ service_id: "s1" }, { service_id: "s2" }],
    servicios,
    "REEMBOLSO"
  );
  assert.equal(errors["lines.0.service"], undefined, "la línea 0 (REIM-JUD) está bien");
  assert.ok(errors["lines.1.service"], "la línea 1 (HON-COR) es la que falla");
});

test("varias líneas mal: cada una reporta su propio error", () => {
  const servicios = mapaCon(["s1", HON_COR], ["s2", HON_COR]);
  const errors = validarConsistenciaDeKind(
    [{ service_id: "s1" }, { service_id: "s2" }],
    servicios,
    "REEMBOLSO"
  );
  assert.ok(errors["lines.0.service"]);
  assert.ok(errors["lines.1.service"]);
});

// ---------------------------------------------------------------------------
// El motivo (SOP-027: un solo motivo, el próximo paso, el elemento nombrado)
// ---------------------------------------------------------------------------

test("el motivo nombra el código, el nombre del servicio y las dos salidas posibles", () => {
  const servicios = mapaCon(["s1", HON_COR]);
  const motivo = motivoDeInconsistenciaDeKind(
    [{ description: "Cambio de junta directiva", service_id: "s1" }],
    servicios,
    "REEMBOLSO"
  );
  assert.match(motivo ?? "", /línea 1/i);
  assert.match(motivo ?? "", /HON-COR/);
  assert.match(motivo ?? "", /Honorarios corporativos/);
  assert.match(motivo ?? "", /Cambie el servicio/);
  assert.match(motivo ?? "", /Tipo de documento a Honorarios/);
});

test("sin inconsistencias, el motivo es null", () => {
  const servicios = mapaCon(["s1", HON_COR]);
  assert.equal(
    motivoDeInconsistenciaDeKind([{ description: "x", service_id: "s1" }], servicios, "HONORARIOS"),
    null
  );
});

test("con varias líneas mal, el motivo nombra la PRIMERA (el próximo paso, no la lista)", () => {
  const servicios = mapaCon(["s1", HON_COR], ["s2", HON_COR]);
  const motivo = motivoDeInconsistenciaDeKind(
    [
      { description: "Primera", service_id: "s1" },
      { description: "Segunda", service_id: "s2" },
    ],
    servicios,
    "REEMBOLSO"
  );
  assert.match(motivo ?? "", /línea 1/i);
  assert.ok(!/línea 2/i.test(motivo ?? ""), "no debe mencionar la segunda línea");
});

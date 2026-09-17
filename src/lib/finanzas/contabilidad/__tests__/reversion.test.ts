/**
 * EL ASIENTO ESPEJO — `construirAsientoDeReversion`.
 *
 * Lo que se prueba acá es lo que la pantalla muestra y el servidor postea, con
 * la misma función. Si algo de esto cambia, cambia en los dos lados a la vez.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  construirAsientoDeReversion,
  MOTIVO_MAX,
  type AsientoAReversar,
} from "@/lib/finanzas/contabilidad/reversion";

const COBRO: AsientoAReversar = {
  id: "e0000000-0000-0000-0000-000000000010",
  entry_number: 10,
  transaction_date: "2026-06-15",
  description: "Cobro de FAC-HON-000002 — Corporación Andes",
  reference: "FAC-HON-000002",
  lines: [
    { account_code: "100001", account_name: "Banco General Operativa", debit: 1000, credit: 0, description: "Cobro FAC-HON-000002" },
    { account_code: "100004", account_name: "Cuentas por Cobrar", debit: 0, credit: 1000, description: "Corporación Andes" },
  ],
};

const HOY = "2026-09-17";
const PAGO = "44444444-4444-4444-4444-444444444444";

function ok(r: ReturnType<typeof construirAsientoDeReversion>) {
  assert.equal(r.ok, true, "ok" in r && !r.ok ? r.mensaje : undefined);
  return (r as { ok: true; asiento: import("@/lib/finanzas/contabilidad/posting").AsientoInput }).asiento;
}

test("el espejo intercambia débito y crédito, cuenta por cuenta y en el mismo orden", () => {
  const a = ok(construirAsientoDeReversion(COBRO, { hoy: HOY, motivo: "Cheque devuelto", source_id: PAGO }));
  assert.deepEqual(
    a.lines.map((l) => [l.account_code, l.debit, l.credit]),
    [
      ["100001", 0, 1000], // el banco, que había entrado, sale
      ["100004", 1000, 0], // la cuenta por cobrar vuelve a estar viva
    ]
  );
});

test("lleva la fecha de HOY, nunca la del original (acta del 09/09/2026)", () => {
  const a = ok(construirAsientoDeReversion(COBRO, { hoy: HOY, motivo: "Cheque devuelto", source_id: PAGO }));
  assert.equal(a.transaction_date, HOY);
  assert.notEqual(a.transaction_date, COBRO.transaction_date);
});

test("apunta al original, es de tipo reversion, lleva el motivo y hereda la referencia", () => {
  const a = ok(construirAsientoDeReversion(COBRO, { hoy: HOY, motivo: "  Cheque devuelto  ", source_id: PAGO }));
  assert.equal(a.source_type, "reversion");
  assert.equal(a.reverses_entry_id, COBRO.id);
  assert.equal(a.reversal_reason, "Cheque devuelto", "el motivo va trimeado");
  assert.equal(a.source_id, PAGO);
  assert.equal(a.reference, "FAC-HON-000002");
  assert.match(a.description, /^Reversión del asiento 10 — Cobro de FAC-HON-000002/);
});

test("las descripciones de línea dicen que son una reversión, pero no entran en el cuadre", () => {
  const a = ok(construirAsientoDeReversion(COBRO, { hoy: HOY, motivo: "Cheque devuelto", source_id: PAGO }));
  assert.equal(a.lines[0].description, "Reversión: Cobro FAC-HON-000002");
  assert.equal(a.lines[1].description, "Reversión: Corporación Andes");
  const sinDescr = { ...COBRO, lines: COBRO.lines.map((l) => ({ ...l, description: null })) };
  const b = ok(construirAsientoDeReversion(sinDescr, { hoy: HOY, motivo: "Cheque devuelto", source_id: PAGO }));
  assert.equal(b.lines[0].description, "Reversión");
});

test("el espejo de algo que cuadra, cuadra", () => {
  const original: AsientoAReversar = {
    ...COBRO,
    lines: [
      { account_code: "100001", debit: 107, credit: 0, description: null },
      { account_code: "400004", debit: 0, credit: 100, description: null },
      { account_code: "200003", debit: 0, credit: 7, description: null },
    ],
  };
  const a = ok(construirAsientoDeReversion(original, { hoy: HOY, motivo: "Error de carga", source_id: PAGO }));
  const deb = a.lines.reduce((s, l) => s + l.debit, 0);
  const cre = a.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(deb, cre);
  assert.equal(deb, 107);
});

test("rechaza un motivo de menos de 3 caracteres, o de más de 1000", () => {
  const corto = construirAsientoDeReversion(COBRO, { hoy: HOY, motivo: " no ", source_id: PAGO });
  assert.equal(corto.ok, false);
  assert.equal(!corto.ok && corto.motivo, "motivo_corto");

  const largo = construirAsientoDeReversion(COBRO, { hoy: HOY, motivo: "x".repeat(MOTIVO_MAX + 1), source_id: PAGO });
  assert.equal(largo.ok, false);
  assert.equal(!largo.ok && largo.motivo, "motivo_largo");
});

test("rechaza una fecha anterior al asiento que revierte, o mal formada", () => {
  const antes = construirAsientoDeReversion(COBRO, { hoy: "2026-06-14", motivo: "Cheque devuelto", source_id: PAGO });
  assert.equal(antes.ok, false);
  assert.equal(!antes.ok && antes.motivo, "fecha_anterior");

  const mismoDia = construirAsientoDeReversion(COBRO, { hoy: "2026-06-15", motivo: "Cheque devuelto", source_id: PAGO });
  assert.equal(mismoDia.ok, true, "el mismo día del original sí vale");

  const rota = construirAsientoDeReversion(COBRO, { hoy: "17/09/2026", motivo: "Cheque devuelto", source_id: PAGO });
  assert.equal(rota.ok, false);
  assert.equal(!rota.ok && rota.motivo, "fecha_invalida");
});

test("rechaza un asiento sin líneas suficientes", () => {
  const r = construirAsientoDeReversion({ ...COBRO, lines: [COBRO.lines[0]] }, { hoy: HOY, motivo: "Cheque devuelto", source_id: PAGO });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.motivo, "sin_lineas");
});

test("no muta el asiento original", () => {
  const copia = JSON.parse(JSON.stringify(COBRO));
  construirAsientoDeReversion(COBRO, { hoy: HOY, motivo: "Cheque devuelto", source_id: PAGO });
  assert.deepEqual(COBRO, copia);
});

/**
 * 🔒 HOY EN PANAMÁ — no el día UTC.
 *
 *   npm test
 *
 * Panamá está en UTC-5 todo el año. Hasta el Bloque 1 (E1) el módulo contable
 * calculaba "hoy" con `toISOString()` y, desde las 19:00 de Panamá, el día UTC
 * ya era mañana: una nota de crédito del 30/09 a las 20:00 quedaba fechada el
 * 01/10, en otro período. Estos tests fijan la hora exacta del cambio.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { hoyEnPanama } from "../hoy-en-panama";

test("a las 19:00 de Panamá (00:00 UTC del día siguiente) sigue siendo HOY en Panamá", () => {
  const ahora = new Date("2026-10-01T00:00:00Z"); // 30/09 19:00 en Panamá
  assert.equal(ahora.toISOString().slice(0, 10), "2026-10-01", "el día UTC ya cambió");
  assert.equal(hoyEnPanama(ahora), "2026-09-30");
});

test("a las 20:00 de Panamá del 30/09 el período sigue siendo septiembre", () => {
  assert.equal(hoyEnPanama(new Date("2026-10-01T01:00:00Z")), "2026-09-30");
});

test("23:59 de Panamá todavía es el mismo día; 00:00 de Panamá ya es el siguiente", () => {
  assert.equal(hoyEnPanama(new Date("2026-10-01T04:59:59Z")), "2026-09-30");
  assert.equal(hoyEnPanama(new Date("2026-10-01T05:00:00Z")), "2026-10-01");
});

test("cambio de año: 31/12 a las 21:00 de Panamá no es enero", () => {
  assert.equal(hoyEnPanama(new Date("2027-01-01T02:00:00Z")), "2026-12-31");
});

test("de mañana coincide con el día UTC", () => {
  assert.equal(hoyEnPanama(new Date("2026-09-30T14:00:00Z")), "2026-09-30");
});

test("🔒 el módulo contable no vuelve a calcular 'hoy' en UTC", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const archivos = [
    "src/lib/finanzas/api/asientos.ts",
    "src/lib/finanzas/api/credit-notes.ts",
    "src/lib/finanzas/api/expense-tramite.ts",
    "src/lib/finanzas/api/importacion-asientos.ts",
    "src/lib/finanzas/api/invoices.ts",
    "src/lib/finanzas/api/payments.ts",
    "src/lib/finanzas/api/supplier-credit-notes.ts",
    "src/lib/finanzas/api/supplier-payments.ts",
    "src/app/finanzas/asientos/page.tsx",
    "src/app/finanzas/facturas/_components/reverse-payment-dialog.tsx",
    "src/app/finanzas/gastos-bufete/_components/supplier-credit-notes-section.tsx",
    "src/components/cases/section-expense-form.tsx",
  ];
  for (const a of archivos) {
    const src = readFileSync(resolve(process.cwd(), a), "utf8");
    assert.doesNotMatch(
      src,
      /new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\])/,
      `${a} calcula "hoy" en UTC: usa hoyEnPanama()`
    );
  }
});

/**
 * 🔒 SALDO DE PROVEEDORES DESDE LA ANTIGÜEDAD (14/10/2026).
 *
 * El listado y la ficha toman el saldo de la fila del proveedor en la
 * antigüedad por pagar: compras y partidas importadas cuentan igual. Ninguno
 * vuelve a sumar `business_expenses` por su cuenta.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildAntiguedad, type DocumentoPendiente } from "@/lib/finanzas/reports/antiguedad";
import { saldosPorProveedor } from "../saldos-de-proveedores";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

const doc = (id: string, terceroId: string, saldo: number, extra: Partial<DocumentoPendiente> = {}): DocumentoPendiente => ({
  id, numero: id, tercero: terceroId, terceroId, fechaReferencia: "2026-09-01", diasVencido: 10, saldo, sourceType: "gasto", ...extra,
});

test("compras del módulo y partidas importadas suman en el mismo proveedor", () => {
  const documentos = [
    doc("FAC-CO-1", "prv-modulo", 100),
    doc("FAC-CO-2", "prv-modulo", 0),
    doc("AD-9:prv-star", "prv-star", 535.5, { sourceType: "manual", entryId: "e9" }),
    doc("AD-10:prv-star", "prv-star", 64.5, { sourceType: "manual", entryId: "e10" }),
  ];
  const control = { saldoCuentaControl: 700, saldoApertura: 0, sinAsiento: { documentos: { cantidad: 0, monto: 0 }, cobros: { cantidad: 0, monto: 0 } } };
  const reporte = buildAntiguedad(documentos, control as never);
  const s = saldosPorProveedor(reporte.filas);
  assert.equal(s.get("prv-star")?.saldo, 600);
  assert.equal(s.get("prv-star")?.pendientes, 2, "las dos partidas importadas cuentan");
  assert.equal(s.get("prv-modulo")?.saldo, 100);
  assert.equal(s.get("prv-modulo")?.pendientes, 1, "una compra pagada no es pendiente");
  // Mismo total que el reporte.
  const suma = Array.from(s.values()).reduce((t, x) => t + x.saldo, 0);
  assert.equal(suma, reporte.total);
});

test("🔒 el listado y la ficha leen el saldo de la antigüedad, no de business_expenses", () => {
  const q = leer("src/lib/finanzas/queries/suppliers.ts");
  const lista = q.slice(q.indexOf("export async function listSuppliers"), q.indexOf("export async function getSupplier"));
  assert.match(lista, /cargarSaldosDeProveedores\(/);
  assert.doesNotMatch(lista, /business_expenses/);
  const ficha = leer("src/app/finanzas/proveedores/[id]/page.tsx");
  assert.match(ficha, /cargarSaldosDeProveedores\(/);
  assert.match(leer("src/lib/finanzas/queries/saldos-de-proveedores.ts"), /loadAntiguedad\([^)]*"pagar"/);
});

/**
 * 🔒 El detalle de una compra muestra el proveedor de la FICHA, con RUC y DV.
 *
 * Hasta el 25/09/2026 leía solo el texto libre de respaldo (`supplier_name`) y
 * una compra con proveedor elegido de la lista salía con los campos vacíos.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { proveedorDelDetalle } from "../business-expense";

const ficha = {
  id: "s1",
  supplier_number: "PRV-002",
  legal_name: "LABENDE CORP",
  trade_name: "Cliente en el Centro",
  payment_terms_days: 30,
  ruc: "123456",
  dv: "05",
};

test("con proveedor de la lista: nombre, número, RUC y DV de la ficha", () => {
  assert.deepEqual(
    proveedorDelDetalle({ supplier: ficha, supplier_name: null, supplier_ruc: null }),
    { nombre: "Cliente en el Centro", numero: "PRV-002", ruc: "123456", dv: "05" }
  );
});

test("la ficha manda sobre el texto viejo aunque los dos existan", () => {
  const r = proveedorDelDetalle({ supplier: ficha, supplier_name: "Otro nombre", supplier_ruc: "999" });
  assert.equal(r.ruc, "123456");
  assert.equal(r.dv, "05");
});

test("sin ficha: cae al texto de respaldo de la 033, sin DV", () => {
  assert.deepEqual(
    proveedorDelDetalle({ supplier: null, supplier_name: "Ferretería X", supplier_ruc: "8-123-456" }),
    { nombre: "Ferretería X", numero: null, ruc: "8-123-456", dv: null }
  );
});

test("sin nada: todo vacío, no textos en blanco", () => {
  assert.deepEqual(
    proveedorDelDetalle({ supplier: null, supplier_name: "  ", supplier_ruc: null }),
    { nombre: null, numero: null, ruc: null, dv: null }
  );
});

test("🔒 la pantalla usa el helper y ya no lee supplier_name directo", () => {
  const raiz = path.resolve(__dirname, "../../../../..");
  const page = readFileSync(path.join(raiz, "src/app/finanzas/gastos-bufete/[id]/page.tsx"), "utf8");
  assert.match(page, /proveedorDelDetalle\(expense\)/);
  assert.doesNotMatch(page, /expense\.supplier_name/);
  assert.doesNotMatch(page, /expense\.supplier_ruc/);
  assert.match(page, /label="DV"/, "el DV va en su propio campo");
});

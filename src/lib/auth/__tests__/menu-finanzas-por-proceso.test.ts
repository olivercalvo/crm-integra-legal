/**
 * Requerimiento 44 (Josuarth, punto 14 de la revisión del 28/09): el menú de
 * Finanzas va por proceso. Fija el orden de los grupos, que cada opción tenga
 * grupo y que el ítem activo sea el más específico.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { getActiveItemHref, getSidebarGroups, getSidebarItems, getTab } from "@/lib/nav-config";

test("Finanzas tiene los cinco grupos, en orden, y ninguna opción queda sin grupo", () => {
  const tab = getTab("finanzas")!;
  assert.deepEqual(tab.groups, ["Ventas", "Compras", "Asientos", "Reportes", "Configuración"]);
  const sinGrupo = tab.items.filter((i) => !i.group || !tab.groups!.includes(i.group));
  assert.deepEqual(sinGrupo.map((i) => i.label), []);
});

test("cada opción está en su grupo", () => {
  const grupoDe = (href: string) => getTab("finanzas")!.items.find((i) => i.href === href)?.group;
  assert.equal(grupoDe("/legal/clientes"), "Ventas");
  assert.equal(grupoDe("/finanzas/facturas"), "Ventas");
  assert.equal(grupoDe("/finanzas/facturas-externas"), "Ventas");
  assert.equal(grupoDe("/finanzas/gastos-bufete"), "Compras");
  assert.equal(grupoDe("/finanzas/notas-credito-proveedor"), "Compras");
  assert.equal(grupoDe("/finanzas/asientos/importar"), "Asientos");
  assert.equal(grupoDe("/finanzas/asientos/documentos-existentes"), "Asientos");
  assert.equal(grupoDe("/finanzas/reportes/aging"), "Reportes");
  assert.equal(grupoDe("/finanzas/reportes/vat-summary"), "Reportes");
  // Saldos iniciales: la pantalla Apertura, en su ruta de siempre.
  assert.equal(grupoDe("/finanzas/asientos/apertura"), "Configuración");
});

test("el contador no ve Clientes (Legal) y la abogada no ve Asientos", () => {
  const contador = getSidebarItems("finanzas", "contador").map((i) => i.href);
  assert.ok(!contador.some((h) => h.startsWith("/legal")));
  const abogada = getSidebarGroups("finanzas", "abogada").map((g) => g.group);
  assert.deepEqual(abogada, ["Ventas", "Compras", "Reportes", "Configuración"]);
});

test("se pinta sólo el ítem más específico", () => {
  const items = getSidebarItems("finanzas", "contador");
  assert.equal(getActiveItemHref(items, "/finanzas/asientos/apertura"), "/finanzas/asientos/apertura");
  assert.equal(getActiveItemHref(items, "/finanzas/asientos/abc"), "/finanzas/asientos");
  assert.equal(getActiveItemHref(items, "/finanzas/reportes/mayor"), "/finanzas/reportes/mayor");
  assert.equal(getActiveItemHref(items, "/finanzas/reportes"), "/finanzas/reportes");
});

/**
 * 🔒 MENÚ COLAPSABLE (Josuarth, 14/10/2026): por defecto sólo el grupo de la
 * página actual; lo guardado se respeta; el grupo actual se abre siempre; un
 * almacenamiento roto da el comportamiento por defecto; el sidebar y el menú del
 * celular usan el MISMO hook.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { getActiveItemHref, getSidebarGroups, getSidebarItems } from "@/lib/nav-config";
import { alternarGrupo, claveDeGrupos, grupoActivo, gruposAbiertos, leerGuardados } from "@/lib/nav-grupos";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

test("por defecto, sólo el grupo de la página actual", () => {
  const grupos = getSidebarGroups("finanzas", "contador");
  const activo = grupoActivo(grupos, getActiveItemHref(getSidebarItems("finanzas", "contador"), "/finanzas/reportes/mayor"));
  assert.equal(activo, "Reportes");
  assert.deepEqual(Array.from(gruposAbiertos(null, activo, grupos.map((g) => g.group!))), ["Reportes"]);
});

test("lo guardado se respeta, y el grupo actual se abre aunque lo hubiera cerrado", () => {
  const existentes = ["Ventas", "Compras", "Asientos", "Reportes", "Configuración"];
  const a = gruposAbiertos(["Compras"], "Ventas", existentes);
  assert.deepEqual(Array.from(a).sort(), ["Compras", "Ventas"]);
  // Un grupo guardado que el rol ya no tiene no aparece.
  assert.deepEqual(Array.from(gruposAbiertos(["Asientos"], null, ["Ventas", "Reportes"])), []);
});

test("un valor guardado roto es el comportamiento por defecto", () => {
  for (const malo of [null, "", "{", "123", '{"a":1}', '[1,2]']) assert.equal(leerGuardados(malo), null, String(malo));
  assert.deepEqual(leerGuardados('["Ventas"]'), ["Ventas"]);
});

test("alternar abre y cierra; la clave es por módulo y rol", () => {
  const s = alternarGrupo(new Set(["Ventas"]), "Compras");
  assert.deepEqual(Array.from(s).sort(), ["Compras", "Ventas"]);
  assert.deepEqual(Array.from(alternarGrupo(s, "Ventas")), ["Compras"]);
  assert.notEqual(claveDeGrupos("finanzas", "admin"), claveDeGrupos("finanzas", "contador"));
});

test("un rol no ve grupos sin opciones: la abogada no tiene Asientos", () => {
  const grupos = getSidebarGroups("finanzas", "abogada").map((g) => g.group);
  assert.ok(!grupos.includes("Asientos"), grupos.join(", "));
  assert.ok(getSidebarGroups("finanzas", "contador").some((g) => g.group === "Asientos"));
});

test("🔒 el sidebar y el menú del celular usan el mismo hook, y localStorage va con try/catch", () => {
  for (const c of ["src/components/layout/contextual-sidebar.tsx", "src/components/layout/mobile-drawer.tsx"]) {
    const s = leer(c);
    assert.match(s, /useGruposAbiertos\(/, c);
    assert.match(s, /aria-expanded=\{abierto\}/, c);
  }
  const hook = leer("src/components/layout/use-grupos-abiertos.ts");
  assert.equal((hook.match(/localStorage\./g) ?? []).length, (hook.match(/try \{/g) ?? []).length);
});

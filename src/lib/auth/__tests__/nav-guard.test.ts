/**
 * EL SIDEBAR Y EL MIDDLEWARE TIENEN QUE DECIR LO MISMO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA EVITA ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * El 01/09/2026, con el contador del cliente a punto de entrar a staging, se
 * encontró que el sidebar le ofrecía "Plan de Cuentas" y el middleware lo
 * rebotaba a /finanzas/reportes. Un botón que existe y no lleva a ninguna parte
 * le hace dudar del resto del sistema a quien lo aprieta.
 *
 * No fue un descuido puntual: eran dos listas de permisos en dos archivos, sin
 * nada que las obligara a coincidir. Encontrarlo dependía de que una persona
 * recorriera el menú con cada rol, y eso no escala ni se repite.
 *
 * Mismo criterio que el guard de `amount_paid`: que lo detecte una máquina y no
 * una pantalla que alguien mire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS DOS ERRORES SON DISTINTOS Y LOS DOS IMPORTAN
 * ─────────────────────────────────────────────────────────────────────────────
 *   · El menú OFRECE lo que el middleware rebota → botón roto. Se ve enseguida
 *     y hace perder la confianza.
 *   · El menú OCULTA lo que el middleware permite → permiso abierto que nadie
 *     revisó. No se ve nunca, y es el peligroso: esconder el botón no cierra el
 *     permiso, solo lo saca de la vista.
 *
 * Ejecución:
 *   npx tsx --test src/lib/auth/__tests__/nav-guard.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { TABS } from "@/lib/nav-config";
import { puedeAccederA, type Role } from "@/lib/auth/route-access";

const ROLES: Role[] = ["admin", "abogada", "asistente", "contador"];

interface EntradaDeMenu {
  label: string;
  href: string;
  roles: readonly string[];
  tab: string;
}

/** Todas las entradas del menú, aplanadas, con el tab del que cuelgan. */
function entradasDeMenu(): EntradaDeMenu[] {
  const salida: EntradaDeMenu[] = [];
  for (const tab of TABS) {
    for (const item of tab.items) {
      salida.push({ label: item.label, href: item.href, roles: item.roles, tab: tab.label });
    }
  }
  return salida;
}

/** ¿El menú le muestra esta entrada a este rol? */
function elMenuLaMuestra(entrada: EntradaDeMenu, role: Role): boolean {
  return (entrada.roles as readonly string[]).includes(role);
}

test("ninguna entrada del menú lleva a una ruta que el middleware rebota", () => {
  const rotos: string[] = [];

  for (const entrada of entradasDeMenu()) {
    for (const role of ROLES) {
      if (!elMenuLaMuestra(entrada, role)) continue;
      if (puedeAccederA(role, entrada.href)) continue;
      rotos.push(
        `   · [${role}] "${entrada.label}" (${entrada.tab}) → ${entrada.href}` +
          `  — el menú lo ofrece y el middleware lo rebota`
      );
    }
  }

  assert.deepEqual(
    rotos,
    [],
    `\nHay ${rotos.length} entrada(s) de menú que no llevan a ninguna parte:\n${rotos.join("\n")}\n\n` +
      `   CÓMO SE ARREGLA\n` +
      `     O el rol debe entrar —y entonces se amplía el permiso en\n` +
      `     src/lib/auth/route-access.ts— o no debe, y entonces se saca el rol\n` +
      `     de esa entrada en src/lib/nav-config.ts. Lo que no puede quedar es\n` +
      `     el botón que rebota.\n`
  );
});

test("ninguna pantalla del menú queda accesible sin aparecer en el menú de ese rol", () => {
  // El caso inverso: el permiso está abierto pero el ítem está oculto. No se ve
  // en pantalla y por eso es el que sobrevive años.
  const ocultos: string[] = [];

  for (const entrada of entradasDeMenu()) {
    for (const role of ROLES) {
      if (elMenuLaMuestra(entrada, role)) continue;
      if (!puedeAccederA(role, entrada.href)) continue;
      ocultos.push(
        `   · [${role}] "${entrada.label}" (${entrada.tab}) → ${entrada.href}` +
          `  — accesible, pero oculto en el menú`
      );
    }
  }

  assert.deepEqual(
    ocultos,
    [],
    `\nHay ${ocultos.length} pantalla(s) accesibles que el menú no muestra:\n${ocultos.join("\n")}\n\n` +
      `   POR QUÉ IMPORTA\n` +
      `     Esconder el ítem NO cierra el permiso: escribir la URL a mano entra\n` +
      `     igual. O el rol debe verlo —y se agrega a nav-config.ts— o no debe, y\n` +
      `     entonces hay que cerrarlo de verdad en route-access.ts.\n`
  );
});

test("un tab visible para un rol tiene al menos una entrada que ese rol puede abrir", () => {
  // Un tab sin destinos útiles es una pestaña que se abre en un menú vacío.
  const vacios: string[] = [];

  for (const tab of TABS) {
    for (const role of ROLES) {
      if (!(tab.roles as readonly string[]).includes(role)) continue;
      const alcanzables = tab.items.filter(
        (i) => (i.roles as readonly string[]).includes(role) && puedeAccederA(role, i.href)
      );
      if (alcanzables.length === 0) {
        vacios.push(`   · [${role}] el tab "${tab.label}" no tiene ninguna entrada abrible`);
      }
    }
  }

  assert.deepEqual(vacios, [], `\n${vacios.join("\n")}\n`);
});

// ---------------------------------------------------------------------------
// Casos concretos, para que el archivo también documente el alcance de cada rol
// ---------------------------------------------------------------------------

test("el contador entra a lo suyo: reportes, gastos del bufete y configuración", () => {
  for (const ruta of [
    "/finanzas",
    "/finanzas/reportes",
    "/finanzas/reportes/mayor",
    "/finanzas/reportes/balance",
    "/finanzas/gastos-bufete",
    "/finanzas/configuracion/cuentas",
    "/finanzas/configuracion/impuestos",
  ]) {
    assert.equal(puedeAccederA("contador", ruta), true, `el contador debería entrar a ${ruta}`);
  }
});

test("el contador NO entra a facturación, cotizaciones ni al módulo legal", () => {
  for (const ruta of [
    "/finanzas/facturas",
    "/finanzas/cotizaciones",
    "/finanzas/admin",
    "/legal",
    "/legal/casos",
    "/legal/clientes",
    "/legal/admin",
  ]) {
    assert.equal(puedeAccederA("contador", ruta), false, `el contador NO debería entrar a ${ruta}`);
  }
});

test("el asistente sigue con su alcance reducido del 24/08/2026", () => {
  assert.equal(puedeAccederA("asistente", "/legal/casos"), true);
  assert.equal(puedeAccederA("asistente", "/legal/pendientes"), true);
  assert.equal(puedeAccederA("asistente", "/legal/clientes/abc-123"), true, "la ficha puntual sí");
  assert.equal(puedeAccederA("asistente", "/legal/clientes"), false, "el directorio no");
  assert.equal(puedeAccederA("asistente", "/legal/gastos"), false);
  assert.equal(puedeAccederA("asistente", "/finanzas/reportes"), false);
});

test("solo el admin entra a los subárboles /admin", () => {
  for (const role of ROLES) {
    const esperado = role === "admin";
    assert.equal(puedeAccederA(role, "/legal/admin"), esperado);
    assert.equal(puedeAccederA(role, "/legal/admin/usuarios"), esperado);
    assert.equal(puedeAccederA(role, "/finanzas/admin"), esperado);
  }
});

test("un prefijo no cubre a otro que solo comparte el comienzo del texto", () => {
  // "/finanzas/reportes" no puede habilitar "/finanzas/reportes-secretos".
  assert.equal(puedeAccederA("contador", "/finanzas/reportes-internos"), false);
  assert.equal(puedeAccederA("asistente", "/legalotro"), false);
});

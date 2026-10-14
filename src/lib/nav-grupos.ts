/**
 * GRUPOS DEL MENÚ QUE SE ABREN Y SE CIERRAN (pedido de Josuarth, 14/10/2026).
 *
 * Lógica PURA, sin React ni localStorage: la usan el sidebar y el menú del
 * celular (por `useGruposAbiertos`) y los tests.
 *   · Por defecto, todos cerrados menos el grupo de la página actual.
 *   · Lo que la persona dejó abierto se recuerda (localStorage, por módulo y
 *     rol); si no hay nada guardado o no se puede leer, el comportamiento por
 *     defecto.
 *   · El grupo de la página actual se abre siempre, aunque lo hubiera cerrado.
 */

import type { NavItem } from "@/lib/nav-config";

export const PREFIJO_CLAVE_GRUPOS = "nav-grupos-abiertos";

export function claveDeGrupos(tab: string | null, rol: string): string {
  return `${PREFIJO_CLAVE_GRUPOS}:${tab ?? "-"}:${rol}`;
}

/** El grupo del ítem activo, o null. */
export function grupoActivo(grupos: { group: string | null; items: NavItem[] }[], activeHref: string | null): string | null {
  if (!activeHref) return null;
  return grupos.find((g) => g.items.some((i) => i.href === activeHref))?.group ?? null;
}

/** Lo guardado, si es una lista de textos; si no, null (y se usa el defecto). */
export function leerGuardados(crudo: string | null): string[] | null {
  if (!crudo) return null;
  try {
    const v = JSON.parse(crudo);
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}

/** Los grupos abiertos: lo guardado (sólo grupos que existen) más el de la página actual. */
export function gruposAbiertos(guardados: string[] | null, activo: string | null, existentes: string[]): Set<string> {
  const abiertos = new Set((guardados ?? []).filter((g) => existentes.includes(g)));
  if (activo) abiertos.add(activo);
  return abiertos;
}

/** Abrir o cerrar uno. Devuelve un conjunto nuevo. */
export function alternarGrupo(abiertos: Set<string>, grupo: string): Set<string> {
  const nuevo = new Set(abiertos);
  if (nuevo.has(grupo)) nuevo.delete(grupo);
  else nuevo.add(grupo);
  return nuevo;
}

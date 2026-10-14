/**
 * GRUPOS DEL MENÚ QUE SE ABREN Y SE CIERRAN (pedido de Josuarth, 14/10/2026).
 *
 * Lógica PURA, sin React ni localStorage: la usan el sidebar y el menú del
 * celular (por `useGruposAbiertos`) y los tests.
 *   · Todos arrancan CERRADOS, también el de la página actual (Oliver,
 *     14/10/2026, después del smoke test).
 *   · Sólo quedan abiertos los que la persona abrió a mano (localStorage, por
 *     módulo y rol); si no hay nada guardado o no se puede leer, todos cerrados.
 *   · Para no perder la orientación, el TÍTULO del grupo de la página actual
 *     queda resaltado aunque esté cerrado (`grupoActivo`).
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

/**
 * Los grupos abiertos: SÓLO lo guardado (y sólo grupos que este rol tiene). El
 * de la página actual no se abre solo: se resalta su título (`grupoActivo`).
 */
export function gruposAbiertos(guardados: string[] | null, existentes: string[]): Set<string> {
  return new Set((guardados ?? []).filter((g) => existentes.includes(g)));
}

/** Abrir o cerrar uno. Devuelve un conjunto nuevo. */
export function alternarGrupo(abiertos: Set<string>, grupo: string): Set<string> {
  const nuevo = new Set(abiertos);
  if (nuevo.has(grupo)) nuevo.delete(grupo);
  else nuevo.add(grupo);
  return nuevo;
}

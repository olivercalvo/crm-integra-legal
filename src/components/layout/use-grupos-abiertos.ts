"use client";

import { useCallback, useEffect, useState } from "react";
import type { NavItem } from "@/lib/nav-config";
import { alternarGrupo, claveDeGrupos, grupoActivo, gruposAbiertos, leerGuardados } from "@/lib/nav-grupos";

/**
 * Qué grupos del menú están abiertos (14/10/2026). El sidebar y el menú del
 * celular usan este MISMO hook: la regla está en `lib/nav-grupos.ts`.
 * localStorage siempre con try/catch: sin él, el comportamiento por defecto.
 */
export function useGruposAbiertos(
  tab: string | null,
  rol: string,
  grupos: { group: string | null; items: NavItem[] }[],
  activeHref: string | null
) {
  const clave = claveDeGrupos(tab, rol);
  const activo = grupoActivo(grupos, activeHref);
  const existentes = grupos.map((g) => g.group).filter((g): g is string => !!g);
  const firma = existentes.join("|");
  // Antes de leer el almacenamiento (y en el servidor): todos cerrados.
  const [abiertos, setAbiertos] = useState<Set<string>>(() => gruposAbiertos(null, existentes));

  useEffect(() => {
    let guardados: string[] | null = null;
    try {
      guardados = leerGuardados(localStorage.getItem(clave));
    } catch {
      guardados = null;
    }
    setAbiertos(gruposAbiertos(guardados, firma ? firma.split("|") : []));
    // `firma` resume `existentes`.
  }, [clave, firma]);

  const alternar = useCallback(
    (grupo: string) => {
      setAbiertos((prev) => {
        const nuevo = alternarGrupo(prev, grupo);
        try {
          localStorage.setItem(clave, JSON.stringify(Array.from(nuevo)));
        } catch {
          // Sin almacenamiento: queda abierto o cerrado hasta recargar.
        }
        return nuevo;
      });
    },
    [clave]
  );

  // El grupo de la página actual: su título se resalta aunque esté cerrado.
  return { abiertos, alternar, activo };
}

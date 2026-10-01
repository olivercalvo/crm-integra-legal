"use client";

import { Check } from "lucide-react";
import { MODULOS, type Modulo } from "@/lib/finanzas/contabilidad/modulo-del-asiento";

/**
 * E9: el filtro "Módulo" del Mayor y del Diario (multi-selección). Ninguno
 * marcado = todos. Viaja en la URL como `?modulo=CO,AD`, igual que el resto de
 * los filtros, para que un mayor filtrado sea un enlace que se comparte.
 *
 * Las NC de venta y de compra se ofrecen aunque todavía no haya asientos: el
 * filtro sale de `MODULOS`, la misma lista que deriva la columna.
 */
export function FiltroModulos({
  elegidos,
  onChange,
}: {
  elegidos: Modulo[];
  onChange: (nuevos: Modulo[]) => void;
}) {
  function alternar(codigo: Modulo) {
    const set = new Set(elegidos);
    if (set.has(codigo)) set.delete(codigo);
    else set.add(codigo);
    onChange(MODULOS.map((m) => m.codigo).filter((c) => set.has(c)));
  }

  return (
    <fieldset>
      <legend className="mb-1 block text-xs font-medium">
        Módulo <span className="font-normal text-gray-500">(ninguno marcado: todos)</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {MODULOS.map((m) => {
          const activo = elegidos.includes(m.codigo);
          return (
            <button
              key={m.codigo}
              type="button"
              aria-pressed={activo}
              title={m.nombre}
              onClick={() => alternar(m.codigo)}
              className={`inline-flex min-h-[44px] items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors ${
                activo
                  ? "border-integra-navy bg-integra-navy text-white"
                  : "border-gray-300 bg-white text-integra-navy hover:border-integra-navy"
              }`}
            >
              {activo && <Check size={14} />}
              {m.codigo}
              <span className="hidden font-normal sm:inline">· {m.nombre}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

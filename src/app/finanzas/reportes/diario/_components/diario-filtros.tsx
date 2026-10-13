"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Modulo } from "@/lib/finanzas/contabilidad/modulo-del-asiento";
import { FiltroModulos } from "../../_components/filtro-modulos";

/**
 * Rango de fechas y módulo (E9) del Diario General.
 *
 * Mismo criterio que el Libro Mayor: los filtros viajan en la URL, no en estado
 * local, para que un diario acotado sea un enlace que se pueda compartir.
 */
export function DiarioFiltros({
  desde,
  hasta,
  modulos,
}: {
  desde: string;
  hasta: string;
  modulos: Modulo[];
}) {
  const router = useRouter();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  const [mods, setMods] = useState<Modulo[]>(modulos);

  function aplicar(nuevoDesde = d, nuevoHasta = h, nuevosMods = mods) {
    const p = new URLSearchParams();
    if (nuevoDesde) p.set("desde", nuevoDesde);
    if (nuevoHasta) p.set("hasta", nuevoHasta);
    if (nuevosMods.length > 0) p.set("modulo", nuevosMods.join(","));
    const qs = p.toString();
    router.push(`/finanzas/reportes/diario${qs ? `?${qs}` : ""}`);
  }

  function limpiar() {
    setD("");
    setH("");
    setMods([]);
    aplicar("", "", []);
  }

  const hayFiltro = Boolean(desde || hasta || modulos.length > 0);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div>
          <Label htmlFor="desde" className="mb-1 block text-xs">
            Desde
          </Label>
          <Input
            id="desde"
            type="date"
            value={d}
            onChange={(e) => setD(e.target.value)}
            className="min-h-[44px]"
          />
        </div>
        <div>
          <Label htmlFor="hasta" className="mb-1 block text-xs">
            Hasta
          </Label>
          <Input
            id="hasta"
            type="date"
            value={h}
            onChange={(e) => setH(e.target.value)}
            className="min-h-[44px]"
          />
        </div>
        <Button type="button" onClick={() => aplicar()} className="min-h-[44px]">
          <span className="flex items-center gap-1.5">
            <Search size={16} />
            Aplicar
          </span>
        </Button>
        {hayFiltro && (
          <Button type="button" variant="outline" onClick={limpiar} className="min-h-[44px]">
            <span className="flex items-center gap-1.5">
              <X size={16} />
              Limpiar
            </span>
          </Button>
        )}
      </div>
      <div className="mt-4">
        <FiltroModulos
          elegidos={mods}
          onChange={(nuevos) => {
            setMods(nuevos);
            aplicar(d, h, nuevos);
          }}
        />
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Rango de fechas del Diario General.
 *
 * Mismo criterio que el Libro Mayor: los filtros viajan en la URL, no en estado
 * local, para que un diario acotado sea un enlace que se pueda compartir.
 */
export function DiarioFiltros({ desde, hasta }: { desde: string; hasta: string }) {
  const router = useRouter();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);

  function aplicar(nuevoDesde = d, nuevoHasta = h) {
    const p = new URLSearchParams();
    if (nuevoDesde) p.set("desde", nuevoDesde);
    if (nuevoHasta) p.set("hasta", nuevoHasta);
    const qs = p.toString();
    router.push(`/finanzas/reportes/diario${qs ? `?${qs}` : ""}`);
  }

  function limpiar() {
    setD("");
    setH("");
    aplicar("", "");
  }

  const hayFiltro = Boolean(desde || hasta);

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
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Corte de fechas de los estados financieros.
 *
 * Dos formas, porque son dos cosas distintas y confundirlas es un error
 * contable, no de interfaz:
 *
 *   modo="fecha"  UN campo. El Balance General es un reporte A UNA FECHA: la
 *                 foto del patrimonio en ese instante. Un rango no significa
 *                 nada ahí — no existe "el activo entre marzo y junio".
 *   modo="rango"  DOS campos. El Estado de Resultado y el Balance de
 *                 Comprobación son reportes DE UN PERÍODO.
 *
 * Los filtros viajan en la URL y no en estado local, igual que en el Libro
 * Mayor y el Diario: un estado acotado tiene que ser un enlace que se pueda
 * mandar por correo al contador.
 */
export function PeriodoFiltros({
  basePath,
  modo,
  desde = "",
  hasta = "",
}: {
  /** Ruta de la pantalla, sin query string. */
  basePath: string;
  modo: "fecha" | "rango";
  desde?: string;
  hasta?: string;
}) {
  const router = useRouter();
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);

  function aplicar(nuevoDesde = d, nuevoHasta = h) {
    const p = new URLSearchParams();
    if (modo === "rango" && nuevoDesde) p.set("desde", nuevoDesde);
    if (nuevoHasta) p.set("hasta", nuevoHasta);
    const qs = p.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  }

  function limpiar() {
    setD("");
    setH("");
    aplicar("", "");
  }

  const hayFiltro = Boolean(desde || hasta);
  const columnas =
    modo === "rango"
      ? "sm:grid-cols-[1fr_1fr_auto_auto]"
      : "sm:grid-cols-[1fr_auto_auto]";

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className={`grid grid-cols-1 gap-3 ${columnas} sm:items-end`}>
        {modo === "rango" && (
          <div>
            <Label htmlFor="periodo-desde" className="mb-1 block text-xs">
              Desde
            </Label>
            <Input
              id="periodo-desde"
              type="date"
              value={d}
              onChange={(e) => setD(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
        )}
        <div>
          <Label htmlFor="periodo-hasta" className="mb-1 block text-xs">
            {modo === "fecha" ? "Al" : "Hasta"}
          </Label>
          <Input
            id="periodo-hasta"
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

      <p className="mt-2 text-xs text-gray-500">
        {modo === "fecha"
          ? "Sin fecha, el estado muestra todo lo registrado hasta hoy."
          : "Sin fechas, el reporte muestra todo lo registrado."}
      </p>
    </div>
  );
}

/**
 * Formato largo de una fecha ISO para los encabezados de los estados
 * ("30 de junio de 2026"). En UTC a propósito: `YYYY-MM-DD` no tiene hora, y
 * dejarlo a la zona local corre el día uno para atrás al oeste de Greenwich.
 */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

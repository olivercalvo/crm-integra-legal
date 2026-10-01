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
 * Filtros del Libro Mayor: cuenta + rango de fechas + módulo (E9).
 *
 * Los filtros viajan en la URL y no en estado local, a propósito: así el mayor
 * de una cuenta es un enlace que se puede compartir, y es lo que hace posible
 * la trazabilidad de nivel 1 —desde un saldo del Balance o del Estado de
 * Resultado se llega acá con `?cuenta=CODE`.
 */

interface CuentaOpcion {
  code: string;
  name: string;
  conMovimiento: boolean;
}

const selectClass =
  "block w-full rounded-md border px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none border-gray-300";

export function MayorFiltros({
  cuentas,
  cuentaSeleccionada,
  desde,
  hasta,
  modulos,
}: {
  cuentas: CuentaOpcion[];
  cuentaSeleccionada: string;
  desde: string;
  hasta: string;
  modulos: Modulo[];
}) {
  const router = useRouter();
  const [code, setCode] = useState(cuentaSeleccionada);
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  const [mods, setMods] = useState<Modulo[]>(modulos);

  function aplicar(nuevoCode = code, nuevoDesde = d, nuevoHasta = h, nuevosMods = mods) {
    const p = new URLSearchParams();
    if (nuevoCode) p.set("cuenta", nuevoCode);
    if (nuevoDesde) p.set("desde", nuevoDesde);
    if (nuevoHasta) p.set("hasta", nuevoHasta);
    if (nuevosMods.length > 0) p.set("modulo", nuevosMods.join(","));
    router.push(`/finanzas/reportes/mayor?${p.toString()}`);
  }

  function limpiarFechas() {
    setD("");
    setH("");
    aplicar(code, "", "");
  }

  // Las cuentas CON movimiento van primero: son las únicas que hoy tienen algo
  // que mostrar además del saldo inicial.
  const conMov = cuentas.filter((c) => c.conMovimiento);
  const sinMov = cuentas.filter((c) => !c.conMovimiento);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label className="mb-1 block text-xs">Cuenta</Label>
          <select
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              aplicar(e.target.value);
            }}
            className={selectClass}
          >
            <option value="">Seleccione una cuenta</option>
            {conMov.length > 0 && (
              <optgroup label="Con movimientos">
                {conMov.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {sinMov.length > 0 && (
              <optgroup label="Sin movimientos">
                {sinMov.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div>
          <Label className="mb-1 block text-xs">Desde</Label>
          <Input type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </div>

        <div>
          <Label className="mb-1 block text-xs">Hasta</Label>
          <Input type="date" value={h} onChange={(e) => setH(e.target.value)} />
        </div>
      </div>

      <div className="mt-4">
        <FiltroModulos
          elegidos={mods}
          onChange={(nuevos) => {
            setMods(nuevos);
            if (code) aplicar(code, d, h, nuevos);
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => aplicar()} disabled={!code} className="gap-2">
          <Search size={16} />
          Aplicar filtro
        </Button>
        {(desde || hasta) && (
          <Button variant="outline" onClick={limpiarFechas} className="gap-2">
            <X size={16} />
            Quitar fechas
          </Button>
        )}
        {modulos.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              setMods([]);
              aplicar(code, d, h, []);
            }}
            className="gap-2"
          >
            <X size={16} />
            Quitar módulos
          </Button>
        )}
      </div>
    </div>
  );
}

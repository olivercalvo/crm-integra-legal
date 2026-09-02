"use client";

import { useState } from "react";

import type { FilaMayor } from "@/lib/finanzas/reports/libro-mayor";
import { FilaExpandible } from "./fila-expandible";

/**
 * El `<tbody>` del Libro Mayor, con el estado de qué fila está abierta.
 *
 * Es lo ÚNICO que se vuelve cliente: `LibroMayorTable` sigue siendo server
 * component, igual que el patrón de `antiguedad-table.tsx`. Meter el estado en
 * la tabla entera arrastraría al cliente el encabezado, el pie y los avisos, que
 * no lo necesitan.
 *
 * `destinos` llega como objeto plano y no como `Map`: cruza el límite
 * servidor→cliente y un objeto se serializa sin sorpresas.
 */

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CuerpoMayor({
  filas,
  destinos,
  rotuloArranque,
}: {
  filas: FilaMayor[];
  /** source_id → ruta del documento. Lo que no está acá no se enlaza. */
  destinos: Record<string, string>;
  /** "Saldo inicial", o "Saldo al DD/MM/AAAA" si el filtro lo ajustó. */
  rotuloArranque: string;
}) {
  // Una sola abierta a la vez: el índice de la fila, o null.
  const [abierta, setAbierta] = useState<number | null>(null);

  return (
    <tbody>
      {filas.map((f, i) => {
        if (f.kind === "saldo-inicial") {
          // No pertenece a ningún asiento, así que no se expande.
          return (
            <tr key={`inicial-${i}`} className="border-b border-gray-200 bg-integra-navy/5">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
                {f.cuentaDistribucion}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-gray-500">{f.fecha ?? "—"}</td>
              <td className="px-3 py-2 text-sm" colSpan={5}>
                <span className="font-semibold text-integra-navy">{rotuloArranque}</span>
              </td>
              <td className="px-3 py-2 text-right text-gray-400">—</td>
              <td className="px-3 py-2 text-right">
                <span className="font-mono text-sm font-bold tabular-nums text-gray-800">
                  {money(f.saldo)}
                </span>
              </td>
            </tr>
          );
        }

        return (
          <FilaExpandible
            key={`mov-${i}`}
            fila={f}
            destino={(f.sourceId && destinos[f.sourceId]) || null}
            abierta={abierta === i}
            onToggle={() => setAbierta(abierta === i ? null : i)}
          />
        );
      })}
    </tbody>
  );
}

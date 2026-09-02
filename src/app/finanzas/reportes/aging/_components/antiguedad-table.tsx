"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";

import {
  TRAMOS,
  TRAMO_LABEL,
  tramoDe,
  type Antiguedad,
  type FilaTercero,
} from "@/lib/finanzas/reports/antiguedad";

/**
 * Tabla de antigüedad, DETALLADA POR DOCUMENTO.
 *
 * Cada tercero abre y muestra qué documentos componen su saldo y en qué tramo
 * cae cada uno. Es lo que pidió Josuarth en la reunión: dijo que las versiones
 * que solo dan el resumen por cliente no le sirven.
 *
 * Arranca con todo cerrado —el resumen es lo primero que se lee— pero con el
 * detalle a un clic. Los documentos enlazan a su pantalla con las mismas rutas
 * que el Libro Mayor y el Diario.
 */

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Monto({ value, bold }: { value: number; bold?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="text-gray-300">—</span>;
  return (
    <span className={"font-mono text-sm tabular-nums text-gray-800" + (bold ? " font-bold" : "")}>
      {money(value)}
    </span>
  );
}

function Tercero({
  fila,
  destinos,
}: {
  fila: FilaTercero;
  destinos: Map<string, string>;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
        onClick={() => setAbierto((v) => !v)}
      >
        <td className="px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-integra-navy">
            {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            {fila.tercero}
            <span className="text-xs font-normal text-gray-400">
              ({fila.documentos.length} doc{fila.documentos.length === 1 ? "" : "s"})
            </span>
          </span>
        </td>
        {TRAMOS.map((t) => (
          <td key={t} className="px-3 py-2 text-right">
            <Monto value={fila.porTramo[t]} />
          </td>
        ))}
        <td className="px-3 py-2 text-right">
          <Monto value={fila.total} bold />
        </td>
      </tr>

      {abierto &&
        fila.documentos.map((doc) => {
          const destino = destinos.get(doc.id) ?? null;
          const tramo = tramoDe(doc.diasVencido);
          return (
            <tr key={doc.id} className="border-b border-gray-50 bg-gray-50/40 text-xs">
              <td className="py-1.5 pl-9 pr-3">
                <span className="flex flex-wrap items-center gap-2">
                  {destino ? (
                    <Link
                      href={destino}
                      className="inline-flex items-center gap-1 font-medium text-integra-navy underline decoration-dotted underline-offset-2 hover:text-integra-gold"
                      title="Abrir el documento"
                    >
                      <FileText size={11} />
                      {doc.numero}
                    </Link>
                  ) : (
                    <span className="font-medium text-gray-700">{doc.numero}</span>
                  )}
                  <span className="font-mono text-gray-500">{doc.fechaReferencia}</span>
                  <span className="text-gray-500">
                    {doc.diasVencido > 0
                      ? `${doc.diasVencido} día${doc.diasVencido === 1 ? "" : "s"}`
                      : "no vencido"}
                  </span>
                </span>
              </td>
              {TRAMOS.map((t) => (
                <td key={t} className="px-3 py-1.5 text-right">
                  {t === tramo ? (
                    <span className="font-mono tabular-nums text-gray-600">{money(doc.saldo)}</span>
                  ) : (
                    <span className="text-gray-200">·</span>
                  )}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-600">
                {money(doc.saldo)}
              </td>
            </tr>
          );
        })}
    </>
  );
}

export function AntiguedadTable({
  reporte,
  destinos,
}: {
  reporte: Antiguedad;
  /** id del documento → ruta. Lo que no está acá no se enlaza. */
  destinos: Map<string, string>;
}) {
  if (reporte.filas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
        <p className="text-base font-medium text-integra-navy">No hay saldos pendientes</p>
        <p className="mt-1 text-sm text-gray-500">
          Ningún documento del sistema quedó sin cobrar o sin pagar.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[900px]">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2 font-semibold">Tercero</th>
            {TRAMOS.map((t) => (
              <th key={t} className="px-3 py-2 text-right font-semibold">
                {TRAMO_LABEL[t]}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {reporte.filas.map((f) => (
            <Tercero key={f.terceroId ?? f.tercero} fila={f} destinos={destinos} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-integra-navy/20 bg-gray-50/60">
            <td className="px-3 py-2.5 text-sm font-bold text-integra-navy">
              Totales ({reporte.filas.length})
            </td>
            {TRAMOS.map((t) => (
              <td key={t} className="px-3 py-2.5 text-right">
                <Monto value={reporte.totalesPorTramo[t]} bold />
              </td>
            ))}
            <td className="px-3 py-2.5 text-right">
              <Monto value={reporte.total} bold />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

import Link from "next/link";
import { AlertTriangle, FileText } from "lucide-react";

import type { AsientoDiario, DiarioGeneral } from "@/lib/finanzas/reports/diario-general";

/**
 * Tabla del Diario General.
 *
 * Server component: no hay nada que alternar acá. El filtro de cuentas en cero
 * no aplica —un asiento sin importe no existe, el RPC lo rechaza— y el rango de
 * fechas ya viaja por la URL.
 *
 * El enlace al documento usa el mismo ícono y el mismo texto que el Libro Mayor,
 * y las rutas salen de `destino-documento.ts`, no de este archivo.
 */

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Importe({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-gray-300">—</span>;
  return <span className="font-mono text-sm tabular-nums text-gray-700">{money(value)}</span>;
}

function Asiento({ asiento, destino }: { asiento: AsientoDiario; destino: string | null }) {
  return (
    <div className="rounded-xl border bg-white">
      {/* Cabecera del asiento */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-integra-navy/5 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-integra-navy">
              N.º {asiento.numero}
            </span>
            <span className="font-mono text-xs text-gray-600">{asiento.fecha}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-integra-navy ring-1 ring-integra-navy/15">
              {asiento.tipoTransaccion}
            </span>
            {asiento.documento && (
              <span className="text-xs text-gray-600">
                {destino ? (
                  <Link
                    href={destino}
                    className="inline-flex items-center gap-1 text-integra-navy underline decoration-dotted underline-offset-2 hover:text-integra-gold"
                    title="Abrir el documento que originó este asiento"
                  >
                    <FileText size={12} />
                    {asiento.documento}
                  </Link>
                ) : (
                  asiento.documento
                )}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-700">{asiento.descripcion}</p>
        </div>
        {!asiento.cuadra && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-800 ring-1 ring-red-200">
            <AlertTriangle size={13} />
            No cuadra
          </span>
        )}
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-gray-400">
            <th className="px-4 py-1.5 font-semibold">Cuenta</th>
            <th className="px-4 py-1.5 font-semibold">Descripción</th>
            <th className="px-4 py-1.5 text-right font-semibold">Débito</th>
            <th className="px-4 py-1.5 text-right font-semibold">Crédito</th>
          </tr>
        </thead>
        <tbody>
          {asiento.lineas.map((l, i) => (
            <tr key={`${l.code}-${i}`} className="border-b border-gray-50 last:border-0">
              <td className="whitespace-nowrap px-4 py-1.5">
                <span className="font-mono text-xs text-gray-500">{l.code}</span>
                <span className="ml-2 text-sm text-gray-700">{l.name}</span>
              </td>
              <td className="px-4 py-1.5 text-sm text-gray-600">{l.descripcion}</td>
              <td className="px-4 py-1.5 text-right"><Importe value={l.debit} /></td>
              <td className="px-4 py-1.5 text-right"><Importe value={l.credit} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-gray-50/60">
            <td colSpan={2} className="px-4 py-1.5 text-right text-xs font-medium text-gray-500">
              Total del asiento
            </td>
            <td className="px-4 py-1.5 text-right">
              <span className="font-mono text-sm font-bold tabular-nums text-gray-800">
                {money(asiento.totalDebito)}
              </span>
            </td>
            <td className="px-4 py-1.5 text-right">
              <span className="font-mono text-sm font-bold tabular-nums text-gray-800">
                {money(asiento.totalCredito)}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function DiarioTable({
  diario,
  destinos,
}: {
  diario: DiarioGeneral;
  /** source_id → ruta del documento. Lo que no está acá no se enlaza. */
  destinos: Map<string, string>;
}) {
  if (diario.asientos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
        <p className="text-base font-medium text-integra-navy">No hay asientos en este período</p>
        <p className="mt-1 text-sm text-gray-500">
          Pruebe ampliando el rango de fechas, o quite el filtro para ver todo el diario.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-4 py-2.5">
        <p className="text-sm text-gray-600">
          <strong className="text-integra-navy">{diario.asientos.length}</strong> asiento
          {diario.asientos.length === 1 ? "" : "s"} ·{" "}
          <strong className="text-integra-navy">{diario.cantidadLineas}</strong> línea
          {diario.cantidadLineas === 1 ? "" : "s"}
        </p>
        <p className="font-mono text-sm text-gray-700">
          Débitos <strong>{money(diario.totalDebito)}</strong> · Créditos{" "}
          <strong>{money(diario.totalCredito)}</strong>
        </p>
      </div>

      {diario.descuadrados.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Hay <strong>{diario.descuadrados.length} asiento(s) descuadrado(s)</strong> (N.º{" "}
            {diario.descuadrados.join(", ")}). Un asiento no puede quedar así: el motor de posteo
            los rechaza y los triggers impiden editarlos después. Si aparece uno, algo escribió en
            el libro sin pasar por el motor.
          </span>
        </p>
      )}

      {diario.asientos.map((a) => (
        <Asiento
          key={a.entryId}
          asiento={a}
          destino={a.sourceId ? (destinos.get(a.sourceId) ?? null) : null}
        />
      ))}
    </div>
  );
}

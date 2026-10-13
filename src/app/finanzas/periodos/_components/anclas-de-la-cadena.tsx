"use client";

import { useState, useTransition } from "react";
import { Anchor, Download, Loader2, ShieldCheck, ShieldAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/format-date";
import { huellaCorta, type AnclaGuardada } from "@/lib/finanzas/contabilidad/anclas";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
  "Septiembre", "Octubre", "Noviembre", "Diciembre"];

interface Resultado {
  comparadas: number | null;
  ignoradas: number;
  problemas: { nro_asiento: number; problema: string }[];
  coincide: boolean;
}

/**
 * Las ANCLAS de la cadena (075, R-1b): cada cierre de período deja el último
 * asiento y su huella. Desde acá se baja la constancia PDF (lo que el contador
 * guarda afuera) y se verifica la cadena contra el archivo de un respaldo.
 */
export function AnclasDeLaCadena({ anclas }: { anclas: AnclaGuardada[] }) {
  const [isPending, startTransition] = useTransition();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  function verificar(archivo: string | null) {
    setError(null);
    setResultado(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/periodos/anclas/verificar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archivo }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo verificar.");
          return;
        }
        setResultado(data as Resultado);
      } catch {
        setError("Error de red. Intente de nuevo.");
      }
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-2">
        <Anchor size={18} className="mt-0.5 text-integra-gold" />
        <div>
          <h2 className="text-base font-semibold text-integra-navy">Anclas de la cadena</h2>
          <p className="text-xs text-gray-500">
            Cada cierre guarda el último asiento del libro y su huella. La constancia se guarda
            fuera del sistema y el respaldo diario se lleva una copia: si alguien reescribiera el
            libro, la huella dejaría de coincidir.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Período</th>
              <th className="py-2 pr-3">Último asiento</th>
              <th className="py-2 pr-3">Huella</th>
              <th className="py-2 pr-3">Anclado el</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {anclas.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  {a.origen === "cierre" && a.year && a.month ? `${MESES[a.month - 1]} ${a.year}` : "Ancla inicial"}
                </td>
                <td className="py-2 pr-3 font-mono">N.º {a.entry_number}</td>
                <td className="py-2 pr-3 font-mono text-xs" title={a.hash}>
                  {huellaCorta(a.hash)}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-600">{formatDateTime(a.anchored_at)}</td>
                <td className="py-2 text-right">
                  <a
                    href={`/api/finanzas/periodos/anclas/${a.id}/pdf`}
                    className="inline-flex min-h-[40px] items-center gap-1 rounded-md border border-gray-200 px-3 text-xs font-medium text-integra-navy hover:border-integra-navy"
                  >
                    <Download size={14} /> Constancia
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={isPending} onClick={() => verificar(null)} className="min-h-[44px] gap-1.5">
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
          Verificar contra estas anclas
        </Button>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md bg-integra-navy px-4 text-sm font-semibold text-white hover:bg-integra-navy/90">
          <Upload size={16} />
          Verificar contra un respaldo
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Archivo de anclas del respaldo"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) verificar(await f.text());
            }}
          />
        </label>
        <span className="text-xs text-gray-500">
          El archivo es <span className="font-mono">tablas/accounting_chain_anchors.json</span> de cualquier respaldo.
        </span>
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {resultado && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            resultado.coincide ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {resultado.coincide ? (
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldCheck size={16} />
              La cadena coincide con {resultado.comparadas === null ? "las anclas guardadas" : `las ${resultado.comparadas} anclas del archivo`}.
            </p>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-medium">
                <ShieldAlert size={16} /> La cadena NO coincide con las anclas.
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {resultado.problemas.map((p, i) => (
                  <li key={i}>
                    Asiento N.º {p.nro_asiento}: {p.problema}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

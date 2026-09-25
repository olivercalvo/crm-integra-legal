"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Download, Upload } from "lucide-react";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDate } from "@/lib/utils/format-date";
import type { AsientoImportado, ErrorDeFila } from "@/lib/finanzas/import/asientos-import";

interface VistaPrevia {
  hash: string;
  yaImportado: string | null;
  resultado: { errores: ErrorDeFila[]; asientos: AsientoImportado[]; filasLeidas: number; totalDebitos: number };
}

/**
 * Subir → vista previa (OBLIGATORIA) → contabilizar. El botón de contabilizar
 * sólo se habilita sin errores, y cuando está apagado dice por qué (SOP-027).
 */
export function ImportarAsientos() {
  const router = useRouter();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function previsualizar(f: File) {
    setArchivo(f);
    setVista(null);
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", "preview");
      const res = await fetch("/api/finanzas/asientos/importar", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo leer el archivo.");
        return;
      }
      setVista(data as VistaPrevia);
    });
  }

  function contabilizar() {
    if (!archivo || !vista) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", archivo);
      fd.append("mode", "commit");
      fd.append("hash", vista.hash);
      const res = await fetch("/api/finanzas/asientos/importar", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se registró nada.");
        return;
      }
      router.push(`/finanzas/asientos/importaciones/${data.import_id}?registrada=1`);
    });
  }

  const errores = vista?.resultado.errores ?? [];
  const asientos = vista?.resultado.asientos ?? [];
  const bloqueo = !vista
    ? null
    : errores.length > 0
      ? `El archivo tiene ${errores.length} error${errores.length === 1 ? "" : "es"}. Corrígelos en el Excel y vuelve a subirlo: se registra todo o nada.`
      : vista.yaImportado
        ? `Este archivo ya se importó el ${formatDate(vista.yaImportado)} y sigue contabilizado.`
        : null;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-5 shadow-sm">
        <a
          href="/api/finanzas/asientos/importar/plantilla"
          className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-200 bg-white px-4 text-sm font-semibold text-integra-navy hover:border-integra-navy"
        >
          <Download size={16} />
          Descargar la plantilla
        </a>
        <label className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-md bg-integra-navy px-4 text-sm font-semibold text-white hover:bg-integra-navy/90">
          <Upload size={16} />
          {archivo ? "Subir otro archivo" : "Subir el archivo"}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            aria-label="Archivo de asientos"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) previsualizar(f);
              e.target.value = "";
            }}
          />
        </label>
        {archivo && <span className="text-sm text-gray-600">{archivo.name}</span>}
        {isPending && <span className="text-sm text-gray-500">Procesando…</span>}
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {vista && (
        <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Vista previa</h2>
          <p className="text-sm text-gray-600">
            {vista.resultado.filasLeidas} fila{vista.resultado.filasLeidas === 1 ? "" : "s"} · {asientos.length} asiento
            {asientos.length === 1 ? "" : "s"} · débitos B/. {fmtImporte(vista.resultado.totalDebitos)}
          </p>

          {errores.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-red-200">
              <table className="w-full text-sm">
                <thead className="bg-red-50 text-left text-xs uppercase tracking-wider text-red-700">
                  <tr>
                    <th className="px-3 py-2">Fila</th>
                    <th className="px-3 py-2">Columna</th>
                    <th className="px-3 py-2">Qué hay que corregir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {errores.map((e, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-mono">{e.fila || "Archivo"}</td>
                      <td className="px-3 py-1.5">{e.columna ?? ""}</td>
                      <td className="px-3 py-1.5 text-red-800">{e.mensaje}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {asientos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="pb-2 pr-2">Asiento</th>
                    <th className="pb-2 pr-2">Filas</th>
                    <th className="pb-2 pr-2">Fecha</th>
                    <th className="pb-2 pr-2">Descripción</th>
                    <th className="pb-2 pr-2 text-right">Líneas</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {asientos.map((a) => (
                    <tr key={`${a.group_label}-${a.first_row}`}>
                      <td className="py-1.5 pr-2 font-mono">{a.group_label}</td>
                      <td className="py-1.5 pr-2 text-gray-500">
                        {a.first_row} a {a.last_row}
                      </td>
                      <td className="py-1.5 pr-2">{a.transaction_date ? formatDate(a.transaction_date) : ""}</td>
                      <td className="py-1.5 pr-2">{a.description}</td>
                      <td className="py-1.5 pr-2 text-right">{a.lines.length}</td>
                      <td className="py-1.5 text-right font-mono">{fmtImporte(a.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={contabilizar}
              disabled={!!bloqueo || isPending || asientos.length === 0}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-600/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              Contabilizar {asientos.length} asiento{asientos.length === 1 ? "" : "s"} (B/. {fmtImporte(vista.resultado.totalDebitos)})
            </button>
            {bloqueo && <p className="text-sm text-red-700">{bloqueo}</p>}
          </div>
        </section>
      )}
    </div>
  );
}

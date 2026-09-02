"use client";

import { useState } from "react";
import { Download, Loader2, AlertTriangle } from "lucide-react";

import { abrirArchivo } from "@/lib/storage/abrir-archivo";

/**
 * Botón de exportar a Excel, compartido por los reportes.
 *
 * Usa `abrirArchivo()` —el mismo helper de las descargas de documentos— y no un
 * `<a href>` ni `window.open()`: esos pierden la sesión en algunos navegadores y
 * dejan al usuario mirando una pestaña en blanco cuando el servidor responde
 * 403. Leyendo la respuesta se puede mostrar el error de verdad.
 */
export function BotonExportar({
  href,
  nombreSugerido,
  etiqueta = "Exportar a Excel",
}: {
  href: string;
  nombreSugerido: string;
  etiqueta?: string;
}) {
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportar() {
    setBajando(true);
    setError(null);
    const r = await abrirArchivo(href, { descargar: true, nombre: nombreSugerido });
    if (!r.ok) setError(r.error ?? "No se pudo generar el archivo");
    setBajando(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={exportar}
        disabled={bajando}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-integra-navy px-4 text-sm font-medium text-integra-navy transition-colors hover:bg-integra-navy hover:text-white disabled:opacity-60"
      >
        {bajando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {bajando ? "Generando…" : etiqueta}
      </button>
      {error && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-red-600">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

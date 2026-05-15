"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  month: string;
}

/**
 * Dos botones que descargan el reporte como Excel o PDF respectivamente.
 * Hace fetch al endpoint, recibe el blob y dispara la descarga con un
 * <a> programático (mismo patrón que el download de PDF de cotizaciones).
 */
export function ExportButtons({ month }: Props) {
  const [loading, setLoading] = useState<"xlsx" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function downloadFormat(format: "xlsx" | "pdf") {
    setError(null);
    setLoading(format);
    try {
      const res = await fetch(
        `/api/finanzas/reportes/vat-summary/export?month=${month}&format=${format}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Error al generar ${format.toUpperCase()}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Anchor programático — preserva la pestaña actual en lugar de
      // navegar la página o abrir popup bloqueado.
      const a = document.createElement("a");
      a.href = url;
      a.download = `VAT_Summary_${month}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadFormat("xlsx")}
          disabled={loading !== null}
          className="min-h-[44px] border-integra-navy/30 text-integra-navy hover:bg-integra-navy/5"
        >
          {loading === "xlsx" ? (
            <>
              <Loader2 size={16} className="mr-1.5 animate-spin" />
              Generando…
            </>
          ) : (
            <>
              <FileSpreadsheet size={16} className="mr-1.5" />
              Descargar Excel
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadFormat("pdf")}
          disabled={loading !== null}
          className="min-h-[44px] border-integra-navy/30 text-integra-navy hover:bg-integra-navy/5"
        >
          {loading === "pdf" ? (
            <>
              <Loader2 size={16} className="mr-1.5 animate-spin" />
              Generando…
            </>
          ) : (
            <>
              <FileText size={16} className="mr-1.5" />
              Descargar PDF
            </>
          )}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}


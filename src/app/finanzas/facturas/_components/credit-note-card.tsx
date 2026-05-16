"use client";

import { useState } from "react";
import { FileMinus, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  creditNoteId: string;
  creditNoteNumber: string;
}

/**
 * Card visible en el detalle de una factura anulada que muestra la NC
 * generada automáticamente y permite descargar/ver el PDF on-demand
 * (Sprint 2C, D7).
 *
 * Por qué client component: el botón "Ver PDF" hace fetch al endpoint que
 * devuelve el PDF inline, y abre la URL blob en una pestaña nueva. NO
 * usar window.open(api/.../pdf) directo porque cualquier sesión que se
 * pierda redirige al login en la nueva pestaña — el fetch desde el origen
 * mantiene la sesión y baja el blob limpio.
 */
export function CreditNoteCard({ creditNoteId, creditNoteNumber }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function viewPdf() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/finanzas/credit-notes/${creditNoteId}/pdf`, {
        method: "GET",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo generar el PDF.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Anchor programático para abrir en pestaña nueva sin perder sesión.
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Liberar la URL del blob después de un margen para que el navegador
      // termine de abrirlo en la pestaña.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Error de red al generar el PDF.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-integra-gold/15">
          <FileMinus size={20} className="text-integra-navy" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-integra-navy">
            Nota de crédito
          </h2>
          <p className="text-xs text-gray-500">
            Documento generado automáticamente al anular esta factura.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-gray-50 p-3">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            Número
          </span>
          <span className="font-mono font-semibold text-integra-navy">
            {creditNoteNumber}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={viewPdf}
          disabled={loading}
          className="min-h-[40px]"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="mr-2 animate-spin" />
              Generando…
            </>
          ) : (
            <>
              <FileDown size={16} className="mr-2" />
              Ver PDF
            </>
          )}
        </Button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  creditNoteId: string;
  /** Botón chico para una fila de lista; por defecto el tamaño de acción de cabecera. */
  compact?: boolean;
}

/**
 * Abre el PDF de una nota de crédito en una pestaña nueva.
 *
 * Por qué client component y fetch + blob: `window.open(api/.../pdf)` directo
 * pierde la sesión en la pestaña nueva y termina en el login. El fetch desde
 * el origen mantiene la sesión y baja el blob limpio (lección del Sprint 2C).
 * Lo usan el detalle de la factura (fila por NC) y el detalle de la NC.
 */
export function CreditNotePdfButton({ creditNoteId, compact }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function viewPdf() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/finanzas/credit-notes/${creditNoteId}/pdf`, { method: "GET" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo generar el PDF.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Error de red al generar el PDF.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <Button
        type="button"
        variant="outline"
        onClick={viewPdf}
        disabled={loading}
        className={compact ? "min-h-[40px]" : "min-h-[48px]"}
        title="Ver el PDF de la nota de crédito"
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
      {error && (
        <span className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

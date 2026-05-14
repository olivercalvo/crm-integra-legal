"use client";

/**
 * Botón "Descargar PDF" — disponible en todos los estados de cotización
 * (Sprint 2E.3, D7). Click → fetch al endpoint GET /pdf que devuelve un
 * signed URL del PDF actual (regenera on-demand si el contenido cambió).
 *
 * UX:
 *   - Loading state mientras espera la respuesta.
 *   - Toast verde sutil si regenerated=true ("PDF actualizado").
 *   - Toast rojo si falla.
 *   - El URL se abre en una pestaña nueva (window.open). Si el browser
 *     bloquea el popup, fallback a navegación directa.
 */

import { useState } from "react";
import { Download, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  quoteId: string;
  quoteNumber: string;
  disabled?: boolean;
  /** Estilo del botón. Por defecto "outline". */
  variant?: "default" | "outline";
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "regenerated" }
  | { kind: "error"; message: string };

export function DownloadPdfButton({
  quoteId,
  quoteNumber,
  disabled,
  variant = "outline",
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleClick() {
    if (status.kind === "loading") return;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/finanzas/quotes/${quoteId}/pdf`, {
        method: "GET",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: data?.error ?? "No se pudo generar el PDF",
        });
        setTimeout(() => setStatus({ kind: "idle" }), 4000);
        return;
      }

      const url = data?.url as string | undefined;
      if (!url) {
        setStatus({
          kind: "error",
          message: "El servidor no devolvió un URL del PDF",
        });
        setTimeout(() => setStatus({ kind: "idle" }), 4000);
        return;
      }

      // Abrir en pestaña nueva. Si el browser bloquea, fallback a navegación.
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.href = url;
      }

      if (data?.regenerated) {
        setStatus({ kind: "regenerated" });
        setTimeout(() => setStatus({ kind: "idle" }), 2500);
      } else {
        setStatus({ kind: "idle" });
      }
    } catch {
      setStatus({
        kind: "error",
        message: "Error de red al solicitar el PDF",
      });
      setTimeout(() => setStatus({ kind: "idle" }), 4000);
    }
  }

  const loading = status.kind === "loading";

  return (
    <div className="relative inline-flex flex-col items-stretch">
      <Button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading}
        variant={variant === "default" ? "default" : "outline"}
        title={`Descargar PDF de ${quoteNumber}`}
        className="min-h-[48px]"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="mr-2 animate-spin" />
            Generando…
          </>
        ) : (
          <>
            <Download size={16} className="mr-2" />
            Descargar PDF
          </>
        )}
      </Button>

      {status.kind === "regenerated" && (
        <div
          role="status"
          className="absolute top-full mt-1 right-0 flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 shadow-sm whitespace-nowrap"
        >
          <CheckCircle size={12} />
          PDF actualizado
        </div>
      )}

      {status.kind === "error" && (
        <div
          role="alert"
          className="absolute top-full mt-1 right-0 flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 shadow-sm max-w-[240px]"
        >
          <AlertCircle size={12} className="shrink-0" />
          <span className="truncate">{status.message}</span>
        </div>
      )}
    </div>
  );
}

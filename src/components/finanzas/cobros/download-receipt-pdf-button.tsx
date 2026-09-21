"use client";

/**
 * Botón "Recibo" — descarga el PDF del recibo de caja de un cobro.
 *
 * Vive en dos lugares: la fila del cobro en el detalle de la factura y la
 * fila del listado de cobros. Espejo de `download-invoice-pdf-button.tsx`:
 * `fetch` a `GET /api/finanzas/payments/[id]/pdf`, que devuelve el ARCHIVO
 * (no un enlace a `*.supabase.co`), y anchor programático vía `abrirArchivo`
 * para no cambiar de pestaña.
 *
 * Lo ve también el contador (misma lista de roles que el PDF de la factura).
 */

import { useState } from "react";
import { FileDown, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { abrirArchivo } from "@/lib/storage/abrir-archivo";

interface Props {
  paymentId: string;
  /** Para el `title` del botón, ej. "REC-000012". */
  receiptLabel: string;
  disabled?: boolean;
  /** Compacto para filas de tabla (icono + "Recibo"); por defecto el botón completo. */
  compact?: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "regenerated" }
  | { kind: "error"; message: string };

export function DownloadReceiptPdfButton({ paymentId, receiptLabel, disabled, compact }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleClick() {
    if (status.kind === "loading") return;
    setStatus({ kind: "loading" });
    try {
      const r = await abrirArchivo(`/api/finanzas/payments/${paymentId}/pdf`);
      if (!r.ok) {
        setStatus({ kind: "error", message: r.error ?? "No se pudo generar el recibo" });
        setTimeout(() => setStatus({ kind: "idle" }), 4000);
        return;
      }
      if (r.headers?.get("X-Pdf-Regenerated") === "1") {
        setStatus({ kind: "regenerated" });
        setTimeout(() => setStatus({ kind: "idle" }), 2500);
      } else {
        setStatus({ kind: "idle" });
      }
    } catch {
      setStatus({ kind: "error", message: "Error de red al solicitar el recibo" });
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
        variant="outline"
        size={compact ? "sm" : "default"}
        title={`Descargar el recibo ${receiptLabel} en PDF`}
        className={compact ? "min-h-[40px] whitespace-nowrap" : "min-h-[48px]"}
      >
        {loading ? (
          <Loader2 size={compact ? 14 : 16} className={`${compact ? "mr-1" : "mr-2"} animate-spin`} />
        ) : (
          <FileDown size={compact ? 14 : 16} className={compact ? "mr-1" : "mr-2"} />
        )}
        {loading ? "Generando…" : compact ? "Recibo" : "Descargar recibo"}
      </Button>

      {status.kind === "regenerated" && (
        <div
          role="status"
          className="absolute top-full z-10 mt-1 right-0 flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 shadow-sm whitespace-nowrap"
        >
          <CheckCircle size={12} />
          Recibo actualizado
        </div>
      )}

      {status.kind === "error" && (
        <div
          role="alert"
          className="absolute top-full z-10 mt-1 right-0 flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 shadow-sm max-w-[240px]"
        >
          <AlertCircle size={12} className="shrink-0" />
          <span className="truncate">{status.message}</span>
        </div>
      )}
    </div>
  );
}

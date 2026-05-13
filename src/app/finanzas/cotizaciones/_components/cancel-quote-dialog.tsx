"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  quoteId: string;
  quoteNumber: string;
  disabled?: boolean;
}

const REASON_MAX = 1000;

/**
 * Botón "Cancelar" + dialog con razón opcional (D5). Solo válido para
 * cotizaciones en estado 'borrador'. Transición → 'cancelada_pre_envio'.
 *
 * Nota terminológica: "cancelar" aquí significa descartar un borrador
 * sin enviarlo. No confundir con "rechazar" (cliente rechaza una cotización
 * enviada).
 */
export function CancelQuoteDialog({ quoteId, quoteNumber, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  function reset() {
    setReason("");
    setSubmitError(null);
  }

  function submit() {
    setSubmitError(null);

    startTransition(async () => {
      try {
        const trimmed = reason.trim();
        const res = await fetch(`/api/finanzas/quotes/${quoteId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error ?? "No se pudo cancelar la cotización.");
          return;
        }
        setOpen(false);
        const url = new URL(window.location.href);
        url.searchParams.set("cancelled", "1");
        router.replace(url.pathname + url.search, { scroll: false });
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  const trimmedLen = reason.trim().length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="text-gray-700 border-gray-300 hover:bg-gray-50 min-h-[48px]"
      >
        <Ban size={16} className="mr-2" />
        Cancelar
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => {
          if (!isPending) {
            setOpen(false);
            reset();
          }
        }}
        onConfirm={submit}
        loading={isPending}
        title={`Cancelar cotización ${quoteNumber}`}
        confirmButtonText={isPending ? "Cancelando…" : "Sí, cancelar"}
        cancelButtonText="Volver"
      >
        <div className="space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p>
              Esta acción descarta el borrador sin enviarlo. No se puede
              deshacer. La cotización queda archivada con estado{" "}
              <span className="font-mono">cancelada</span>.
            </p>
          </div>

          <div>
            <Label htmlFor="cancel_quote_reason" className="text-sm">
              Razón de cancelación{" "}
              <span className="text-xs text-gray-500">(opcional)</span>
            </Label>
            <textarea
              id="cancel_quote_reason"
              ref={textareaRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              rows={3}
              maxLength={REASON_MAX}
              placeholder="Ej: el cliente cambió el alcance, datos incompletos, error en el monto…"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-end">
              <span className="text-xs font-mono text-gray-400">
                {trimmedLen}/{REASON_MAX}
              </span>
            </div>
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {isPending && (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Procesando…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}

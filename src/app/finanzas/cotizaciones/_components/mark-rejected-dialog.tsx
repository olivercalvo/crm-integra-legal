"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle, AlertCircle, Loader2 } from "lucide-react";
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
 * Botón "Marcar Rechazada" + dialog con razón opcional (D5). Solo aparece
 * cuando status='enviada'. Transición → 'rechazada' vía POST /mark-rejected.
 *
 * La razón es opcional y queda como seguimiento interno (rejection_reason
 * en la tabla quotes).
 */
export function MarkRejectedDialog({ quoteId, quoteNumber, disabled }: Props) {
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
        const res = await fetch(`/api/finanzas/quotes/${quoteId}/mark-rejected`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error ?? "No se pudo marcar la cotización como rechazada.");
          return;
        }
        setOpen(false);
        const url = new URL(window.location.href);
        url.searchParams.set("rejected", "1");
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
        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 min-h-[48px]"
      >
        <XCircle size={16} className="mr-2" />
        Marcar rechazada
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
        title={`Marcar como rechazada — ${quoteNumber}`}
        confirmButtonText={isPending ? "Procesando…" : "Sí, marcar rechazada"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            ¿El cliente rechazó esta cotización? Esta acción es para tu
            seguimiento interno — la cotización queda archivada con estado
            <span className="mx-1 font-mono">rechazada</span>.
          </p>

          <div>
            <Label htmlFor="reject_quote_reason" className="text-sm">
              Razón del rechazo{" "}
              <span className="text-xs text-gray-500">(opcional)</span>
            </Label>
            <textarea
              id="reject_quote_reason"
              ref={textareaRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              rows={3}
              maxLength={REASON_MAX}
              placeholder="Ej: precio fuera de presupuesto, contrató otro estudio, plazo no compatible…"
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

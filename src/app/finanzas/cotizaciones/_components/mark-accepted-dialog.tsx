"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  quoteId: string;
  quoteNumber: string;
  disabled?: boolean;
}

/**
 * Botón "Marcar Aceptada" + confirm dialog (D5). Solo aparece cuando
 * status='enviada'. Transición → 'aceptada' vía POST /mark-accepted.
 *
 * Sin razón (la aceptación no necesita justificación adicional). Solo
 * confirma intención.
 */
export function MarkAcceptedDialog({ quoteId, quoteNumber, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  function submit() {
    setSubmitError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/quotes/${quoteId}/mark-accepted`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error ?? "No se pudo marcar la cotización como aceptada.");
          return;
        }
        setOpen(false);
        const url = new URL(window.location.href);
        url.searchParams.set("accepted", "1");
        router.replace(url.pathname + url.search, { scroll: false });
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setSubmitError(null);
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="bg-green-600 text-white hover:bg-green-700 min-h-[48px]"
      >
        <CheckCircle size={16} className="mr-2" />
        Marcar aceptada
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={submit}
        loading={isPending}
        title={`Marcar como aceptada — ${quoteNumber}`}
        confirmButtonText={isPending ? "Procesando…" : "Sí, marcar aceptada"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            ¿El cliente respondió que acepta esta cotización?
          </p>
          <div className="rounded-md border-l-4 border-green-400 bg-green-50 p-3 text-sm text-green-900">
            <p>
              Una vez marcada como aceptada, la cotización queda disponible
              para conversión a facturas desde el mismo detalle.
            </p>
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertCircle } from "lucide-react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  paymentId: string;
  paymentLabel: string; // ej. "B/. 300.00 del 13/05/2026"
  disabled?: boolean;
}

/**
 * Botón con icono que abre un confirm para eliminar un pago. T6 valida
 * server-side que el pago esté en status='registrado' (los conciliados
 * NO se pueden borrar). T7a recalcula el status de la factura
 * automáticamente al borrar el último pago (puede revertir
 * 'pagada'→'emitida').
 */
export function DeletePaymentButton({ paymentId, paymentLabel, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  function submit() {
    setSubmitError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/payments/${paymentId}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error ?? "No se pudo eliminar el pago.");
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intentá de nuevo.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSubmitError(null);
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="inline-flex items-center justify-center rounded-md p-2 text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Eliminar pago de ${paymentLabel}`}
        title="Eliminar pago"
      >
        <Trash2 size={16} />
      </button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={submit}
        loading={isPending}
        title="Eliminar pago"
        confirmButtonText={isPending ? "Eliminando…" : "Sí, eliminar pago"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-3">
          <p>
            Vas a eliminar el pago de{" "}
            <span className="font-semibold text-integra-navy">
              {paymentLabel}
            </span>
            . Esta acción se puede revertir registrándolo de nuevo.
          </p>
          <p className="text-xs text-gray-500">
            El estado de la factura se recalculará automáticamente: si era el
            único pago, volverá a &quot;Emitida&quot;.
          </p>
          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}

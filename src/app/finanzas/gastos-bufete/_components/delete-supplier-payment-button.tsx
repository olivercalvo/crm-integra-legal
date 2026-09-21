"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertCircle } from "lucide-react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  paymentId: string;
  paymentLabel: string;
  /** Un saldo heredado de la 048: el texto del modal dice qué es y qué pasa al borrarlo. */
  heredado?: boolean;
  disabled?: boolean;
}

/**
 * Elimina un pago a proveedor SIN asiento (Bloque 3). Con asiento el servidor
 * responde 409 y el botón no se ofrece (se ofrece Reversar). Para un saldo
 * heredado es la corrección honesta: si la compra en realidad nunca se pagó,
 * borrarlo la devuelve a "pendiente de pago" y a la antigüedad.
 */
export function DeleteSupplierPaymentButton({ paymentId, paymentLabel, heredado, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  function submit() {
    setSubmitError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/supplier-payments/${paymentId}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error ?? "No se pudo eliminar el pago.");
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intente de nuevo.");
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
        aria-label={`Eliminar ${heredado ? "saldo heredado" : "pago"} de ${paymentLabel}`}
        title={heredado ? "Eliminar el saldo heredado (la compra vuelve a pendiente)" : "Eliminar pago"}
      >
        <Trash2 size={16} />
      </button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={submit}
        loading={isPending}
        title={heredado ? "Eliminar saldo heredado" : "Eliminar pago"}
        confirmButtonText={isPending ? "Eliminando…" : heredado ? "Sí, la compra no estaba pagada" : "Sí, eliminar pago"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-3">
          {heredado ? (
            <>
              <p>
                Este movimiento es un <span className="font-semibold">saldo heredado de la migración</span>:
                la compra estaba marcada como pagada antes de que existieran los pagos a proveedor, y no
                hay ningún pago registrado detrás ({paymentLabel}).
              </p>
              <p className="text-xs text-gray-500">
                Al eliminarlo, la compra vuelve a &quot;Pendiente de pago&quot; y aparece en la antigüedad
                de cuentas por pagar. Si en realidad sí se pagó, registre el pago real (con su banco) y
                después elimine este saldo.
              </p>
            </>
          ) : (
            <>
              <p>
                Vas a eliminar el pago de <span className="font-semibold text-integra-navy">{paymentLabel}</span>.
                Esta acción se puede revertir registrándolo de nuevo.
              </p>
              <p className="text-xs text-gray-500">
                El estado de la compra se recalculará automáticamente: si era el único pago, volverá a
                &quot;Pendiente de pago&quot;.
              </p>
            </>
          )}
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

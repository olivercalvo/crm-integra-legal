"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  quoteId: string;
  quoteLabel: string;
  disabled?: boolean;
}

/**
 * Botón eliminar cotización. Solo válido en borradores o canceladas
 * pre-envío; T6-quote enforza server-side. Al éxito redirige a la lista
 * con ?deleted=<label> para que DeleteSuccessToast muestre el feedback.
 */
export function DeleteQuoteButton({ quoteId, quoteLabel, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/quotes/${quoteId}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo eliminar la cotización");
          return;
        }
        router.push(`/finanzas/cotizaciones?deleted=${encodeURIComponent(quoteLabel)}`);
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 min-h-[48px]"
      >
        <Trash2 size={16} className="mr-2" />
        Eliminar
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={handleDelete}
        loading={isPending}
        title="Eliminar cotización"
        confirmButtonText="Sí, eliminar"
        cancelButtonText="Cancelar"
      >
        <p className="text-sm text-gray-700">
          ¿Seguro que quieres eliminar permanentemente la cotización{" "}
          <span className="font-semibold">{quoteLabel}</span>? Esta acción no
          se puede deshacer.
        </p>
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </ConfirmationModal>
    </>
  );
}

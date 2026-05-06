"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { INVOICE_KIND_LABEL, type InvoiceKind } from "@/lib/finanzas/types/invoice";

interface Props {
  invoiceId: string;
  invoiceKind: InvoiceKind;
  /** Preview del próximo número (puede ser null si la query falló). */
  nextNumberPreview: string | null;
  /** Total a emitir, en USD. Para mostrar al confirmar. */
  grandTotal: number;
  disabled?: boolean;
}

/**
 * Botón "Emitir" + modal de confirmación con preview del número.
 *
 * El preview es informativo: si entre el render y el click otra factura
 * consume la secuencia, el número final puede diferir. La app muestra el
 * número definitivo después del POST exitoso.
 */
export function EmitInvoiceDialog({
  invoiceId,
  invoiceKind,
  nextNumberPreview,
  grandTotal,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function emit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${invoiceId}/emit`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo emitir la factura");
          return;
        }
        setOpen(false);
        // Propagar número emitido vía URL para que InvoiceSuccessToast lo
        // surface en el detalle. router.refresh recarga la data.
        const num = data.invoice_number as string | undefined;
        if (num) {
          router.push(`/finanzas/facturas/${invoiceId}?emitted=${encodeURIComponent(num)}`);
        }
        router.refresh();
      } catch {
        setError("Error de red. Intentá de nuevo.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]"
      >
        <Send size={16} className="mr-2" />
        Emitir factura
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={emit}
        loading={isPending}
        title="Emitir factura"
        confirmButtonText="Sí, emitir"
        cancelButtonText="Cancelar"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Esta acción asigna el número definitivo y cambia el estado a{" "}
            <span className="font-semibold text-integra-navy">emitida</span>. La
            factura ya no podrá editarse ni eliminarse.
          </p>

          <div className="rounded-md border bg-gray-50 p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Tipo</span>
              <span className="font-medium text-gray-900">
                {INVOICE_KIND_LABEL[invoiceKind]}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Número que se asignará</span>
              <span className="font-mono font-semibold text-integra-navy">
                {nextNumberPreview ?? "—"}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-gray-500">Total</span>
              <span className="font-mono font-semibold text-gray-900">
                ${grandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {nextNumberPreview && (
            <p className="text-xs text-gray-500">
              El número es preview. Si otra factura del mismo tipo se emite antes,
              el número final será el siguiente disponible.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isPending && (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Emitiendo…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}

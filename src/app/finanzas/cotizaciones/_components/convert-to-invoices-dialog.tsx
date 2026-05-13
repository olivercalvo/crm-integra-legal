"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  quoteId: string;
  quoteNumber: string;
  subtotalHon: number;
  subtotalRei: number;
  taxTotal: number;
  grandTotal: number;
  disabled?: boolean;
}

/**
 * Convertir cotización a facturas (D3).
 *
 * Solo aparece cuando status='aceptada'. Modal con preview client-side de
 * lo que se va a crear (1 o 2 facturas según los subtotales HON/REI > 0).
 *
 * Al confirmar → POST /convert → response { invoice_ids: string[] }
 *   - 1 invoice_id → redirect a /finanzas/facturas/[id]?converted=1
 *   - 2 invoice_ids → redirect a la primera, con ?converted=2 para que el
 *                     toast muestre el contador.
 *
 * El gate de client_status='active' lo hace el helper convertToInvoices()
 * server-side: si el cliente es prospect o inactivo, la API responde 400
 * con mensaje explicativo que mostramos en el dialog.
 */
export function ConvertToInvoicesDialog({
  quoteId,
  quoteNumber,
  subtotalHon,
  subtotalRei,
  taxTotal,
  grandTotal,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasHon = subtotalHon > 0;
  const hasRei = subtotalRei > 0;
  const invoiceCount = (hasHon ? 1 : 0) + (hasRei ? 1 : 0);

  // Las facturas se generan con líneas brutas; los impuestos se recalculan
  // server-side por trigger T8b. Para el preview client-side aproximamos el
  // total de cada factura proporcionalmente al subtotal de su grupo
  // (los rates por línea pueden variar, pero para el preview es suficiente).
  // Mientras subtotalHon + subtotalRei > 0 (siempre cierto si convertible),
  // la división es segura.
  const totalSub = subtotalHon + subtotalRei;
  const honTotal =
    totalSub > 0 ? subtotalHon + taxTotal * (subtotalHon / totalSub) : 0;
  const reiTotal =
    totalSub > 0 ? subtotalRei + taxTotal * (subtotalRei / totalSub) : 0;

  function submit() {
    setSubmitError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/quotes/${quoteId}/convert`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error ?? "No se pudo convertir la cotización.");
          return;
        }
        const invoiceIds = (data.invoice_ids as string[] | undefined) ?? [];
        if (invoiceIds.length === 0) {
          setSubmitError("La conversión devolvió respuesta inesperada.");
          return;
        }
        setOpen(false);
        // Redirigir a la primera factura creada con ?converted=<N> para
        // disparar el toast en /finanzas/facturas/[id]. El módulo Facturas
        // tiene su propio InvoiceSuccessToast que lee `converted` y muestra
        // un mensaje contextual.
        router.push(
          `/finanzas/facturas/${invoiceIds[0]}?converted=${invoiceIds.length}`
        );
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
        className="bg-integra-navy text-white hover:bg-integra-navy/90 min-h-[48px]"
      >
        <ArrowRightCircle size={16} className="mr-2" />
        Convertir a factura{invoiceCount === 1 ? "" : "s"}
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={submit}
        loading={isPending}
        title={`Convertir cotización ${quoteNumber}`}
        confirmButtonText={isPending ? "Convirtiendo…" : "Sí, convertir"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Esta cotización va a generar{" "}
            <span className="font-semibold">
              {invoiceCount} factura{invoiceCount === 1 ? "" : "s"}
            </span>
            :
          </p>

          <ul className="space-y-2 rounded-md border bg-gray-50 p-3">
            {hasHon && (
              <li className="flex items-center justify-between gap-2 text-sm">
                <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                  <FileText size={14} className="text-blue-600" />
                  Factura de Honorarios
                </span>
                <span className="font-mono font-semibold text-gray-900">
                  ${honTotal.toFixed(2)}
                </span>
              </li>
            )}
            {hasRei && (
              <li className="flex items-center justify-between gap-2 text-sm">
                <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                  <FileText size={14} className="text-orange-600" />
                  Factura de Reembolso
                </span>
                <span className="font-mono font-semibold text-gray-900">
                  ${reiTotal.toFixed(2)}
                </span>
              </li>
            )}
            <li className="flex items-center justify-between gap-2 border-t pt-2 text-sm">
              <span className="font-semibold text-integra-navy">Total general</span>
              <span className="font-mono font-bold text-integra-navy">
                ${grandTotal.toFixed(2)}
              </span>
            </li>
          </ul>

          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p>
              Las facturas se crearán en estado{" "}
              <span className="font-mono">borrador</span>. Deberás emitirlas
              manualmente desde el módulo Facturas. Esta acción no se puede
              deshacer.
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
              Convirtiendo…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}

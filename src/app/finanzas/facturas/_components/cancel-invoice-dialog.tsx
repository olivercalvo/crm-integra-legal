"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { Label } from "@/components/ui/label";
import { INVOICE_KIND_LABEL, type InvoiceKind } from "@/lib/finanzas/types/invoice";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  invoiceKind: InvoiceKind;
  grandTotal: number;
  disabled?: boolean;
}

/**
 * Botón "Anular factura" + modal con captura de razón. Es la única vía de
 * anulación post-emisión que tienen las abogadas (no hay acceso SQL en prod).
 *
 * Validación cliente-side replica la del backend (validateCancelInput):
 * razón trim length >= 3. El backend además valida estado de origen vía
 * cancelInvoice() — si la factura ya está anulada o no fue emitida, devuelve
 * 400 con mensaje específico.
 */
export function CancelInvoiceDialog({
  invoiceId,
  invoiceNumber,
  invoiceKind,
  grandTotal,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus al textarea cuando se abre el dialog. Pequeño delay para que
  // el render del modal termine antes; sin él el focus se pierde porque el
  // ConfirmationModal se monta después del onClick.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const trimmedLen = reason.trim().length;
  const meetsMinimum = trimmedLen >= 3;
  const REASON_MAX = 1000;

  function reset() {
    setReason("");
    setReasonError(null);
    setSubmitError(null);
  }

  function submit() {
    setReasonError(null);
    setSubmitError(null);

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setReasonError("La razón de anulación debe tener al menos 3 caracteres.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${invoiceId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Si vino fieldErrors.reason del backend, mostralo bajo el textarea.
          if (data.fieldErrors?.reason) {
            setReasonError(data.fieldErrors.reason);
          }
          setSubmitError(data.error ?? "No se pudo anular la factura.");
          return;
        }

        // Éxito: cerrar modal + propagar via URL param para que el toast
        // surface el mensaje. router.refresh recarga el server component.
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
        Anular factura
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
        title="Anular factura"
        confirmButtonText={isPending ? "Anulando…" : "Sí, anular factura"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          {/* Banner rojo de irreversibilidad */}
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-900"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <p>
              <span className="font-semibold">Esta acción es irreversible.</span>{" "}
              La factura quedará marcada como anulada y no podrá ser editada
              ni eliminada.
            </p>
          </div>

          {/* Card con info de la factura */}
          <div className="rounded-md border bg-gray-50 p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Número</span>
              <span className="font-mono font-semibold text-integra-navy">
                {invoiceNumber}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tipo</span>
              <span className="font-medium text-gray-900">
                {INVOICE_KIND_LABEL[invoiceKind]}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-gray-500">Total</span>
              <span className="font-mono font-semibold text-gray-900">
                ${grandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Form: textarea con razón */}
          <div>
            <Label htmlFor="cancel_reason" className="text-sm">
              Razón de anulación{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            <textarea
              id="cancel_reason"
              ref={textareaRef}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              disabled={isPending}
              rows={3}
              maxLength={REASON_MAX}
              placeholder="Ej: Datos del receptor incorrectos, error en el monto…"
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy ${
                reasonError
                  ? "border-red-300"
                  : "border-gray-300 hover:border-integra-navy"
              }`}
            />
            <div className="mt-1 flex items-start justify-between gap-3">
              <p
                className={`text-xs ${
                  reasonError ? "text-red-600" : "text-gray-500"
                }`}
              >
                {reasonError ??
                  "Esta razón quedará registrada permanentemente y se enviará a DGI cuando se complete la integración con eFactura."}
              </p>
              <span
                aria-live="polite"
                className={`shrink-0 text-xs font-mono ${
                  trimmedLen === 0
                    ? "text-gray-400"
                    : meetsMinimum
                      ? "text-gray-500"
                      : "text-amber-600"
                }`}
              >
                {trimmedLen}/{REASON_MAX}
              </span>
            </div>
          </div>

          {/* Error del backend (solo si no es field-level) */}
          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {isPending && (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Anulando…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}

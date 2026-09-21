"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { fmtImporte } from "@/lib/utils/importe";
import {
  PaymentFormFields,
  emptyPaymentFormValues,
  validatePaymentForm,
  toPaymentPayload,
  type PaymentFormValues,
  type PaymentFormErrors,
} from "@/components/finanzas/cobros/payment-form-fields";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  balanceDue: number;
  /** Las cuentas que se ofrecen como banco. Vienen de `listarCuentasDeBanco()`. */
  bancos: { code: string; name: string }[];
  disabled?: boolean;
}

/**
 * Modal para registrar un pago contra una factura, parado sobre la factura.
 *
 * Los campos, la validación de cliente y el body los pone
 * `PaymentFormFields` (una sola implementación con `/finanzas/cobros/nuevo`).
 * Acá queda lo propio del modal: abrir, mandar, cerrar.
 *
 * Después de registrar exitoso: cierre + `?recibo=REC-000012` en la URL para
 * que `InvoiceSuccessToast` lo anuncie, + `router.refresh` para que el detalle
 * recargue y muestre el nuevo pago con su número + el status que derivó T7a.
 */
export function RegisterPaymentDialog({
  invoiceId,
  invoiceNumber,
  balanceDue,
  bancos,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<PaymentFormValues>(emptyPaymentFormValues);
  const [fieldErrors, setFieldErrors] = useState<PaymentFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus del campo monto al abrir
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => amountInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  function reset() {
    setValues(emptyPaymentFormValues());
    setFieldErrors({});
    setSubmitError(null);
  }

  function submit() {
    setSubmitError(null);
    const { ok, errors, amountNum } = validatePaymentForm(values, balanceDue);
    setFieldErrors(errors);
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${invoiceId}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPaymentPayload(values, amountNum)),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) {
            setFieldErrors(data.fieldErrors);
          }
          setSubmitError(data.error ?? "No se pudo registrar el pago.");
          return;
        }
        setOpen(false);
        reset();
        const url = new URL(window.location.href);
        if (typeof data.payment_number === "string") {
          url.searchParams.set("recibo", data.payment_number);
        }
        router.replace(url.pathname + url.search, { scroll: false });
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intente de nuevo.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="bg-integra-navy text-white hover:bg-integra-navy/90 min-h-[48px]"
      >
        <CircleDollarSign size={16} className="mr-2" />
        Registrar pago
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
        title={`Registrar pago · ${invoiceNumber}`}
        confirmButtonText={isPending ? "Registrando…" : "Registrar pago"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          {/* Resumen del saldo */}
          <div className="rounded-md border bg-gray-50 p-3 text-sm flex justify-between">
            <span className="text-gray-600">Saldo pendiente</span>
            <span className="font-mono font-semibold text-amber-700">
              ${fmtImporte(balanceDue)}
            </span>
          </div>

          <PaymentFormFields
            values={values}
            onChange={setValues}
            errors={fieldErrors}
            onClearError={(f) => setFieldErrors({ ...fieldErrors, [f]: "" })}
            balanceDue={balanceDue}
            bancos={bancos}
            disabled={isPending}
            amountInputRef={amountInputRef}
          />

          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {isPending && (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Registrando…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}

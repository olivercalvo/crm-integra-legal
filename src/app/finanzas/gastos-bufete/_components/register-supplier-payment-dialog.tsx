"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CircleDollarSign, Loader2 } from "lucide-react";
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
  expenseId: string;
  /**
   * A qué documento va el pago (049, arco exclusivo). `"compra"` (default) →
   * `POST /api/finanzas/business-expenses/[id]/payments`; `"tramite"` (gasto de
   * trámite, Bloque 4) → `POST /api/expenses/[id]/payments`. Mismo formulario,
   * mismo motor, misma serie CE-.
   */
  destino?: "compra" | "tramite";
  expenseLabel: string;
  /** Saldo de la compra: `total − amount_paid`. Es el máximo y el valor precargado. */
  saldo: number;
  bancos: { code: string; name: string }[];
  disabled?: boolean;
}

/**
 * "Registrar pago" de una compra (Bloque 3). Reemplaza a "Marcar como pagada"
 * (FND-009): mismos campos MÁS el monto, precargado con el saldo — pagar todo
 * sigue siendo un clic; pagar una parte es cambiar el número (Josuarth: pago
 * parcial SÍ). Los campos son `PaymentFormFields` con `direccion="pago"`: la
 * misma implementación que el cobro, con los rótulos del lado que sale.
 *
 * POST /api/finanzas/business-expenses/[id]/payments → `createSupplierPayment`.
 * Al terminar, `?pago=CE-000004` en la URL para el toast y `router.refresh`.
 */
const ENDPOINT = {
  compra: (id: string) => `/api/finanzas/business-expenses/${id}/payments`,
  tramite: (id: string) => `/api/expenses/${id}/payments`,
} as const;

export function RegisterSupplierPaymentDialog({ expenseId, destino = "compra", expenseLabel, saldo, bancos, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<PaymentFormValues>(emptyPaymentFormValues);
  const [fieldErrors, setFieldErrors] = useState<PaymentFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => amountInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  function reset() {
    // El monto viene puesto con el saldo: el caso común (pagar todo) no teclea.
    setValues({ ...emptyPaymentFormValues(), amount: String(saldo) });
    setFieldErrors({});
    setSubmitError(null);
  }

  function submit() {
    setSubmitError(null);
    const { ok, errors, amountNum } = validatePaymentForm(values, saldo);
    setFieldErrors(errors);
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = await fetch(ENDPOINT[destino](expenseId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPaymentPayload(values, amountNum)),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) setFieldErrors(data.fieldErrors);
          setSubmitError(data.error ?? "No se pudo registrar el pago.");
          return;
        }
        setOpen(false);
        reset();
        const url = new URL(window.location.href);
        if (typeof data.payment_number === "string") url.searchParams.set("pago", data.payment_number);
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
        className="bg-emerald-600 hover:bg-emerald-600/90 text-white min-h-[44px]"
      >
        <CircleDollarSign size={16} className="mr-1.5" />
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
        title={`Registrar pago · ${expenseLabel}`}
        confirmButtonText={isPending ? "Registrando…" : "Registrar pago"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          <div className="rounded-md border bg-gray-50 p-3 text-sm flex justify-between">
            <span className="text-gray-600">Saldo pendiente de la compra</span>
            <span className="font-mono font-semibold text-amber-700">B/. {fmtImporte(saldo)}</span>
          </div>

          <PaymentFormFields
            direccion="pago"
            values={values}
            onChange={setValues}
            errors={fieldErrors}
            onClearError={(f) => setFieldErrors({ ...fieldErrors, [f]: "" })}
            balanceDue={saldo}
            bancos={bancos}
            disabled={isPending}
            amountInputRef={amountInputRef}
            amountHint={
              <p className="mt-1 text-xs text-gray-500">
                Máximo: el saldo, B/. {fmtImporte(saldo)}. Un monto menor es un pago parcial.
              </p>
            }
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

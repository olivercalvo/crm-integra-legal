"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/finanzas/types/payment";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  balanceDue: number;
  disabled?: boolean;
}

/**
 * Modal para registrar un pago contra una factura. Validación cliente-side
 * replica la del backend (validators/payment.ts) + cap por balance_due (D9).
 *
 * Default método (D10): 'transferencia'.
 *
 * Después de registrar exitoso: cierre + router.refresh para que el detalle
 * de la factura recargue y muestre el nuevo pago + status actualizado por
 * el trigger T7a.
 */
export function RegisterPaymentDialog({
  invoiceId,
  invoiceNumber,
  balanceDue,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("transferencia");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus del campo monto al abrir
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => amountInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  function reset() {
    setPaymentDate(todayIso());
    setAmount("");
    setMethod("transferencia");
    setReference("");
    setNotes("");
    setFieldErrors({});
    setSubmitError(null);
  }

  function validate(): { ok: boolean; amountNum: number } {
    const errors: Record<string, string> = {};
    const amountNum = Number(amount);
    if (!paymentDate) {
      errors.payment_date = "Fecha requerida";
    }
    if (!isFinite(amountNum) || amountNum <= 0) {
      errors.amount = "El monto debe ser mayor a 0";
    } else if (amountNum > balanceDue + 0.001) {
      errors.amount = `El monto no puede superar el saldo pendiente (B/. ${balanceDue.toFixed(2)})`;
    }
    setFieldErrors(errors);
    return { ok: Object.keys(errors).length === 0, amountNum };
  }

  function submit() {
    setSubmitError(null);
    const { ok, amountNum } = validate();
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/finanzas/invoices/${invoiceId}/payments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payment_date: paymentDate,
              amount: amountNum,
              method,
              reference: reference.trim() || null,
              notes: notes.trim() || null,
            }),
          }
        );
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
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intentá de nuevo.");
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
              ${balanceDue.toFixed(2)}
            </span>
          </div>

          {/* Fecha */}
          <div>
            <Label htmlFor="payment_date" className="text-sm">
              Fecha del pago{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="payment_date"
              type="date"
              value={paymentDate}
              onChange={(e) => {
                setPaymentDate(e.target.value);
                if (fieldErrors.payment_date) {
                  setFieldErrors({ ...fieldErrors, payment_date: "" });
                }
              }}
              disabled={isPending}
              max={todayIso()}
              className="mt-1"
            />
            {fieldErrors.payment_date && (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.payment_date}
              </p>
            )}
          </div>

          {/* Monto */}
          <div>
            <Label htmlFor="amount" className="text-sm">
              Monto (B/.){" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            <NumberInput
              id="amount"
              ref={amountInputRef}
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={balanceDue}
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (fieldErrors.amount) {
                  setFieldErrors({ ...fieldErrors, amount: "" });
                }
              }}
              disabled={isPending}
              className="mt-1 font-mono"
            />
            {fieldErrors.amount && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.amount}</p>
            )}
            {!fieldErrors.amount && (
              <p className="mt-1 text-xs text-gray-500">
                Máximo permitido: B/. {balanceDue.toFixed(2)}
              </p>
            )}
          </div>

          {/* Método */}
          <div>
            <Label htmlFor="method" className="text-sm">
              Método de pago{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            <select
              id="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              disabled={isPending}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy h-10"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
            {fieldErrors.method && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.method}</p>
            )}
          </div>

          {/* Referencia */}
          <div>
            <Label htmlFor="reference" className="text-sm">
              Referencia (opcional)
            </Label>
            <Input
              id="reference"
              type="text"
              placeholder="N° de cheque, ID de transferencia, comprobante…"
              maxLength={200}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={isPending}
              className="mt-1"
            />
            {fieldErrors.reference && (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.reference}
              </p>
            )}
          </div>

          {/* Notas */}
          <div>
            <Label htmlFor="notes" className="text-sm">
              Notas (opcional)
            </Label>
            <textarea
              id="notes"
              rows={2}
              maxLength={1000}
              placeholder="Detalles adicionales…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy"
            />
            {fieldErrors.notes && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.notes}</p>
            )}
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
              Registrando…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

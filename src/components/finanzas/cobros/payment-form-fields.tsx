"use client";

import type { ReactNode, RefObject } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtImporte } from "@/lib/utils/importe";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/finanzas/types/payment";

/**
 * LOS CAMPOS DEL COBRO — una sola implementación.
 *
 * Desde el Bloque 2 (21/09/2026) un cobro se registra desde DOS puertas: el
 * diálogo "Registrar pago" del detalle de la factura
 * (`facturas/_components/register-payment-dialog.tsx`) y el alta de
 * `/finanzas/cobros/nuevo`. Las dos llegan a la misma `createPayment` —el
 * diálogo por el atajo `POST /api/finanzas/invoices/[id]/payments` (una
 * factura) y el alta por `POST /api/finanzas/payments` (una o varias, con
 * `applications[]`)— así que tienen que pedir lo mismo, validarlo igual y
 * mandarlo igual. El reparto entre varias facturas es del alta
 * (`lib/finanzas/cobros/repartir-por-antiguedad.ts`) y entra por `afterAmount`.
 *
 * Por eso los campos, la validación de cliente y el armado del body viven acá
 * y no en cada pantalla. Hay un test estructural que lee los dos archivos y
 * falla si alguno vuelve a declarar su propio `<input id="amount"` o su propio
 * `validate()` (`payment-form-una-sola-implementacion.test.ts`). Es la lección
 * de `validarConsistenciaDeKind`: dos formularios divergen el día que alguien
 * arregla uno.
 *
 * Lo que NO vive acá: el `fetch`, el cierre del modal / la redirección y el
 * toast. Eso es de cada pantalla.
 */

export interface PaymentFormValues {
  payment_date: string;
  /** Texto del `MoneyInput`, sin parsear. Se convierte en `validatePaymentForm`. */
  amount: string;
  method: PaymentMethod;
  /** Código de la cuenta del plan (banco). Vacío = sin elegir. */
  payment_account_code: string;
  reference: string;
  notes: string;
}

export type PaymentFormErrors = Partial<Record<keyof PaymentFormValues, string>>;

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Default método (D10): 'transferencia'. Banco SIN default, a propósito (Rose, 25/08). */
export function emptyPaymentFormValues(): PaymentFormValues {
  return {
    payment_date: todayIso(),
    amount: "",
    method: "transferencia",
    payment_account_code: "",
    reference: "",
    notes: "",
  };
}

/**
 * Validación cliente-side. Replica la del backend (`validators/payment.ts`) +
 * el cap por `balance_due` (D9). Es feedback sin round-trip: la autoridad
 * sigue siendo el servidor.
 */
export function validatePaymentForm(
  v: PaymentFormValues,
  balanceDue: number
): { ok: boolean; errors: PaymentFormErrors; amountNum: number } {
  const errors: PaymentFormErrors = {};
  const amountNum = Number(v.amount);
  if (!v.payment_date) {
    errors.payment_date = "Fecha requerida";
  }
  if (!v.payment_account_code) {
    errors.payment_account_code = "Elija la cuenta bancaria donde entró el cobro.";
  }
  if (!isFinite(amountNum) || amountNum <= 0) {
    errors.amount = "El monto debe ser mayor a 0";
  } else if (amountNum > balanceDue + 0.001) {
    errors.amount = `El monto no puede superar el saldo pendiente (B/. ${fmtImporte(balanceDue)})`;
  }
  return { ok: Object.keys(errors).length === 0, errors, amountNum };
}

/**
 * El body común de las dos rutas. El diálogo lo manda tal cual (la factura va
 * en el path); el alta le suma `applications[]`.
 */
export function toPaymentPayload(v: PaymentFormValues, amountNum: number) {
  return {
    payment_date: v.payment_date,
    amount: amountNum,
    method: v.method,
    payment_account_code: v.payment_account_code || null,
    reference: v.reference.trim() || null,
    notes: v.notes.trim() || null,
  };
}

interface Props {
  values: PaymentFormValues;
  onChange: (next: PaymentFormValues) => void;
  errors: PaymentFormErrors;
  /** Borra el error de un campo cuando el usuario lo corrige. */
  onClearError: (field: keyof PaymentFormValues) => void;
  /** Saldo de la factura elegida: es el máximo del monto. */
  balanceDue: number;
  /** Las cuentas que se ofrecen como banco. Vienen de `listarCuentasDeBanco()`. */
  bancos: { code: string; name: string }[];
  disabled?: boolean;
  amountInputRef?: RefObject<HTMLInputElement>;
  /**
   * Se dibuja DEBAJO del monto. El alta multi-factura mete acá la tabla de
   * reparto entre facturas (Parte B); el diálogo de una factura no manda nada.
   */
  afterAmount?: ReactNode;
  /** Sustituye la ayuda "Máximo permitido" (el alta multi-factura la reemplaza por el renglón de diferencia). */
  amountHint?: ReactNode;
}

export function PaymentFormFields({
  values,
  onChange,
  errors,
  onClearError,
  balanceDue,
  bancos,
  disabled,
  amountInputRef,
  afterAmount,
  amountHint,
}: Props) {
  function set<K extends keyof PaymentFormValues>(field: K, value: PaymentFormValues[K]) {
    onChange({ ...values, [field]: value });
    if (errors[field]) onClearError(field);
  }

  return (
    <>
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
          value={values.payment_date}
          onChange={(e) => set("payment_date", e.target.value)}
          disabled={disabled}
          max={todayIso()}
          className="mt-1"
        />
        {errors.payment_date && (
          <p className="mt-1 text-xs text-red-600">{errors.payment_date}</p>
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
        <MoneyInput
          id="amount"
          ref={amountInputRef}
          placeholder="0.00"
          value={values.amount}
          onChange={(e) => set("amount", e.target.value)}
          disabled={disabled}
          className="mt-1 font-mono"
        />
        {errors.amount && <p className="mt-1 text-xs text-red-600">{errors.amount}</p>}
        {!errors.amount &&
          (amountHint ?? (
            <p className="mt-1 text-xs text-gray-500">
              Máximo permitido: B/. {fmtImporte(balanceDue)}
            </p>
          ))}
      </div>

      {afterAmount}

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
          value={values.method}
          onChange={(e) => set("method", e.target.value as PaymentMethod)}
          disabled={disabled}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy h-10"
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        {errors.method && <p className="mt-1 text-xs text-red-600">{errors.method}</p>}
      </div>

      {/* ───────────────────────────────────────────────────────────────
          BANCO. Obligatorio y SIN preselección: lo elige quien registra
          (Rose, 25/08). La cuenta operativa y la de saldos de clientes no
          significan lo mismo, y el asiento que sale de acá es inmutable.
          ─────────────────────────────────────────────────────────────── */}
      <div>
        <Label htmlFor="payment_account_code" className="text-sm">
          Banco donde entró el cobro{" "}
          <span className="text-red-600" aria-hidden="true">
            *
          </span>
        </Label>
        <select
          id="payment_account_code"
          value={values.payment_account_code}
          onChange={(e) => set("payment_account_code", e.target.value)}
          disabled={disabled}
          className={
            "mt-1 block w-full rounded-md border px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy h-10 " +
            (errors.payment_account_code ? "border-red-300" : "border-gray-300")
          }
        >
          <option value="">Elija la cuenta…</option>
          {bancos.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code} — {b.name}
            </option>
          ))}
        </select>
        {errors.payment_account_code && (
          <p className="mt-1 text-xs text-red-600">{errors.payment_account_code}</p>
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
          value={values.reference}
          onChange={(e) => set("reference", e.target.value)}
          disabled={disabled}
          className="mt-1"
        />
        {errors.reference && <p className="mt-1 text-xs text-red-600">{errors.reference}</p>}
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
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          disabled={disabled}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy"
        />
        {errors.notes && <p className="mt-1 text-xs text-red-600">{errors.notes}</p>}
      </div>
    </>
  );
}

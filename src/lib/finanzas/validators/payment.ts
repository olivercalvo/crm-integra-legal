/**
 * Validadores manuales para payments — sin Zod, sin react-hook-form.
 *
 * Mismo patrón que validators/business-expense.ts y validators/invoice.ts:
 * cada validador devuelve `{ ok: true, data } | { ok: false, errors }` con
 * `errors` como mapa flat campo → mensaje en español.
 *
 * NOTA sobre el cap del monto (D9): este validador NO conoce balance_due —
 * es responsabilidad del helper server-side createPayment hacer el lookup
 * de la factura y rechazar si amount > balance_due. Acá solo validamos
 * formato y rangos básicos.
 */

import type { CreatePaymentInput, PaymentMethod } from "@/lib/finanzas/types/payment";
import { PAYMENT_METHODS } from "@/lib/finanzas/types/payment";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function validateCreatePayment(
  raw: Partial<CreatePaymentInput> | null | undefined
): ValidationResult<CreatePaymentInput> {
  const errors: ValidationErrors = {};

  // invoice_id (viene del path param, pero defensa)
  const invoiceId = String(raw?.invoice_id ?? "").trim();
  if (!invoiceId || !UUID_RE.test(invoiceId)) {
    errors.invoice_id = "Factura inválida";
  }

  // payment_date
  const paymentDate = String(raw?.payment_date ?? "").trim();
  if (!paymentDate || !DATE_RE.test(paymentDate)) {
    errors.payment_date = "Fecha del pago inválida (esperado YYYY-MM-DD)";
  }

  // amount > 0
  const amount = Number(raw?.amount);
  if (!isFinite(amount) || amount <= 0) {
    errors.amount = "El monto debe ser mayor a 0";
  } else if (amount > 9_999_999.99) {
    errors.amount = "Monto fuera de rango";
  }

  // method (whitelist)
  const method = String(raw?.method ?? "") as PaymentMethod;
  if (!PAYMENT_METHODS.includes(method)) {
    errors.method = "Método de pago inválido";
  }

  // reference (opcional, longitud)
  let reference: string | null = null;
  if (raw?.reference != null && String(raw.reference).trim() !== "") {
    const r = String(raw.reference).trim();
    if (r.length > 200) {
      errors.reference = "Referencia muy larga (máximo 200 caracteres)";
    } else {
      reference = r;
    }
  }

  // 🔴 payment_account_code — OBLIGATORIO. El banco lo elige quien registra,
  //    sin default (Rose, 25/08). La existencia de la cuenta en el plan la
  //    verifica el servidor con un lookup; acá solo presencia y formato.
  let paymentAccountCode: string | null = null;
  const rawCta = raw?.payment_account_code;
  if (rawCta == null || String(rawCta).trim() === "") {
    errors.payment_account_code =
      "Elija la cuenta bancaria donde entró el cobro.";
  } else {
    const code = String(rawCta).trim();
    if (code.length > 20) {
      errors.payment_account_code = "Código de cuenta muy largo";
    } else {
      paymentAccountCode = code;
    }
  }

  // notes (opcional, longitud)
  let notes: string | null = null;
  if (raw?.notes != null && String(raw.notes).trim() !== "") {
    const n = String(raw.notes).trim();
    if (n.length > 1000) {
      errors.notes = "Nota muy larga (máximo 1000 caracteres)";
    } else {
      notes = n;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      invoice_id: invoiceId,
      payment_date: paymentDate,
      amount: round2(amount),
      method,
      payment_account_code: paymentAccountCode,
      reference,
      notes,
    },
  };
}

/**
 * Validador del pago a proveedor (Bloque 3). Formato y rangos; el cap por
 * saldo de la compra lo hace `createSupplierPayment` con el lookup.
 * Mismo patrón que `validators/payment.ts`.
 */

import type { CreateSupplierPaymentInput } from "@/lib/finanzas/types/supplier-payment";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/finanzas/types/payment";
import type { ValidationErrors, ValidationResult } from "@/lib/finanzas/validators/payment";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function validateCreateSupplierPayment(
  raw: Partial<CreateSupplierPaymentInput> | null | undefined
): ValidationResult<CreateSupplierPaymentInput> {
  const errors: ValidationErrors = {};

  // 🔴 Arco exclusivo (049): UNA compra o UN gasto de trámite, nunca los dos
  //    ni ninguno. Cada ruta pone el suyo desde el path; el otro llega null.
  const compraId = String(raw?.business_expense_id ?? "").trim();
  const tramiteId = String(raw?.expense_id ?? "").trim();
  if (compraId && tramiteId) {
    errors.destino = "Un pago es de una compra O de un gasto de trámite, no de los dos";
  } else if (compraId) {
    if (!UUID_RE.test(compraId)) errors.business_expense_id = "Compra inválida";
  } else if (tramiteId) {
    if (!UUID_RE.test(tramiteId)) errors.expense_id = "Gasto de trámite inválido";
  } else {
    errors.destino = "Falta el documento que se paga";
  }

  const paymentDate = String(raw?.payment_date ?? "").trim();
  if (!paymentDate || !DATE_RE.test(paymentDate)) {
    errors.payment_date = "Fecha del pago inválida (esperado YYYY-MM-DD)";
  }

  const amount = Number(raw?.amount);
  if (!isFinite(amount) || amount <= 0) {
    errors.amount = "El monto debe ser mayor a 0";
  } else if (amount > 9_999_999.99) {
    errors.amount = "Monto fuera de rango";
  }

  const method = String(raw?.method ?? "") as PaymentMethod;
  if (!PAYMENT_METHODS.includes(method)) {
    errors.method = "Método de pago inválido";
  }

  // 🔴 El banco es OBLIGATORIO: es lo que el asiento acredita y no se puede
  //    deducir. Lo elige quien registra, sin default (Rose, 25/08).
  let paymentAccountCode: string | null = null;
  const rawCta = raw?.payment_account_code;
  if (rawCta == null || String(rawCta).trim() === "") {
    errors.payment_account_code = "Elija la cuenta bancaria de donde salió el pago.";
  } else {
    const code = String(rawCta).trim();
    if (code.length > 20) errors.payment_account_code = "Código de cuenta muy largo";
    else paymentAccountCode = code;
  }

  let reference: string | null = null;
  if (raw?.reference != null && String(raw.reference).trim() !== "") {
    const r = String(raw.reference).trim();
    if (r.length > 200) errors.reference = "Referencia muy larga (máximo 200 caracteres)";
    else reference = r;
  }

  let notes: string | null = null;
  if (raw?.notes != null && String(raw.notes).trim() !== "") {
    const n = String(raw.notes).trim();
    if (n.length > 1000) errors.notes = "Nota muy larga (máximo 1000 caracteres)";
    else notes = n;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }
  return {
    ok: true,
    errors: null,
    data: {
      business_expense_id: compraId || null,
      expense_id: tramiteId || null,
      payment_date: paymentDate,
      amount: round2(amount),
      method,
      payment_account_code: paymentAccountCode,
      reference,
      notes,
    },
  };
}

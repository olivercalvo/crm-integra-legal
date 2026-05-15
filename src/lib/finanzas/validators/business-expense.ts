/**
 * Validadores manuales para business_expenses — sin Zod, sin react-hook-form.
 *
 * Mismo patrón que validators/invoice.ts: cada validador devuelve
 * `{ ok: true, data } | { ok: false, errors }` con `errors` como mapa flat
 * campo → mensaje en español, listo para mostrar inline en el form.
 *
 * Notas de diseño:
 *   - tax_rate: whitelist {0, 0.07, 0.10, 0.15} para Panamá actual (el CHECK
 *     de BD acepta cualquier valor en [0,1] para future-proof).
 *   - tax_amount: aceptamos el valor que llega (sin recalcular automático)
 *     porque el form permite override manual cuando el comprobante muestra
 *     un redondeo distinto. PERO verificamos coherencia con tolerancia
 *     ±0.02 contra subtotal × tax_rate, y enforzamos el CHECK de BD:
 *     - rate=0 ⇒ amount=0
 *     - rate>0 ∧ subtotal=0 ⇒ amount=0
 *     - rate>0 ∧ subtotal>0 ⇒ amount>0
 *   - payment_date: requerido si status='pagado' a nivel UI, pero a nivel BD
 *     puede ser NULL incluso con status='pagado' (CHECK lo permite). Acá
 *     forzamos el pattern UI: si status='pagado' y no llega payment_date,
 *     auto-asignamos hoy (el caller del form pasa el default).
 */

import type {
  CreateBusinessExpenseInput,
  BusinessExpenseStatus,
  BusinessExpensePaymentMethod,
  BusinessExpenseTaxRate,
} from "@/lib/finanzas/types/business-expense";
import { VALID_TAX_RATES } from "@/lib/finanzas/types/business-expense";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES: BusinessExpenseStatus[] = ["pendiente_pago", "pagado"];
const VALID_PAYMENT_METHODS: BusinessExpensePaymentMethod[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "cheque",
  "otro",
];

/** Tolerancia (en B/.) al verificar tax_amount contra subtotal × tax_rate. */
const TAX_AMOUNT_TOLERANCE = 0.02;

/**
 * Normaliza un tax_rate a uno de los valores whitelist. Acepta cualquier
 * representación numérica de los 4 valores soportados (0, 0.07, 0.10, 0.15)
 * con tolerancia de redondeo. Devuelve null si está fuera de la whitelist.
 */
function normalizeTaxRate(raw: unknown): BusinessExpenseTaxRate | null {
  const n = Number(raw);
  if (!isFinite(n)) return null;
  for (const valid of VALID_TAX_RATES) {
    if (Math.abs(n - valid) < 0.0001) return valid;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Valida un payload de creación. */
export function validateCreateBusinessExpense(
  raw: Partial<CreateBusinessExpenseInput>
): ValidationResult<CreateBusinessExpenseInput> {
  const errors: ValidationErrors = {};

  // expense_date
  if (!raw.expense_date || !DATE_RE.test(String(raw.expense_date))) {
    errors.expense_date = "Fecha del gasto inválida (esperado YYYY-MM-DD)";
  }

  // description
  const description = String(raw.description ?? "").trim();
  if (!description) {
    errors.description = "Descripción requerida";
  } else if (description.length < 3) {
    errors.description = "Descripción muy corta (mínimo 3 caracteres)";
  } else if (description.length > 500) {
    errors.description = "Descripción muy larga (máximo 500 caracteres)";
  }

  // supplier_name (opcional, validar longitud si llega)
  let supplierName: string | null = null;
  if (raw.supplier_name != null && String(raw.supplier_name).trim() !== "") {
    const s = String(raw.supplier_name).trim();
    if (s.length > 200) {
      errors.supplier_name = "Nombre de proveedor muy largo (máximo 200 caracteres)";
    } else {
      supplierName = s;
    }
  }

  // supplier_ruc (opcional, validar longitud si llega)
  let supplierRuc: string | null = null;
  if (raw.supplier_ruc != null && String(raw.supplier_ruc).trim() !== "") {
    const s = String(raw.supplier_ruc).trim();
    if (s.length > 50) {
      errors.supplier_ruc = "RUC muy largo (máximo 50 caracteres)";
    } else {
      supplierRuc = s;
    }
  }

  // chart_account_code (opcional, validar formato si llega — la existencia
  // contra chart_of_accounts la verifica el caller server-side con DB lookup)
  let chartAccountCode: string | null = null;
  if (raw.chart_account_code != null && String(raw.chart_account_code).trim() !== "") {
    const code = String(raw.chart_account_code).trim();
    if (code.length > 20) {
      errors.chart_account_code = "Código de cuenta muy largo";
    } else {
      chartAccountCode = code;
    }
  }

  // subtotal
  const subtotal = Number(raw.subtotal);
  if (!isFinite(subtotal) || subtotal < 0) {
    errors.subtotal = "Subtotal debe ser un número >= 0";
  }

  // tax_rate (whitelist)
  const taxRate = normalizeTaxRate(raw.tax_rate);
  if (taxRate === null) {
    errors.tax_rate = "Tasa ITBMS inválida (use 0%, 7%, 10% o 15%)";
  }

  // tax_amount
  const taxAmount = Number(raw.tax_amount);
  if (!isFinite(taxAmount) || taxAmount < 0) {
    errors.tax_amount = "Monto ITBMS debe ser un número >= 0";
  }

  // Coherencia (replica el CHECK de BD para fail fast con mensaje legible)
  if (taxRate !== null && isFinite(subtotal) && subtotal >= 0 && isFinite(taxAmount) && taxAmount >= 0) {
    if (taxRate === 0 && taxAmount !== 0) {
      errors.tax_amount = "Si la tasa es 0%, el monto ITBMS debe ser 0";
    } else if (taxRate > 0 && subtotal === 0 && taxAmount !== 0) {
      errors.tax_amount = "Si el subtotal es 0, el monto ITBMS debe ser 0";
    } else if (taxRate > 0 && subtotal > 0 && taxAmount === 0) {
      errors.tax_amount = "Con subtotal e impuesto declarado, el monto ITBMS debe ser > 0";
    } else if (taxRate > 0 && subtotal > 0) {
      // Verificar coherencia con tolerancia (permite redondeos del comprobante)
      const expected = round2(subtotal * taxRate);
      if (Math.abs(taxAmount - expected) > TAX_AMOUNT_TOLERANCE) {
        errors.tax_amount = `Monto ITBMS (B/. ${taxAmount.toFixed(2)}) no coincide con subtotal × tasa (esperado ≈ B/. ${expected.toFixed(2)})`;
      }
    }
  }

  // status
  const status = raw.status as BusinessExpenseStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status)) {
    errors.status = "Estado inválido";
  }

  // payment_date — si llega, validar formato; coherencia con status
  let paymentDate: string | null = null;
  if (raw.payment_date != null && String(raw.payment_date).trim() !== "") {
    if (!DATE_RE.test(String(raw.payment_date))) {
      errors.payment_date = "Fecha de pago inválida (esperado YYYY-MM-DD)";
    } else {
      paymentDate = String(raw.payment_date);
    }
  }
  // CHECK payment_date_consistency: pendiente_pago ⇒ payment_date NULL
  if (status === "pendiente_pago" && paymentDate !== null) {
    errors.payment_date = "Una compra pendiente de pago no puede tener fecha de pago";
  }

  // payment_method (opcional)
  let paymentMethod: BusinessExpensePaymentMethod | null = null;
  if (raw.payment_method != null && String(raw.payment_method).trim() !== "") {
    const pm = raw.payment_method as BusinessExpensePaymentMethod;
    if (!VALID_PAYMENT_METHODS.includes(pm)) {
      errors.payment_method = "Método de pago inválido";
    } else {
      paymentMethod = pm;
    }
  }
  // Si está pendiente_pago, descartamos payment_method silenciosamente
  // (la UI ya lo oculta cuando status='pendiente_pago').
  if (status === "pendiente_pago") {
    paymentMethod = null;
  }

  // notes (opcional)
  let notes: string | null = null;
  if (raw.notes != null && String(raw.notes).trim() !== "") {
    const n = String(raw.notes).trim();
    if (n.length > 2000) {
      errors.notes = "Nota muy larga (máximo 2000 caracteres)";
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
      expense_date: raw.expense_date as string,
      supplier_name: supplierName,
      supplier_ruc: supplierRuc,
      chart_account_code: chartAccountCode,
      description,
      subtotal: round2(subtotal),
      tax_rate: taxRate as BusinessExpenseTaxRate,
      tax_amount: round2(taxAmount),
      status: status as BusinessExpenseStatus,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      notes,
    },
  };
}

/** Valida un payload de actualización. Igual a create. */
export function validateUpdateBusinessExpense(
  raw: Partial<CreateBusinessExpenseInput>
) {
  return validateCreateBusinessExpense(raw);
}

/** Valida un payload de markAsPaid. */
export function validateMarkAsPaid(raw: {
  payment_date?: unknown;
  payment_method?: unknown;
}): ValidationResult<{ payment_date: string; payment_method: BusinessExpensePaymentMethod | null }> {
  const errors: ValidationErrors = {};

  if (!raw.payment_date || !DATE_RE.test(String(raw.payment_date))) {
    errors.payment_date = "Fecha de pago inválida (esperado YYYY-MM-DD)";
  }

  let paymentMethod: BusinessExpensePaymentMethod | null = null;
  if (raw.payment_method != null && String(raw.payment_method).trim() !== "") {
    const pm = raw.payment_method as BusinessExpensePaymentMethod;
    if (!VALID_PAYMENT_METHODS.includes(pm)) {
      errors.payment_method = "Método de pago inválido";
    } else {
      paymentMethod = pm;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      payment_date: raw.payment_date as string,
      payment_method: paymentMethod,
    },
  };
}

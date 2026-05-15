/**
 * Tipos compartidos del módulo Finanzas — gastos del bufete.
 *
 * Convenciones:
 *   - status y payment_method en BD son strings con CHECK constraint, no enums.
 *     Acá los modelamos como union types para safety client-side.
 *   - Montos como `string | number` cuando vienen de Supabase (NUMERIC se
 *     serializa así vía REST API). Convertir a number con Number() antes de
 *     operar.
 *   - tax_rate viene de BD en formato decimal (0.0700 = 7%). El form lo
 *     muestra como porcentaje pero internamente siempre se maneja decimal.
 *
 * Diferencia con la tabla `expenses` (módulo Legal):
 *   - business_expenses = compras propias del bufete (alquiler, oficina,
 *     servicios) donde el ITBMS pagado es crédito fiscal recuperable.
 *   - expenses = adelantos al cliente (tasas, peritos, mensajería judicial)
 *     reembolsables vía facturas REI. No generan crédito fiscal.
 */

// ---------- Status / payment_method / tax_rate ----------------------------

/** Valores válidos de business_expenses.status. */
export type BusinessExpenseStatus = "pendiente_pago" | "pagado";

/** Valores válidos de business_expenses.payment_method (cuando no es NULL). */
export type BusinessExpensePaymentMethod =
  | "efectivo"
  | "transferencia"
  | "tarjeta"
  | "cheque"
  | "otro";

/**
 * Whitelist de tasas ITBMS aceptadas en Panamá (decimal). El CHECK de BD
 * acepta cualquier valor en [0, 1] para future-proof; la aplicación enforza
 * este subset.
 */
export const VALID_TAX_RATES = [0, 0.07, 0.10, 0.15] as const;
export type BusinessExpenseTaxRate = (typeof VALID_TAX_RATES)[number];

// ---------- Row shapes ----------------------------------------------------

/** Fila completa de business_expenses tal como viene del SELECT. */
export interface BusinessExpenseRow {
  id: string;
  tenant_id: string;
  expense_date: string;            // YYYY-MM-DD
  supplier_name: string | null;
  supplier_ruc: string | null;
  chart_account_code: string | null;
  description: string;
  subtotal: string | number;       // NUMERIC(12,2) → string vía REST
  tax_rate: string | number;       // NUMERIC(5,4)
  tax_amount: string | number;
  total: string | number;          // GENERATED ALWAYS AS (subtotal + tax_amount)
  status: BusinessExpenseStatus;
  payment_date: string | null;
  payment_method: BusinessExpensePaymentMethod | null;
  receipt_url: string | null;
  receipt_filename: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Snapshot mínimo de la cuenta contable para joins. */
export interface ChartAccountSnapshot {
  code: string;
  name: string;
}

/** Item del listado con join al chart_of_accounts para mostrar el nombre. */
export interface BusinessExpenseListItem extends BusinessExpenseRow {
  account: ChartAccountSnapshot | null;
}

/** Detalle completo. Hoy igual al list item; se separa por extensibilidad. */
export interface BusinessExpenseWithDetails extends BusinessExpenseListItem {
  /** Nombre completo del usuario que registró el gasto (denormalizado). */
  created_by_name: string | null;
}

// ---------- Input shapes --------------------------------------------------

/** Payload de creación. */
export interface CreateBusinessExpenseInput {
  expense_date: string;            // YYYY-MM-DD
  supplier_name: string | null;
  supplier_ruc: string | null;
  chart_account_code: string | null;
  description: string;
  subtotal: number;
  tax_rate: number;                // decimal (0.07 = 7%)
  tax_amount: number;
  status: BusinessExpenseStatus;
  payment_date: string | null;
  payment_method: BusinessExpensePaymentMethod | null;
  notes: string | null;
}

/** Payload de actualización. Mismos campos que create. */
export type UpdateBusinessExpenseInput = CreateBusinessExpenseInput;

/** Payload para markAsPaid (atajo de status). */
export interface MarkAsPaidInput {
  payment_date: string;            // YYYY-MM-DD, requerido
  payment_method: BusinessExpensePaymentMethod | null;
}

// ---------- UI labels -----------------------------------------------------

export const BUSINESS_EXPENSE_STATUS_LABEL: Record<BusinessExpenseStatus, string> = {
  pendiente_pago: "Pendiente de pago",
  pagado: "Pagado",
};

export const BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL: Record<BusinessExpensePaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cheque: "Cheque",
  otro: "Otro",
};

export const TAX_RATE_LABEL: Record<string, string> = {
  "0": "Exento (0%)",
  "0.07": "7%",
  "0.1": "10%",
  "0.15": "15%",
};

/** Convierte un tax_rate decimal a su label legible. */
export function taxRateLabel(rate: number): string {
  // Normalizamos a string sin ceros finales (0.10 → "0.1") para matchear keys.
  const key = String(Number(rate));
  return TAX_RATE_LABEL[key] ?? `${(rate * 100).toFixed(2)}%`;
}

// ---------- Helpers de cálculo --------------------------------------------

/**
 * Calcula tax_amount esperado dado subtotal + rate. Redondeo a 2 decimales
 * como hace NUMERIC(12,2). Usado por el form para auto-fill y por el
 * validator para verificar coherencia con tolerancia.
 */
export function computeExpectedTaxAmount(subtotal: number, taxRate: number): number {
  const raw = subtotal * taxRate;
  return Math.round(raw * 100) / 100;
}

/** Calcula el total esperado. La BD lo calcula también vía GENERATED. */
export function computeTotal(subtotal: number, taxAmount: number): number {
  return Math.round((subtotal + taxAmount) * 100) / 100;
}

/**
 * Helper de cálculo del VAT Summary (ITBMS) para el módulo Reportes Contador.
 *
 * Las 10 líneas estándar replican la estructura de QuickBooks Online:
 *   1. Total sales in period, before tax
 *   2. Total taxable sales
 *   3. Tax collected on sales
 *   4. Total purchases in period
 *   5. Total taxable purchases
 *   6. Tax reclaimable on purchases
 *   7. BALANCE OWING FOR PERIOD = (3) - (6)
 *   8. Tax due from previous periods (0 en MVP — TODO saldo VAT Control)
 *   9. Tax payments made this period
 *  10. TOTAL AMOUNT DUE = (7) + (8) - (9)
 *
 * Convenciones (D1-D5, ver Sprint 2F):
 *   - Devengado por issue_date (no por fecha de pago).
 *   - Anuladas: positivo en mes de emisión, negativo en mes de anulación
 *     (cancelled_at). Mes histórico nunca se modifica retroactivamente.
 *   - Tax rate se respeta por línea — usamos los totales pre-calculados en
 *     invoices.subtotal_total y invoices.tax_total.
 *   - Status excluidos del cómputo positivo: 'borrador', 'cancelada_pre_emision'.
 *   - Status 'anulada' SÍ se incluye en el cómputo positivo del mes de
 *     emisión (la anulación se contabiliza aparte como ajuste).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VatSummaryInput {
  tenantId: string;
  /** YYYY-MM */
  month: string;
}

export interface VatSummaryLine {
  /** 1-10 */
  number: number;
  /** Etiqueta en español/inglés mostrada en el reporte. */
  label: string;
  /** Valor en B/. (USD/PAB). Puede ser negativo en líneas 7 / 10. */
  value: number;
  /** true para líneas 7 y 10 (totales destacados). */
  is_total?: boolean;
  /** Hint para detalle UI: a qué sub-cálculo refiere. */
  hint?: string;
}

export interface InvoiceDetailRow {
  id: string;
  invoice_number: string;
  invoice_kind: string;
  issue_date: string;
  client_name: string | null;
  client_number: string | null;
  subtotal_total: number;
  tax_total: number;
  grand_total: number;
  status: string;
  /** true = es una entrada de ajuste negativo por anulación en el mes consultado. */
  is_cancellation_adjustment: boolean;
  /** Solo presente si is_cancellation_adjustment = true. */
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
}

export interface BusinessExpenseDetailRow {
  id: string;
  expense_date: string;
  supplier_name: string | null;
  description: string;
  account_code: string | null;
  account_name: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  status: string;
}

export interface TaxPaymentDetailRow {
  id: string;
  payment_date: string;
  amount: number;
  period_covered_from: string;
  period_covered_to: string;
  reference_number: string | null;
  notes: string | null;
}

export interface VatSummaryDetail {
  /** Facturas del mes (positivas por issue_date + ajustes negativos por anulación). */
  invoices: InvoiceDetailRow[];
  /** Compras del bufete con ITBMS recuperable (línea 6). */
  business_expenses: BusinessExpenseDetailRow[];
  /** Pagos a DGI del período (línea 9). */
  tax_payments: TaxPaymentDetailRow[];
}

export interface VatSummaryResult {
  period: {
    /** YYYY-MM */
    month: string;
    /** YYYY-MM-DD primero del mes. */
    from: string;
    /** YYYY-MM-DD último del mes. */
    to: string;
    /** Ej. "Abril 2026" (en español). */
    label: string;
  };
  lines: VatSummaryLine[];
  detail: VatSummaryDetail;
  /** ISO timestamp UTC del momento de cálculo. */
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers de fecha
// ---------------------------------------------------------------------------

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Valida formato YYYY-MM y devuelve [year, month] (1-indexed). */
function parseMonth(month: string): { year: number; monthIdx: number } {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    throw new Error(`Formato de mes inválido: ${month} (esperado YYYY-MM)`);
  }
  const year = parseInt(m[1], 10);
  const monthIdx = parseInt(m[2], 10);
  if (monthIdx < 1 || monthIdx > 12) {
    throw new Error(`Mes fuera de rango: ${month}`);
  }
  return { year, monthIdx };
}

/** YYYY-MM-DD del primer día del mes. */
function monthStart(month: string): string {
  return `${month}-01`;
}

/** YYYY-MM-DD del último día del mes (inclusive). */
function monthEnd(month: string): string {
  const { year, monthIdx } = parseMonth(month);
  // new Date(year, monthIdx, 0) devuelve el último día del mes anterior +1,
  // que en JS Date (0-indexed months) equivale al último día del mes pedido.
  const lastDay = new Date(year, monthIdx, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** "Abril 2026" */
function monthLabelEs(month: string): string {
  const { year, monthIdx } = parseMonth(month);
  return `${MONTHS_ES[monthIdx - 1]} ${year}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// getVatSummary
// ---------------------------------------------------------------------------

/**
 * Calcula el VAT Summary para un tenant y un mes. Devuelve las 10 líneas
 * canónicas + el detalle (facturas, gastos con ITBMS, pagos al DGI).
 *
 * Lanza si el formato de month es inválido.
 */
export async function getVatSummary(
  db: DB,
  input: VatSummaryInput
): Promise<VatSummaryResult> {
  const { tenantId, month } = input;
  const from = monthStart(month);
  const to = monthEnd(month);

  // 1) Facturas EMITIDAS en el mes (positivo).
  //    Excluimos solo 'borrador' y 'cancelada_pre_emision'. Las anuladas SÍ
  //    cuentan positivo en su mes de emisión (la anulación se ajusta aparte).
  const positivePromise = db
    .from("invoices")
    .select(
      `id, invoice_number, invoice_kind, issue_date,
       subtotal_total, tax_total, grand_total, status,
       client:clients!invoices_client_id_fkey(name, client_number)`
    )
    .eq("tenant_id", tenantId)
    .gte("issue_date", from)
    .lte("issue_date", to)
    .not("status", "in", '("borrador","cancelada_pre_emision")')
    .order("issue_date", { ascending: true })
    .order("invoice_number", { ascending: true });

  // 2) Facturas ANULADAS en el mes (negativo — ajuste tipo nota crédito).
  //    Filtro por cancelled_at, sin importar issue_date. Esto incluye
  //    facturas emitidas en meses anteriores y anuladas ahora.
  const cancellationPromise = db
    .from("invoices")
    .select(
      `id, invoice_number, invoice_kind, issue_date,
       subtotal_total, tax_total, grand_total, status,
       cancelled_at, cancellation_reason,
       client:clients!invoices_client_id_fkey(name, client_number)`
    )
    .eq("tenant_id", tenantId)
    .eq("status", "anulada")
    .gte("cancelled_at", `${from}T00:00:00Z`)
    .lte("cancelled_at", `${to}T23:59:59.999Z`)
    .order("cancelled_at", { ascending: true });

  // 3) Compras del bufete (line 4/5/6).
  const expensesPromise = db
    .from("business_expenses")
    .select(
      `id, expense_date, supplier_name, description, chart_account_code,
       subtotal, tax_rate, tax_amount, total, status`
    )
    .eq("tenant_id", tenantId)
    .gte("expense_date", from)
    .lte("expense_date", to)
    .order("expense_date", { ascending: true });

  // 4) Pagos al DGI del período (line 9).
  const paymentsPromise = db
    .from("tax_payments")
    .select(
      `id, payment_date, amount, period_covered_from, period_covered_to,
       reference_number, notes`
    )
    .eq("tenant_id", tenantId)
    .gte("payment_date", from)
    .lte("payment_date", to)
    .order("payment_date", { ascending: true });

  const [posRes, cancRes, expRes, payRes] = await Promise.all([
    positivePromise,
    cancellationPromise,
    expensesPromise,
    paymentsPromise,
  ]);

  if (posRes.error) {
    console.error("[finanzas/reports] vat-summary: error invoices+", posRes.error);
  }
  if (cancRes.error) {
    console.error("[finanzas/reports] vat-summary: error invoices anuladas", cancRes.error);
  }
  if (expRes.error) {
    console.error("[finanzas/reports] vat-summary: error business_expenses", expRes.error);
  }
  if (payRes.error) {
    console.error("[finanzas/reports] vat-summary: error tax_payments", payRes.error);
  }

  const positiveInvoices = (posRes.data ?? []) as unknown as Array<{
    id: string;
    invoice_number: string;
    invoice_kind: string;
    issue_date: string;
    subtotal_total: string | number;
    tax_total: string | number;
    grand_total: string | number;
    status: string;
    client: { name: string; client_number: string } | null;
  }>;

  const cancelledInvoices = (cancRes.data ?? []) as unknown as Array<{
    id: string;
    invoice_number: string;
    invoice_kind: string;
    issue_date: string;
    subtotal_total: string | number;
    tax_total: string | number;
    grand_total: string | number;
    status: string;
    cancelled_at: string;
    cancellation_reason: string | null;
    client: { name: string; client_number: string } | null;
  }>;

  const expenses = (expRes.data ?? []) as unknown as Array<{
    id: string;
    expense_date: string;
    supplier_name: string | null;
    description: string;
    chart_account_code: string | null;
    subtotal: string | number;
    tax_rate: string | number;
    tax_amount: string | number;
    total: string | number;
    status: string;
  }>;

  const payments = (payRes.data ?? []) as unknown as Array<{
    id: string;
    payment_date: string;
    amount: string | number;
    period_covered_from: string;
    period_covered_to: string;
    reference_number: string | null;
    notes: string | null;
  }>;

  // ── Hidratar account name (FK lógica, lookup separado) ─────────────────
  const accountCodes = Array.from(
    new Set(
      expenses
        .map((e) => e.chart_account_code)
        .filter((c): c is string => !!c)
    )
  );
  const accountMap: Record<string, string> = {};
  if (accountCodes.length > 0) {
    const { data: accs } = await db
      .from("chart_of_accounts")
      .select("code, name")
      .eq("tenant_id", tenantId)
      .in("code", accountCodes);
    for (const a of accs ?? []) {
      accountMap[a.code as string] = a.name as string;
    }
  }

  // ── Sumatorias positivas (facturas emitidas en el mes) ─────────────────
  let salesSubtotalPos = 0;
  let taxableSalesPos = 0;
  let taxCollectedPos = 0;
  for (const inv of positiveInvoices) {
    const sub = Number(inv.subtotal_total);
    const tax = Number(inv.tax_total);
    salesSubtotalPos += sub;
    taxCollectedPos += tax;
    if (tax > 0) {
      taxableSalesPos += sub;
    }
  }

  // ── Sumatorias negativas (anulaciones en el mes) ───────────────────────
  let salesSubtotalNeg = 0;
  let taxableSalesNeg = 0;
  let taxCollectedNeg = 0;
  for (const inv of cancelledInvoices) {
    const sub = Number(inv.subtotal_total);
    const tax = Number(inv.tax_total);
    salesSubtotalNeg += sub;
    taxCollectedNeg += tax;
    if (tax > 0) {
      taxableSalesNeg += sub;
    }
  }

  // ── Sumatorias de compras ──────────────────────────────────────────────
  let purchasesSubtotal = 0;
  let taxablePurchasesSubtotal = 0;
  let taxReclaimable = 0;
  for (const ex of expenses) {
    const sub = Number(ex.subtotal);
    const tax = Number(ex.tax_amount);
    purchasesSubtotal += sub;
    taxReclaimable += tax;
    if (tax > 0) {
      taxablePurchasesSubtotal += sub;
    }
  }

  // ── Sumatoria de pagos al DGI ──────────────────────────────────────────
  let taxPaymentsTotal = 0;
  for (const p of payments) {
    taxPaymentsTotal += Number(p.amount);
  }

  // ── Construcción de las 10 líneas ──────────────────────────────────────
  const line1 = round2(salesSubtotalPos - salesSubtotalNeg);
  const line2 = round2(taxableSalesPos - taxableSalesNeg);
  const line3 = round2(taxCollectedPos - taxCollectedNeg);
  const line4 = round2(purchasesSubtotal);
  const line5 = round2(taxablePurchasesSubtotal);
  const line6 = round2(taxReclaimable);
  const line7 = round2(line3 - line6);
  const line8 = 0; // TODO: saldo acumulado VAT Control de períodos anteriores.
  const line9 = round2(taxPaymentsTotal);
  const line10 = round2(line7 + line8 - line9);

  const lines: VatSummaryLine[] = [
    { number: 1, label: "Total ventas del período (antes de impuesto)", value: line1, hint: "Suma de subtotales de facturas emitidas en el mes (menos ajustes por anulación)" },
    { number: 2, label: "Ventas gravadas con ITBMS", value: line2, hint: "Solo las facturas con ITBMS > 0" },
    { number: 3, label: "ITBMS cobrado sobre ventas", value: line3, hint: "Débito fiscal del período" },
    { number: 4, label: "Total compras del período", value: line4, hint: "Compras del bufete a proveedores" },
    { number: 5, label: "Compras gravadas con ITBMS", value: line5, hint: "Solo las compras con ITBMS > 0" },
    { number: 6, label: "ITBMS recuperable sobre compras", value: line6, hint: "Crédito fiscal del período" },
    { number: 7, label: "Saldo del período (débito − crédito)", value: line7, is_total: true, hint: "Línea 3 − Línea 6" },
    { number: 8, label: "ITBMS adeudado de períodos anteriores", value: line8, hint: "Saldo acumulado VAT Control (pendiente sprint futuro — hoy 0)" },
    { number: 9, label: "Pagos a DGI realizados este período", value: line9, hint: "Suma de tax_payments con payment_date en el mes" },
    { number: 10, label: "TOTAL A PAGAR / (CRÉDITO A FAVOR)", value: line10, is_total: true, hint: "Línea 7 + Línea 8 − Línea 9. Valor negativo = saldo a favor del bufete." },
  ];

  // ── Detalle: facturas (positivas + negativas como ajuste) ─────────────
  const invoiceDetail: InvoiceDetailRow[] = [];
  for (const inv of positiveInvoices) {
    invoiceDetail.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_kind: inv.invoice_kind,
      issue_date: inv.issue_date,
      client_name: inv.client?.name ?? null,
      client_number: inv.client?.client_number ?? null,
      subtotal_total: Number(inv.subtotal_total),
      tax_total: Number(inv.tax_total),
      grand_total: Number(inv.grand_total),
      status: inv.status,
      is_cancellation_adjustment: false,
    });
  }
  for (const inv of cancelledInvoices) {
    invoiceDetail.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_kind: inv.invoice_kind,
      issue_date: inv.issue_date,
      client_name: inv.client?.name ?? null,
      client_number: inv.client?.client_number ?? null,
      subtotal_total: -Number(inv.subtotal_total),  // signo negativo
      tax_total: -Number(inv.tax_total),
      grand_total: -Number(inv.grand_total),
      status: inv.status,
      is_cancellation_adjustment: true,
      cancelled_at: inv.cancelled_at,
      cancellation_reason: inv.cancellation_reason,
    });
  }

  const expenseDetail: BusinessExpenseDetailRow[] = expenses.map((e) => ({
    id: e.id,
    expense_date: e.expense_date,
    supplier_name: e.supplier_name,
    description: e.description,
    account_code: e.chart_account_code,
    account_name: e.chart_account_code
      ? (accountMap[e.chart_account_code] ?? null)
      : null,
    subtotal: Number(e.subtotal),
    tax_rate: Number(e.tax_rate),
    tax_amount: Number(e.tax_amount),
    total: Number(e.total),
    status: e.status,
  }));

  const paymentDetail: TaxPaymentDetailRow[] = payments.map((p) => ({
    id: p.id,
    payment_date: p.payment_date,
    amount: Number(p.amount),
    period_covered_from: p.period_covered_from,
    period_covered_to: p.period_covered_to,
    reference_number: p.reference_number,
    notes: p.notes,
  }));

  return {
    period: {
      month,
      from,
      to,
      label: monthLabelEs(month),
    },
    lines,
    detail: {
      invoices: invoiceDetail,
      business_expenses: expenseDetail,
      tax_payments: paymentDetail,
    },
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers públicos para la UI (default de mes, validación)
// ---------------------------------------------------------------------------

/** Devuelve YYYY-MM del mes anterior al actual. */
export function previousMonthIso(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed; restar 1 da el anterior
  // Mes anterior:
  const prevYear = m === 0 ? y - 1 : y;
  const prevMonth = m === 0 ? 12 : m;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/** Valida que el mes esté en formato YYYY-MM y no sea futuro. */
export function isValidMonthParam(month: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const [yStr, mStr] = month.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (m < 1 || m > 12) return false;
  // Bloquear meses futuros (criterio: estricto > mes actual)
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth() + 1;
  if (y > ny || (y === ny && m > nm)) return false;
  return true;
}

/** "Abril 2026" para usar en la UI sin recalcular. */
export function monthLabel(month: string): string {
  return monthLabelEs(month);
}

/** Navegación entre meses: devuelve YYYY-MM del mes anterior al dado. */
export function monthBefore(month: string): string {
  const { year, monthIdx } = parseMonth(month);
  const prevYear = monthIdx === 1 ? year - 1 : year;
  const prevMonthIdx = monthIdx === 1 ? 12 : monthIdx - 1;
  return `${prevYear}-${String(prevMonthIdx).padStart(2, "0")}`;
}

/** Navegación entre meses: devuelve YYYY-MM del mes siguiente al dado. */
export function monthAfter(month: string): string {
  const { year, monthIdx } = parseMonth(month);
  const nextYear = monthIdx === 12 ? year + 1 : year;
  const nextMonthIdx = monthIdx === 12 ? 1 : monthIdx + 1;
  return `${nextYear}-${String(nextMonthIdx).padStart(2, "0")}`;
}

/**
 * Queries server-side para gastos del bufete (business_expenses).
 * Patrón: admin client (bypass RLS) + filtro manual por tenant_id. Invocado
 * desde server components y route handlers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessExpenseListItem,
  BusinessExpenseStatus,
  BusinessExpenseWithDetails,
} from "@/lib/finanzas/types/business-expense";

type DB = SupabaseClient;

/** Opción del select de cuenta contable (filtrado a account_type='expense'). */
export interface ExpenseAccountOption {
  code: string;
  name: string;
}

interface ListBusinessExpensesParams {
  status?: BusinessExpenseStatus | null;
  /** Filtro por chart_account_code exacto. */
  accountCode?: string | null;
  /** Filtro por rango de expense_date (inclusivo). */
  fromDate?: string | null;
  toDate?: string | null;
  /** true → solo con ITBMS > 0; false → solo exentos; null → todos. */
  hasItbms?: boolean | null;
  /** Búsqueda libre contra description/supplier_name (ilike). */
  search?: string | null;
  page?: number;
  pageSize?: number;
}

export interface ListBusinessExpensesResult {
  rows: BusinessExpenseListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * Lista paginada de gastos del bufete con join al chart_of_accounts.
 * Ordenada por expense_date DESC por default (la consulta más frecuente
 * de la UI).
 */
export async function listBusinessExpenses(
  db: DB,
  tenantId: string,
  params: ListBusinessExpensesParams = {}
): Promise<ListBusinessExpensesResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = db
    .from("business_expenses")
    .select(
      `
        id, tenant_id, expense_date, supplier_name, supplier_ruc,
        chart_account_code, description,
        subtotal, tax_rate, tax_amount, total,
        status, payment_date, payment_method,
        receipt_url, receipt_filename, notes,
        created_by, created_at, updated_at
      `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.status) q = q.eq("status", params.status);
  if (params.accountCode) q = q.eq("chart_account_code", params.accountCode);
  if (params.fromDate) q = q.gte("expense_date", params.fromDate);
  if (params.toDate) q = q.lte("expense_date", params.toDate);
  if (params.hasItbms === true) q = q.gt("tax_amount", 0);
  if (params.hasItbms === false) q = q.eq("tax_amount", 0);
  if (params.search?.trim()) {
    const term = params.search.trim();
    // Búsqueda en description O supplier_name (campos free-text)
    q = q.or(
      `description.ilike.%${term}%,supplier_name.ilike.%${term}%`
    );
  }

  const { data, count, error } = await q;
  if (error) {
    console.error("[finanzas/queries] listBusinessExpenses failed", error);
    return { rows: [], total: 0, page, pageSize, totalPages: 1 };
  }

  // Hidratamos los account names en una sola query separada para evitar
  // el join de Supabase que requiere FK declarada (no la tenemos por D — la FK
  // es lógica). Es un single round-trip extra y mucho más legible.
  const codes = Array.from(
    new Set(
      (data ?? [])
        .map((r) => r.chart_account_code as string | null)
        .filter((c): c is string => !!c)
    )
  );

  let accountMap: Record<string, string> = {};
  if (codes.length > 0) {
    const { data: accs } = await db
      .from("chart_of_accounts")
      .select("code, name")
      .eq("tenant_id", tenantId)
      .in("code", codes);
    for (const a of accs ?? []) {
      accountMap[a.code as string] = a.name as string;
    }
  }

  const rows: BusinessExpenseListItem[] = (data ?? []).map((r) => ({
    ...(r as unknown as BusinessExpenseListItem),
    account: r.chart_account_code
      ? { code: r.chart_account_code as string, name: accountMap[r.chart_account_code as string] ?? r.chart_account_code as string }
      : null,
  }));

  return {
    rows,
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

/**
 * Detalle completo. Devuelve null si no existe o está fuera del tenant.
 */
export async function getBusinessExpenseById(
  db: DB,
  tenantId: string,
  id: string
): Promise<BusinessExpenseWithDetails | null> {
  const { data, error } = await db
    .from("business_expenses")
    .select(
      `
        id, tenant_id, expense_date, supplier_name, supplier_ruc,
        chart_account_code, description,
        subtotal, tax_rate, tax_amount, total,
        status, payment_date, payment_method,
        receipt_url, receipt_filename, notes,
        created_by, created_at, updated_at
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[finanzas/queries] getBusinessExpenseById failed", error);
    return null;
  }

  // Account name (lookup independiente, FK lógica)
  let account: { code: string; name: string } | null = null;
  if (data.chart_account_code) {
    const { data: acc } = await db
      .from("chart_of_accounts")
      .select("code, name")
      .eq("tenant_id", tenantId)
      .eq("code", data.chart_account_code)
      .maybeSingle();
    account = acc
      ? { code: acc.code as string, name: acc.name as string }
      : { code: data.chart_account_code as string, name: data.chart_account_code as string };
  }

  // Creator name
  let createdByName: string | null = null;
  if (data.created_by) {
    const { data: u } = await db
      .from("users")
      .select("full_name")
      .eq("id", data.created_by)
      .maybeSingle();
    createdByName = (u?.full_name as string | undefined) ?? null;
  }

  return {
    ...(data as unknown as BusinessExpenseWithDetails),
    account,
    created_by_name: createdByName,
  };
}

/**
 * Cuentas de gasto disponibles para clasificar un business_expense.
 * Filtramos a `account_type='expense'` para que el select del form solo
 * muestre cuentas relevantes (no activos, no pasivos, no ingresos).
 */
export async function listExpenseAccountOptions(
  db: DB,
  tenantId: string
): Promise<ExpenseAccountOption[]> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, name")
    .eq("tenant_id", tenantId)
    .eq("account_type", "expense")
    .order("code");

  if (error) {
    console.error("[finanzas/queries] listExpenseAccountOptions failed", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    code: r.code as string,
    name: r.name as string,
  }));
}

/**
 * Verifica que un chart_account_code exista para el tenant y sea de tipo
 * expense. Usado por los validators server-side antes de INSERT/UPDATE.
 * Devuelve true si es válido O si el code es null (cuenta no clasificada).
 */
export async function isValidExpenseAccountCode(
  db: DB,
  tenantId: string,
  code: string | null
): Promise<boolean> {
  if (code === null) return true;
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .eq("account_type", "expense")
    .maybeSingle();
  if (error) {
    console.error("[finanzas/queries] isValidExpenseAccountCode failed", error);
    return false;
  }
  return !!data;
}

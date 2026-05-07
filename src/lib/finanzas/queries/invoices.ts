/**
 * Queries server-side para facturas. Patrón: admin client (bypass RLS) +
 * filtro manual por tenant_id. Invocado desde server components y route
 * handlers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InvoiceListItem,
  InvoiceWithRelations,
  InvoiceKind,
  InvoiceStatus,
} from "@/lib/finanzas/types/invoice";

type DB = SupabaseClient;

interface ListInvoicesParams {
  status?: InvoiceStatus | null;
  client_id?: string | null;
  case_id?: string | null;
  kind?: InvoiceKind | null;
  /** Búsqueda por invoice_number (parcial, ilike). */
  search?: string | null;
  page?: number;
  pageSize?: number;
}

interface ListInvoicesResult {
  rows: InvoiceListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Lista paginada de facturas con joins de cliente y caso. Ordenado por
 * fecha de emisión descendente (las más recientes primero).
 */
export async function listInvoices(
  db: DB,
  tenantId: string,
  params: ListInvoicesParams = {}
): Promise<ListInvoicesResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = db
    .from("invoices")
    .select(
      `
        id, invoice_number, invoice_kind, client_id, case_id, quote_id,
        issue_date, due_date, status, currency,
        subtotal_total, tax_total, grand_total, amount_paid, balance_due,
        notes, created_at, updated_at,
        dgi_numero_documento, dgi_cufe, dgi_fecha_autorizacion, dgi_cafe_url,
        client:clients!invoices_client_id_fkey(id, name, client_number),
        case:cases!invoices_case_id_fkey(id, case_code)
      `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order("issue_date", { ascending: false })
    .order("invoice_number", { ascending: false })
    .range(from, to);

  if (params.status) q = q.eq("status", params.status);
  if (params.kind) q = q.eq("invoice_kind", params.kind);
  if (params.client_id) q = q.eq("client_id", params.client_id);
  if (params.case_id) q = q.eq("case_id", params.case_id);
  if (params.search?.trim()) {
    q = q.ilike("invoice_number", `%${params.search.trim()}%`);
  }

  const { data, count, error } = await q;
  if (error) {
    console.error("[finanzas/queries] listInvoices failed", error);
    return { rows: [], total: 0, page, pageSize, totalPages: 1 };
  }

  return {
    rows: (data ?? []) as unknown as InvoiceListItem[],
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

/**
 * Detalle completo de factura con líneas + cliente + caso.
 * Devuelve null si no existe o está fuera del tenant.
 */
export async function getInvoiceById(
  db: DB,
  tenantId: string,
  id: string
): Promise<InvoiceWithRelations | null> {
  const { data: header, error: errHeader } = await db
    .from("invoices")
    .select(
      `
        id, invoice_number, invoice_kind, client_id, case_id, quote_id,
        issue_date, due_date, status, currency,
        subtotal_total, tax_total, grand_total, amount_paid, balance_due,
        notes, created_at, updated_at,
        dgi_numero_documento, dgi_cufe, dgi_fecha_autorizacion, dgi_cafe_url,
        client:clients!invoices_client_id_fkey(id, name, client_number, ruc),
        case:cases!invoices_case_id_fkey(id, case_code, description)
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errHeader || !header) {
    if (errHeader) console.error("[finanzas/queries] getInvoiceById failed", errHeader);
    return null;
  }

  const { data: lines, error: errLines } = await db
    .from("invoice_lines")
    .select(
      `id, invoice_id, line_order, service_id, description,
       quantity, unit_price, tax_code, tax_rate, tax_code_id,
       subtotal, tax_amount, line_total`
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", id)
    .order("line_order", { ascending: true });

  if (errLines) {
    console.error("[finanzas/queries] getInvoiceById lines failed", errLines);
  }

  return {
    ...(header as unknown as InvoiceWithRelations),
    lines: (lines ?? []) as InvoiceWithRelations["lines"],
  };
}

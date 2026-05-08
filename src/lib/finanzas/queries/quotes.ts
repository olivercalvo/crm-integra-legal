/**
 * Queries server-side para cotizaciones. Patrón consistente con
 * queries/invoices.ts: admin client (bypass RLS) + filtro manual por
 * tenant_id. Invocado desde server components y route handlers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  QuoteListItem,
  QuoteWithLines,
  QuoteFilters,
  QuoteLineRow,
} from "@/lib/finanzas/types/quote";

type DB = SupabaseClient;

const DEFAULT_PAGE_SIZE = 20;

interface ListQuotesResult {
  rows: QuoteListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Lista paginada de cotizaciones con joins de cliente y caso. Ordenado por
 * fecha de creación descendente (las más recientes primero).
 */
export async function listQuotes(
  db: DB,
  tenantId: string,
  filters: QuoteFilters = {}
): Promise<ListQuotesResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = db
    .from("quotes")
    .select(
      `
        id, tenant_id, quote_number, client_id, case_id,
        issue_date, valid_until, status, currency,
        subtotal_total, tax_total, grand_total,
        subtotal_hon, subtotal_rei, terms_and_conditions,
        notes, created_at, updated_at, created_by,
        public_token, sent_at, sent_to_email, sent_by,
        approved_at, approved_by_ip, approved_by_user_agent,
        rejected_at, rejected_by_ip, rejected_by_user_agent, rejection_reason,
        cancelled_at, cancellation_reason,
        converted_at, converted_invoice_ids, converted_by,
        client:clients!quotes_client_id_fkey(id, name, client_number, client_status),
        case:cases!quotes_case_id_fkey(id, case_code)
      `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      q = q.in("status", filters.status);
    } else {
      q = q.eq("status", filters.status);
    }
  }

  if (filters.client_id) q = q.eq("client_id", filters.client_id);
  if (filters.case_id) q = q.eq("case_id", filters.case_id);
  if (filters.search?.trim()) {
    q = q.ilike("quote_number", `%${filters.search.trim()}%`);
  }

  const { data, count, error } = await q;
  if (error) {
    console.error("[finanzas/queries] listQuotes failed", error);
    return { rows: [], total: 0, page, pageSize, totalPages: 1 };
  }

  return {
    rows: (data ?? []) as unknown as QuoteListItem[],
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

/**
 * Detalle completo de cotización con líneas + cliente + caso. Devuelve null
 * si no existe o está fuera del tenant.
 */
export async function getQuoteById(
  db: DB,
  tenantId: string,
  id: string
): Promise<QuoteWithLines | null> {
  const { data: header, error: errHeader } = await db
    .from("quotes")
    .select(
      `
        id, tenant_id, quote_number, client_id, case_id,
        issue_date, valid_until, status, currency,
        subtotal_total, tax_total, grand_total,
        subtotal_hon, subtotal_rei, terms_and_conditions,
        notes, created_at, updated_at, created_by,
        public_token, sent_at, sent_to_email, sent_by,
        approved_at, approved_by_ip, approved_by_user_agent,
        rejected_at, rejected_by_ip, rejected_by_user_agent, rejection_reason,
        cancelled_at, cancellation_reason,
        converted_at, converted_invoice_ids, converted_by,
        client:clients!quotes_client_id_fkey(id, name, client_number, client_status, client_type, ruc, email),
        case:cases!quotes_case_id_fkey(id, case_code, description)
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errHeader || !header) {
    if (errHeader) console.error("[finanzas/queries] getQuoteById failed", errHeader);
    return null;
  }

  const { data: lines, error: errLines } = await db
    .from("quote_lines")
    .select(
      `id, tenant_id, quote_id, line_order, service_id, description,
       quantity, unit_price, tax_code, tax_rate, tax_code_id,
       subtotal, tax_amount, line_total,
       created_at, updated_at, created_by, invoice_kind`
    )
    .eq("tenant_id", tenantId)
    .eq("quote_id", id)
    .order("line_order", { ascending: true });

  if (errLines) {
    console.error("[finanzas/queries] getQuoteById lines failed", errLines);
  }

  return {
    ...(header as unknown as QuoteWithLines),
    lines: (lines ?? []) as unknown as QuoteLineRow[],
  };
}

/**
 * Detalle por public_token. Usado por endpoints públicos del portal del
 * cliente (D1, D6) en Fase 2E.4. NO filtra por tenant_id porque el token
 * mismo es la credencial — pero sí filtra por status para evitar exponer
 * cotizaciones no enviadas o ya en estado terminal.
 *
 * TODO(2E.4): consumir esta función desde /api/public/cotizacion/[token].
 */
export async function getQuoteByPublicToken(
  db: DB,
  token: string
): Promise<QuoteWithLines | null> {
  // Se acepta el token solo para cotizaciones enviadas o ya decididas (la UI
  // del portal puede mostrar "Esta cotización ya fue aceptada/rechazada").
  // No exponemos borradores.
  const { data: header, error: errHeader } = await db
    .from("quotes")
    .select(
      `
        id, tenant_id, quote_number, client_id, case_id,
        issue_date, valid_until, status, currency,
        subtotal_total, tax_total, grand_total,
        subtotal_hon, subtotal_rei, terms_and_conditions,
        notes, created_at, updated_at, created_by,
        public_token, sent_at, sent_to_email, sent_by,
        approved_at, approved_by_ip, approved_by_user_agent,
        rejected_at, rejected_by_ip, rejected_by_user_agent, rejection_reason,
        cancelled_at, cancellation_reason,
        converted_at, converted_invoice_ids, converted_by,
        client:clients!quotes_client_id_fkey(id, name, client_number, client_status, client_type, ruc, email),
        case:cases!quotes_case_id_fkey(id, case_code, description)
      `
    )
    .eq("public_token", token)
    .in("status", ["enviada", "aceptada", "rechazada", "expirada", "convertida"])
    .maybeSingle();

  if (errHeader || !header) {
    if (errHeader) console.error("[finanzas/queries] getQuoteByPublicToken failed", errHeader);
    return null;
  }

  const headerRow = header as unknown as { id: string };

  const { data: lines } = await db
    .from("quote_lines")
    .select(
      `id, tenant_id, quote_id, line_order, service_id, description,
       quantity, unit_price, tax_code, tax_rate, tax_code_id,
       subtotal, tax_amount, line_total,
       created_at, updated_at, created_by, invoice_kind`
    )
    .eq("quote_id", headerRow.id)
    .order("line_order", { ascending: true });

  return {
    ...(header as unknown as QuoteWithLines),
    lines: (lines ?? []) as unknown as QuoteLineRow[],
  };
}

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
  /**
   * 🔴 Filtro por estado FISCAL, que es otra cosa que `status`.
   *
   * Una factura puede estar `emitida` y perfecta de nuestro lado, y rechazada
   * por la DGI. Sin este filtro, encontrar las rechazadas exige abrirlas una
   * por una — y el caso que trajo esto fue justamente una que nadie reenvió.
   */
  fe_estado?: string | null;
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
        issue_date, accounting_date, due_date, status, currency,
        subtotal_total, tax_total, grand_total, amount_paid, credited_total, balance_due,
        notes, created_at, updated_at,
        dgi_numero_documento, dgi_cufe, dgi_fecha_autorizacion, dgi_cafe_url,
        fe_estado, dgi_protocolo_autorizacion, qr_content,
        punto_facturacion, numero_documento, ef_invoice_uuid,
        cancellation_reason, cancelled_at,
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
  if (params.fe_estado) q = q.eq("fe_estado", params.fe_estado);
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
        issue_date, accounting_date, due_date, status, currency,
        subtotal_total, tax_total, grand_total, amount_paid, credited_total, balance_due,
        notes, created_at, updated_at,
        dgi_numero_documento, dgi_cufe, dgi_fecha_autorizacion, dgi_cafe_url,
        fe_estado, dgi_protocolo_autorizacion, qr_content,
        punto_facturacion, numero_documento, ef_invoice_uuid,
        cancellation_reason, cancelled_at,
        fe_motivo_pendiente, fe_motivo_pendiente_en,
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

// ---------------------------------------------------------------------------
// NOTA DE DÉBITO (077)
// ---------------------------------------------------------------------------

/** Una factura que una nota de débito puede ajustar. */
export interface FacturaAjustable {
  id: string;
  invoice_number: string;
  client_id: string;
}

/**
 * Las facturas que una nota de débito puede ajustar: emitidas (con o sin
 * cobros), que no sean otra nota de débito. Del mismo cliente lo filtra la
 * pantalla; la base lo vuelve a exigir (trigger de la 077).
 */
export async function facturasAjustables(db: DB, tenantId: string): Promise<FacturaAjustable[]> {
  const { data, error } = await db
    .from("invoices")
    .select("id, invoice_number, client_id, invoice_kind")
    .eq("tenant_id", tenantId)
    .in("status", ["emitida", "parcialmente_pagada", "pagada"])
    .order("issue_date", { ascending: false });
  if (error) {
    console.error("[finanzas/queries] facturasAjustables failed", error);
    return [];
  }
  return ((data ?? []) as { id: string; invoice_number: string; client_id: string; invoice_kind: string }[])
    .filter((f) => f.invoice_kind !== "NOTA_DEBITO")
    .map((f) => ({ id: f.id, invoice_number: f.invoice_number, client_id: f.client_id }));
}

/**
 * La factura que ajusta una nota de débito, o null. Se lee con `*` y sólo se
 * llama para una NOTA_DEBITO: así ninguna pantalla nombra la columna antes de
 * que exista la 077.
 */
export async function referenciaDeNotaDeDebito(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<{ id: string; invoice_number: string } | null> {
  const { data } = await db.from("invoices").select("*").eq("tenant_id", tenantId).eq("id", invoiceId).maybeSingle();
  const refId = (data as { referenced_invoice_id?: string | null } | null)?.referenced_invoice_id ?? null;
  if (!refId) return null;
  const { data: ref } = await db
    .from("invoices")
    .select("id, invoice_number")
    .eq("tenant_id", tenantId)
    .eq("id", refId)
    .maybeSingle();
  return ref ? { id: String(ref.id), invoice_number: String(ref.invoice_number) } : null;
}

/**
 * Las notas de débito que ajustan una factura (el lado inverso de
 * `referenciaDeNotaDeDebito`), sin borradores. Recorrido del 03/10: la factura
 * no mostraba la ND que la ajusta.
 *
 * Nombra la columna en el FILTRO: antes de la 077 esa consulta falla, y por eso
 * un error devuelve la lista vacía en vez de romper el detalle de la factura.
 */
export async function notasDeDebitoDeLaFactura(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<{ id: string; invoice_number: string | null; status: string; grand_total: number }[]> {
  const { data, error } = await db
    .from("invoices")
    .select("id, invoice_number, status, grand_total, invoice_kind")
    .eq("tenant_id", tenantId)
    .eq("referenced_invoice_id", invoiceId)
    .eq("invoice_kind", "NOTA_DEBITO")
    .neq("status", "borrador")
    .order("issue_date", { ascending: true });
  if (error) return [];
  return ((data ?? []) as { id: string; invoice_number: string | null; status: string; grand_total: number | string }[]).map(
    (n) => ({ id: n.id, invoice_number: n.invoice_number, status: n.status, grand_total: Number(n.grand_total) })
  );
}

/**
 * Helpers para cargar y normalizar los datos de una factura en las dos
 * formas que el módulo PDF necesita (Sprint 2F):
 *
 *   1. `InvoicePdfPayload` — payload canónico para el hash de contenido
 *      (cache de regeneración). Sólo lo que afecta visualmente al PDF.
 *
 *   2. `InvoiceDocumentProps` — props con todos los campos formateados que
 *      el componente React-PDF consume.
 *
 * Espejo de `quote-pdf-data.ts`, adaptado al esquema de invoices/invoice_lines.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INVOICE_KIND_LABEL,
  INVOICE_STATUS_LABEL,
  type InvoiceKind,
  type InvoiceStatus,
} from "@/lib/finanzas/types/invoice";
import type {
  InvoicePdfPayload,
  InvoicePdfClientPayload,
  InvoicePdfCasePayload,
  InvoicePdfLinePayload,
} from "@/lib/finanzas/api/invoice-pdf-hash";
import type { InvoiceDocumentProps } from "@/lib/finanzas/pdf/InvoiceDocument";

type DB = SupabaseClient;

// ---------------------------------------------------------------------------
// Shape interno crudo (lo que el SELECT trae)
// ---------------------------------------------------------------------------

interface RawClient {
  id: string;
  name: string;
  client_number: string;
  client_type: "persona_natural" | "persona_juridica" | null;
  tax_id: string | null;
  tax_id_type: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  ruc: string | null;
}

interface RawCase {
  id: string;
  case_code: string;
  description: string | null;
}

interface RawLine {
  id: string;
  line_order: number;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  tax_code: string;
  tax_rate: string | number;
  subtotal: string | number | null;
  tax_amount: string | number | null;
  line_total: string | number | null;
}

interface RawInvoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  invoice_kind: InvoiceKind;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  notes: string | null;
  subtotal_total: string | number;
  tax_total: string | number;
  grand_total: string | number;
  dgi_numero_documento: string | null;
  dgi_cufe: string | null;
  dgi_fecha_autorizacion: string | null;
  dgi_cafe_url: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  client_id: string;
  case_id: string | null;
}

export interface InvoicePdfBundle {
  invoice: RawInvoice;
  client: RawClient;
  case: RawCase | null;
  lines: RawLine[];
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Carga la factura + cliente (con tax_id/phone/address) + caso opcional +
 * líneas ordenadas. Devuelve null si no existe o no pertenece al tenant.
 *
 * Usa joins explícitos porque necesitamos campos extra del cliente (tax_id,
 * tax_id_type, phone, address) que no están en el SELECT estándar de
 * getInvoiceById.
 */
export async function fetchInvoicePdfBundle(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<InvoicePdfBundle | null> {
  const { data: header, error: errHeader } = await db
    .from("invoices")
    .select(
      `
        id, tenant_id, invoice_number, invoice_kind, status, issue_date, due_date, notes,
        subtotal_total, tax_total, grand_total,
        dgi_numero_documento, dgi_cufe, dgi_fecha_autorizacion, dgi_cafe_url,
        cancellation_reason, cancelled_at,
        client_id, case_id,
        client:clients!invoices_client_id_fkey(
          id, name, client_number, client_type,
          tax_id, tax_id_type, email, phone, address, ruc
        ),
        case:cases!invoices_case_id_fkey(id, case_code, description)
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errHeader || !header) {
    if (errHeader) {
      console.error("[finanzas/pdf] fetchInvoicePdfBundle header failed", errHeader);
    }
    return null;
  }

  const { data: lines, error: errLines } = await db
    .from("invoice_lines")
    .select(
      `id, line_order, description, quantity, unit_price, tax_code, tax_rate,
       subtotal, tax_amount, line_total`
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("line_order", { ascending: true });

  if (errLines) {
    console.error("[finanzas/pdf] fetchInvoicePdfBundle lines failed", errLines);
    return null;
  }

  const clientRaw = (header.client as unknown) as RawClient | RawClient[] | null;
  const client = Array.isArray(clientRaw) ? clientRaw[0] : clientRaw;
  if (!client) {
    console.error("[finanzas/pdf] fetchInvoicePdfBundle: client missing");
    return null;
  }

  const caseRaw = (header.case as unknown) as RawCase | RawCase[] | null;
  const kase = Array.isArray(caseRaw) ? caseRaw[0] : caseRaw;

  const invoice: RawInvoice = {
    id: header.id as string,
    tenant_id: header.tenant_id as string,
    invoice_number: header.invoice_number as string,
    invoice_kind: header.invoice_kind as InvoiceKind,
    status: header.status as InvoiceStatus,
    issue_date: header.issue_date as string,
    due_date: header.due_date as string,
    notes: (header.notes as string | null) ?? null,
    subtotal_total: header.subtotal_total as string | number,
    tax_total: header.tax_total as string | number,
    grand_total: header.grand_total as string | number,
    dgi_numero_documento: (header.dgi_numero_documento as string | null) ?? null,
    dgi_cufe: (header.dgi_cufe as string | null) ?? null,
    dgi_fecha_autorizacion: (header.dgi_fecha_autorizacion as string | null) ?? null,
    dgi_cafe_url: (header.dgi_cafe_url as string | null) ?? null,
    cancellation_reason: (header.cancellation_reason as string | null) ?? null,
    cancelled_at: (header.cancelled_at as string | null) ?? null,
    client_id: header.client_id as string,
    case_id: (header.case_id as string | null) ?? null,
  };

  return {
    invoice,
    client,
    case: kase ?? null,
    lines: (lines ?? []) as unknown as RawLine[],
  };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function s(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

/**
 * Construye el payload canónico que entra al hash. Coerciona NUMERIC strings
 * a Number y trimea strings. Excluye campos de auditoría (created_at,
 * amount_paid, balance_due) que cambian sin impactar al PDF.
 */
export function buildInvoicePdfPayload(bundle: InvoicePdfBundle): InvoicePdfPayload {
  const { invoice, client, case: kase, lines } = bundle;

  const clientPayload: InvoicePdfClientPayload = {
    name: s(client.name) ?? "",
    tax_id: s(client.tax_id) ?? s(client.ruc),
    tax_id_type: s(client.tax_id_type),
    email: s(client.email),
    phone: s(client.phone),
    client_type: client.client_type,
  };

  const casePayload: InvoicePdfCasePayload | null = kase
    ? {
        code: s(kase.case_code) ?? "",
        description: s(kase.description),
      }
    : null;

  const linesPayload: InvoicePdfLinePayload[] = lines.map((ln) => ({
    line_order: Number(ln.line_order),
    description: s(ln.description) ?? "",
    qty: n(ln.quantity),
    unit_price: n(ln.unit_price),
    tax_code: s(ln.tax_code) ?? "",
    tax_rate: n(ln.tax_rate),
  }));

  return {
    invoice_number: s(invoice.invoice_number) ?? "",
    invoice_kind: invoice.invoice_kind,
    status: invoice.status,
    client: clientPayload,
    case: casePayload,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    notes: s(invoice.notes),
    lines: linesPayload,
    totals: {
      subtotal: n(invoice.subtotal_total),
      tax_total: n(invoice.tax_total),
      total: n(invoice.grand_total),
    },
    dgi: {
      numero_documento: s(invoice.dgi_numero_documento),
      cufe: s(invoice.dgi_cufe),
      fecha_autorizacion: s(invoice.dgi_fecha_autorizacion),
      cafe_url: s(invoice.dgi_cafe_url),
    },
    cancellation: {
      reason: s(invoice.cancellation_reason),
      cancelled_at: invoice.cancelled_at,
    },
  };
}

/**
 * Construye las props que consume el componente React-PDF. Recibe el bundle
 * + datos extra del usuario que genera el PDF (para el footer de auditoría).
 *
 * Reglas de etiquetado:
 *   - El `display_number` es el invoice_number tal como está (incluye slug
 *     DRAFT-XXX si es borrador — el header del PDF lo muestra crudo).
 *   - El `status_label` mapea explícitamente borrador → "BORRADOR —
 *     documento no emitido" para que en el PDF quede claro que no es
 *     vinculante. El resto usa INVOICE_STATUS_LABEL.
 */
export function buildInvoiceDocumentProps(
  bundle: InvoicePdfBundle,
  meta: { generated_at: Date; generated_by_name: string | null }
): InvoiceDocumentProps {
  const { invoice, client, case: kase, lines } = bundle;

  const statusLabel = mapStatusLabel(invoice.status);
  const generatedAtLabel = formatDateTimeEs(meta.generated_at);

  return {
    invoice_number: invoice.invoice_number,
    display_number: invoice.invoice_number,
    invoice_kind: invoice.invoice_kind,
    kind_label: INVOICE_KIND_LABEL[invoice.invoice_kind],
    status: invoice.status,
    status_label: statusLabel,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    client: {
      name: client.name,
      client_number: client.client_number,
      tax_id: s(client.tax_id) ?? s(client.ruc),
      tax_id_type: s(client.tax_id_type),
      email: s(client.email),
      phone: s(client.phone),
      address: s(client.address),
    },
    case: kase
      ? { code: kase.case_code, description: s(kase.description) }
      : null,
    lines: lines.map((ln) => ({
      line_order: Number(ln.line_order),
      description: ln.description,
      qty: n(ln.quantity),
      unit_price: n(ln.unit_price),
      tax_code: ln.tax_code,
      tax_rate: n(ln.tax_rate),
      line_total: n(ln.line_total),
    })),
    subtotal: n(invoice.subtotal_total),
    tax_total: n(invoice.tax_total),
    grand_total: n(invoice.grand_total),
    notes: s(invoice.notes),
    dgi: {
      numero_documento: s(invoice.dgi_numero_documento),
      cufe: s(invoice.dgi_cufe),
      fecha_autorizacion: s(invoice.dgi_fecha_autorizacion),
      cafe_url: s(invoice.dgi_cafe_url),
    },
    cancellation: {
      reason: s(invoice.cancellation_reason),
      cancelled_at: invoice.cancelled_at,
    },
    generated_at_label: generatedAtLabel,
    generated_by_label: meta.generated_by_name ?? "",
  };
}

/**
 * Mapeo de status → texto legible para el badge del PDF. Tuteo neutro
 * panameño. Borrador lleva sufijo aclaratorio.
 */
function mapStatusLabel(status: InvoiceStatus): string {
  if (status === "borrador") return "Borrador — documento no emitido";
  return INVOICE_STATUS_LABEL[status] ?? status;
}

/** DD/MM/YYYY HH:mm en hora local del server. */
function formatDateTimeEs(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

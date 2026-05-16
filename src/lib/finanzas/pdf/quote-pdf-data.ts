/**
 * Helpers para cargar y normalizar los datos de una cotización en las dos
 * formas que el módulo PDF necesita (Sprint 2E.3):
 *
 *   1. `QuotePdfPayload` — payload canónico para el hash de contenido
 *      (cache de regeneración). Sólo lo que afecta visualmente al PDF.
 *
 *   2. `QuoteDocumentProps` — props con todos los campos formateados que
 *      el componente React-PDF consume.
 *
 * Reutilizable desde:
 *   - GET  /api/finanzas/quotes/[id]/pdf  (Fase B)
 *   - POST /api/finanzas/quotes/[id]/send (Fase C — generar PDF + adjuntar)
 *
 * Convenciones:
 *   - El query siempre va por admin client + filter manual por tenant_id
 *     (mismo patrón que /lib/finanzas/queries/quotes.ts).
 *   - Los montos NUMERIC vienen como string desde Supabase REST → se
 *     coercionan a Number con Number(...) antes de usar.
 *   - Los strings se trimean defensivamente para que un trailing space no
 *     invalide el cache.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUOTE_STATUS_LABEL,
  type QuoteLineKind,
  type QuoteStatus,
} from "@/lib/finanzas/types/quote";
import type {
  QuotePdfPayload,
  QuotePdfClientPayload,
  QuotePdfCasePayload,
  QuotePdfLinePayload,
} from "@/lib/finanzas/api/quote-pdf-hash";
import type { QuoteDocumentProps } from "@/lib/finanzas/pdf/QuoteDocument";

type DB = SupabaseClient;

// ---------------------------------------------------------------------------
// Shape interno crudo (lo que el SELECT trae)
// ---------------------------------------------------------------------------

interface RawClient {
  id: string;
  name: string;
  client_number: string;
  client_status: "prospect" | "active" | "inactive";
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
  invoice_kind: QuoteLineKind;
  subtotal: string | number | null;
  tax_amount: string | number | null;
  line_total: string | number | null;
}

interface RawQuote {
  id: string;
  tenant_id: string;
  quote_number: string;
  title: string;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string;
  notes: string | null;
  observations: string | null;
  terms_and_conditions: string | null;
  subtotal_hon: string | number;
  subtotal_rei: string | number;
  tax_total: string | number;
  grand_total: string | number;
  sent_by: string | null;
  client_id: string;
  case_id: string | null;
}

export interface QuotePdfBundle {
  quote: RawQuote;
  client: RawClient;
  case: RawCase | null;
  lines: RawLine[];
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Carga el quote + cliente (con tax_id/phone/address) + caso opcional + líneas
 * ordenadas. Devuelve null si no existe o no pertenece al tenant.
 *
 * Usa joins explícitos en lugar de getQuoteById porque necesitamos campos
 * extra del cliente (tax_id, tax_id_type, phone, address) que no están en
 * la query estándar.
 */
export async function fetchQuotePdfBundle(
  db: DB,
  tenantId: string,
  quoteId: string
): Promise<QuotePdfBundle | null> {
  const { data: header, error: errHeader } = await db
    .from("quotes")
    .select(
      `
        id, tenant_id, quote_number, title, status, issue_date, valid_until, notes,
        observations, terms_and_conditions, subtotal_hon, subtotal_rei, tax_total, grand_total,
        sent_by, client_id, case_id,
        client:clients!quotes_client_id_fkey(
          id, name, client_number, client_status, client_type,
          tax_id, tax_id_type, email, phone, address, ruc
        ),
        case:cases!quotes_case_id_fkey(id, case_code, description)
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errHeader || !header) {
    if (errHeader) {
      console.error("[finanzas/pdf] fetchQuotePdfBundle header failed", errHeader);
    }
    return null;
  }

  const { data: lines, error: errLines } = await db
    .from("quote_lines")
    .select(
      `id, line_order, description, quantity, unit_price, tax_code, tax_rate,
       invoice_kind, subtotal, tax_amount, line_total`
    )
    .eq("tenant_id", tenantId)
    .eq("quote_id", quoteId)
    .order("line_order", { ascending: true });

  if (errLines) {
    console.error("[finanzas/pdf] fetchQuotePdfBundle lines failed", errLines);
    return null;
  }

  // Supabase devuelve relations como objeto único (FK simple) o array.
  const clientRaw = (header.client as unknown) as RawClient | RawClient[] | null;
  const client = Array.isArray(clientRaw) ? clientRaw[0] : clientRaw;
  if (!client) {
    console.error("[finanzas/pdf] fetchQuotePdfBundle: client missing");
    return null;
  }

  const caseRaw = (header.case as unknown) as RawCase | RawCase[] | null;
  const kase = Array.isArray(caseRaw) ? caseRaw[0] : caseRaw;

  const quote: RawQuote = {
    id: header.id as string,
    tenant_id: header.tenant_id as string,
    quote_number: header.quote_number as string,
    title: (header.title as string | null) ?? "",
    status: header.status as QuoteStatus,
    issue_date: header.issue_date as string,
    valid_until: header.valid_until as string,
    notes: (header.notes as string | null) ?? null,
    observations: (header.observations as string | null) ?? null,
    terms_and_conditions: (header.terms_and_conditions as string | null) ?? null,
    subtotal_hon: header.subtotal_hon as string | number,
    subtotal_rei: header.subtotal_rei as string | number,
    tax_total: header.tax_total as string | number,
    grand_total: header.grand_total as string | number,
    sent_by: (header.sent_by as string | null) ?? null,
    client_id: header.client_id as string,
    case_id: (header.case_id as string | null) ?? null,
  };

  return {
    quote,
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
 * Construye el payload canónico que entra al hash. Mismo set de campos
 * definido en D5. Coerciona NUMERIC strings a Number y trimea strings.
 */
export function buildQuotePdfPayload(bundle: QuotePdfBundle): QuotePdfPayload {
  const { quote, client, case: kase, lines } = bundle;

  const clientPayload: QuotePdfClientPayload = {
    name: s(client.name) ?? "",
    // Preferir tax_id (Sprint 2E.1 campo fiscal canónico). Si no, usar legacy ruc.
    tax_id: s(client.tax_id) ?? s(client.ruc),
    tax_id_type: s(client.tax_id_type),
    email: s(client.email),
    phone: s(client.phone),
    client_type: client.client_type,
  };

  const casePayload: QuotePdfCasePayload | null = kase
    ? {
        code: s(kase.case_code) ?? "",
        description: s(kase.description),
      }
    : null;

  const linesPayload: QuotePdfLinePayload[] = lines.map((ln) => ({
    line_order: Number(ln.line_order),
    description: s(ln.description) ?? "",
    qty: n(ln.quantity),
    unit_price: n(ln.unit_price),
    tax_code: s(ln.tax_code) ?? "",
    tax_rate: n(ln.tax_rate),
    invoice_kind: ln.invoice_kind,
  }));

  // El "total" del hash usa grand_total (no sumamos subtotales para evitar
  // discrepancias entre la suma client-side y el cálculo del trigger T8b-quote
  // del lado BD — la única fuente confiable es grand_total).
  return {
    quote_number: s(quote.quote_number) ?? "",
    title: s(quote.title) ?? "",
    status: quote.status,
    client: clientPayload,
    case: casePayload,
    issue_date: quote.issue_date,
    valid_until: quote.valid_until,
    internal_notes: s(quote.notes),
    observations: s(quote.observations),
    terms_and_conditions: s(quote.terms_and_conditions),
    lines: linesPayload,
    totals: {
      subtotal_hon: n(quote.subtotal_hon),
      subtotal_rei: n(quote.subtotal_rei),
      total: n(quote.grand_total),
    },
  };
}

/**
 * Construye las props que consume el componente React-PDF. Recibe el bundle
 * + datos extra del usuario que genera el PDF (para el footer de auditoría).
 */
export function buildQuoteDocumentProps(
  bundle: QuotePdfBundle,
  meta: { generated_at: Date; generated_by_name: string | null }
): QuoteDocumentProps {
  const { quote, client, case: kase, lines } = bundle;

  // Label en español del status (snapshot al momento de generar el PDF).
  const statusLabel =
    QUOTE_STATUS_LABEL[quote.status as keyof typeof QUOTE_STATUS_LABEL] ??
    quote.status;

  // Fecha del footer formateada en español PA.
  const generatedAtLabel = formatDateTimeEs(meta.generated_at);

  return {
    quote_number: quote.quote_number,
    title: quote.title ?? "",
    status: quote.status,
    status_label: statusLabel,
    issue_date: quote.issue_date,
    valid_until: quote.valid_until,
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
      invoice_kind: ln.invoice_kind,
      qty: n(ln.quantity),
      unit_price: n(ln.unit_price),
      tax_code: ln.tax_code,
      tax_rate: n(ln.tax_rate),
      line_total: n(ln.line_total),
    })),
    subtotal_hon: n(quote.subtotal_hon),
    subtotal_rei: n(quote.subtotal_rei),
    tax_total: n(quote.tax_total),
    grand_total: n(quote.grand_total),
    notes: s(quote.notes),
    observations: s(quote.observations),
    terms_and_conditions: s(quote.terms_and_conditions),
    generated_at_label: generatedAtLabel,
    generated_by_label: meta.generated_by_name ?? "",
  };
}

/** DD/MM/YYYY HH:mm en hora local (server-side). */
function formatDateTimeEs(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

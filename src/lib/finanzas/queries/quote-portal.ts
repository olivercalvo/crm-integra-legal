/**
 * Queries del portal público de cotizaciones (Sprint 2E.4).
 *
 * El portal usa admin client (bypass RLS) — la "auth" es el public_token en
 * el path. La validación del token vive en el endpoint, esta función solo
 * traduce token → bundle de datos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteStatus, QuoteLineKind } from "@/lib/finanzas/types/quote";

type DB = SupabaseClient;

export interface PortalQuoteLine {
  id: string;
  line_order: number;
  invoice_kind: QuoteLineKind;
  description: string;
  quantity: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;
  subtotal: number;
  tax_amount: number;
  line_total: number;
}

export interface PortalQuoteBundle {
  id: string;
  tenant_id: string;
  quote_number: string;
  title: string;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string;
  currency: string;
  subtotal_total: number;
  tax_total: number;
  grand_total: number;
  subtotal_hon: number;
  subtotal_rei: number;
  terms_and_conditions: string | null;
  notes: string | null;
  observations: string | null;
  public_token: string | null;
  sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  client: {
    id: string;
    name: string;
    email: string | null;
  };
  lines: PortalQuoteLine[];
  case_id: string | null;
}

/**
 * Devuelve el bundle completo necesario para renderizar el portal y para
 * la cascada de aceptación. NULL si no se encuentra una cotización con
 * ese public_token.
 *
 * NOTA: incluye datos sensibles (montos, T&C, líneas) — solo invocar desde
 * el portal público una vez validado el formato del token.
 */
export async function getQuoteForPortal(
  db: DB,
  token: string
): Promise<PortalQuoteBundle | null> {
  const { data: header, error: errHeader } = await db
    .from("quotes")
    .select(
      `
        id, tenant_id, quote_number, title, status,
        issue_date, valid_until, currency,
        subtotal_total, tax_total, grand_total,
        subtotal_hon, subtotal_rei,
        terms_and_conditions, notes, observations,
        public_token, sent_at, approved_at, rejected_at,
        case_id,
        client:clients!quotes_client_id_fkey(id, name, email)
      `
    )
    .eq("public_token", token)
    .limit(1)
    .maybeSingle();

  if (errHeader) {
    console.error("[finanzas/queries] getQuoteForPortal header failed", errHeader);
    return null;
  }
  if (!header) return null;

  const clientRaw = (header as { client: unknown }).client;
  const clientObj = Array.isArray(clientRaw) ? clientRaw[0] : clientRaw;
  if (!clientObj || typeof clientObj !== "object") return null;
  const client = clientObj as { id: string; name: string; email: string | null };

  const { data: linesData, error: errLines } = await db
    .from("quote_lines")
    .select(
      `id, line_order, invoice_kind, description, quantity, unit_price,
       tax_code, tax_rate, subtotal, tax_amount, line_total`
    )
    .eq("tenant_id", header.tenant_id as string)
    .eq("quote_id", header.id as string)
    .order("line_order", { ascending: true });

  if (errLines) {
    console.error("[finanzas/queries] getQuoteForPortal lines failed", errLines);
    return null;
  }

  const lines: PortalQuoteLine[] = (linesData ?? []).map((ln) => ({
    id: ln.id as string,
    line_order: Number(ln.line_order),
    invoice_kind: ln.invoice_kind as QuoteLineKind,
    description: ln.description as string,
    quantity: Number(ln.quantity),
    unit_price: Number(ln.unit_price),
    tax_code: ln.tax_code as string,
    tax_rate: Number(ln.tax_rate),
    subtotal: Number(ln.subtotal ?? 0),
    tax_amount: Number(ln.tax_amount ?? 0),
    line_total: Number(ln.line_total ?? 0),
  }));

  return {
    id: header.id as string,
    tenant_id: header.tenant_id as string,
    quote_number: header.quote_number as string,
    title: (header.title as string | null) ?? "",
    status: header.status as QuoteStatus,
    issue_date: header.issue_date as string,
    valid_until: header.valid_until as string,
    currency: header.currency as string,
    subtotal_total: Number(header.subtotal_total),
    tax_total: Number(header.tax_total),
    grand_total: Number(header.grand_total),
    subtotal_hon: Number(header.subtotal_hon),
    subtotal_rei: Number(header.subtotal_rei),
    terms_and_conditions: header.terms_and_conditions as string | null,
    notes: header.notes as string | null,
    observations: header.observations as string | null,
    public_token: header.public_token as string | null,
    sent_at: header.sent_at as string | null,
    approved_at: header.approved_at as string | null,
    rejected_at: header.rejected_at as string | null,
    case_id: header.case_id as string | null,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
    },
    lines,
  };
}

/**
 * Devuelve "YYYY-MM-DD" para el día actual en zona Panamá. Usamos
 * `formatToParts` (no `format`) para extraer year/month/day por nombre y
 * armar el string manualmente — así esquivamos cualquier quirk del locale
 * en runtimes raros (Vercel Edge, ICU recortada, builds bundled) donde
 * `format("en-CA", ...)` podría devolver un separador distinto a `-` o
 * incluir caracteres invisibles (LRM, etc.).
 */
function todayInPanamaISO(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Determina si una cotización está vencida comparando valid_until con la
 * fecha de hoy en hora de Panamá. Si está vencida, el portal muestra la
 * UI vencida (P9) sin importar el status.
 *
 * Reglas (Sprint 2E.4 P9):
 *   - El mismo día de valid_until NO está vencida (el cliente tiene hasta
 *     el final del día Panamá para responder).
 *   - El día siguiente sí está vencida.
 *   - Aceptamos valid_until como "YYYY-MM-DD" puro (Supabase DATE) o como
 *     timestamp ISO ("YYYY-MM-DDTHH:mm:ssZ") — normalizamos al prefijo
 *     YYYY-MM-DD vía regex antes de comparar.
 *   - Comparación lexicográfica de strings ISO funciona correctamente
 *     (year-month-day es ordenable como texto).
 *
 * El parámetro `now` es opcional; por defecto usa el reloj actual. Se
 * acepta principalmente para tests unitarios deterministas.
 */
export function isQuoteExpired(
  validUntilIso: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!validUntilIso) return false;
  const m = validUntilIso.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return false;
  const validUntilDate = m[1];
  const today = todayInPanamaISO(now);
  return today > validUntilDate;
}

/**
 * Server-only: arma el `InvoiceEfacturaBundle` real desde Supabase. Es el
 * input que consume `mapInvoiceToEfacturaRequest`.
 *
 * Hace dos selects (header + joined client, luego invoice_lines) replicando
 * el patrón de `invoice-pdf-data.ts`. NO depende de tipos generados de
 * Supabase: trabajamos con `unknown` y normalizamos en la frontera.
 *
 * Validaciones que aplica (FAIL FAST con MutationError 400):
 *   - La factura existe y pertenece al tenant.
 *   - El cliente tiene los datos fiscales mínimos para emitir al PAC.
 *     Mensajes accionables en español, identificando exactamente qué falta
 *     para que la abogada complete el perfil del cliente.
 *
 * NO valida estado de la factura (`status`/`fe_estado`) — ese gate vive en
 * el orquestador para mantener el bundle reutilizable (ej. preview, NC).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceKind, InvoiceStatus } from "@/lib/finanzas/types/invoice";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import type {
  InvoiceEfacturaBundle,
  EfacturaBundleClient,
  EfacturaBundleInvoice,
  EfacturaBundleLine,
} from "./invoice-efactura-bundle";

type DB = SupabaseClient;

const HEADER_SELECT = `
  id, tenant_id, invoice_number, invoice_kind, status,
  issue_date, due_date, notes,
  subtotal_total, tax_total, grand_total,
  client_id,
  client:clients!invoices_client_id_fkey(
    id, name, client_number, client_status, client_type,
    tax_id, tax_id_type, ruc,
    email, phone, address,
    digito_verificador, tipo_receptor_fe, codigo_ubicacion,
    corregimiento, distrito, provincia,
    id_extranjero, pais_receptor
  )
`;

const LINES_SELECT = `
  line_order, description, quantity, unit_price, tax_code, tax_rate,
  subtotal, tax_amount, line_total
`;

/** Coerciona NUMERIC strings de Supabase a number. NULL/undefined → 0. */
function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

export async function fetchInvoiceEfacturaBundle(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<InvoiceEfacturaBundle> {
  // 1. Header con join al cliente.
  const { data: header, error: errHeader } = await db
    .from("invoices")
    .select(HEADER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errHeader) {
    throw new MutationError(pgErrorToMessage(errHeader), 500, errHeader);
  }
  if (!header) {
    throw new MutationError("Factura no encontrada", 404);
  }

  const clientRaw = (header as Record<string, unknown>).client;
  const clientRow = (Array.isArray(clientRaw) ? clientRaw[0] : clientRaw) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!clientRow) {
    throw new MutationError(
      "La factura no tiene cliente asociado. Esto es inesperado — contactá soporte.",
      500
    );
  }

  // 2. Validación dura del cliente (gate fiscal). FAIL FAST con mensaje
  //    accionable. Mantiene el orden en que aparece en el formulario para
  //    que la abogada los complete de arriba a abajo.
  validateClientFiscalGate(clientRow);

  // 3. Líneas.
  const { data: linesRaw, error: errLines } = await db
    .from("invoice_lines")
    .select(LINES_SELECT)
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("line_order", { ascending: true });

  if (errLines) {
    throw new MutationError(pgErrorToMessage(errLines), 500, errLines);
  }
  if (!linesRaw || linesRaw.length === 0) {
    throw new MutationError(
      "La factura no tiene líneas. Agregá al menos una antes de enviar al PAC.",
      400
    );
  }

  // 4. Normalizar al shape del bundle.
  const invoice: EfacturaBundleInvoice = {
    id: header.id as string,
    invoice_number: header.invoice_number as string,
    invoice_kind: header.invoice_kind as InvoiceKind,
    status: header.status as InvoiceStatus,
    issue_date: header.issue_date as string,
    due_date: header.due_date as string,
    notes: toStringOrNull(header.notes),
    subtotal_total: toNumber(header.subtotal_total),
    tax_total: toNumber(header.tax_total),
    grand_total: toNumber(header.grand_total),
  };

  const client: EfacturaBundleClient = {
    name: String(clientRow.name ?? ""),
    client_number: String(clientRow.client_number ?? ""),
    client_status: clientRow.client_status as EfacturaBundleClient["client_status"],
    client_type: (clientRow.client_type as EfacturaBundleClient["client_type"]) ?? null,
    tax_id: toStringOrNull(clientRow.tax_id),
    tax_id_type: (clientRow.tax_id_type as EfacturaBundleClient["tax_id_type"]) ?? null,
    ruc: toStringOrNull(clientRow.ruc),
    email: toStringOrNull(clientRow.email),
    phone: toStringOrNull(clientRow.phone),
    address: toStringOrNull(clientRow.address),
    digito_verificador: toStringOrNull(clientRow.digito_verificador),
    tipo_receptor_fe:
      (clientRow.tipo_receptor_fe as EfacturaBundleClient["tipo_receptor_fe"]) ?? null,
    codigo_ubicacion: toStringOrNull(clientRow.codigo_ubicacion),
    corregimiento: toStringOrNull(clientRow.corregimiento),
    distrito: toStringOrNull(clientRow.distrito),
    provincia: toStringOrNull(clientRow.provincia),
    id_extranjero: toStringOrNull(clientRow.id_extranjero),
    pais_receptor: toStringOrNull(clientRow.pais_receptor),
  };

  const lines: EfacturaBundleLine[] = (linesRaw as Array<Record<string, unknown>>).map(
    (ln) => ({
      line_order: Number(ln.line_order),
      description: String(ln.description ?? ""),
      quantity: toNumber(ln.quantity),
      unit_price: toNumber(ln.unit_price),
      tax_code: String(ln.tax_code ?? ""),
      tax_rate: toNumber(ln.tax_rate),
      subtotal: toNumber(ln.subtotal),
      tax_amount: toNumber(ln.tax_amount),
      line_total: toNumber(ln.line_total),
    })
  );

  return { invoice, client, lines };
}

/**
 * Valida el gate fiscal del cliente. Lanza `MutationError(400)` con mensaje
 * accionable si falta algo. Reglas:
 *   - client_status === 'active' (el gate de createInvoice ya lo enforza,
 *     pero al re-emitir conviene rechequear: el cliente puede haberse
 *     desactivado entre creación y emisión PAC).
 *   - tax_id o ruc presente (tax_id es el nuevo, ruc legacy — uno alcanza).
 *   - tipo_receptor_fe presente: requerido por el mapper para el bloque
 *     informacionReceptor del PAC.
 *   - Para tipo '04' (extranjero) el mapper exige id_extranjero +
 *     pais_receptor; los demás tipos exigen codigo_ubicacion +
 *     corregimiento + distrito + provincia.
 */
function validateClientFiscalGate(row: Record<string, unknown>): void {
  const missing: string[] = [];

  const clientStatus = row.client_status;
  if (clientStatus !== "active") {
    throw new MutationError(
      `No se puede emitir al PAC: el cliente está en estado "${String(
        clientStatus ?? "desconocido"
      )}". Activá el cliente primero.`,
      400
    );
  }

  const taxId = toStringOrNull(row.tax_id);
  const rucLegacy = toStringOrNull(row.ruc);
  if (!taxId && !rucLegacy) {
    missing.push("RUC o documento de identidad (tax_id)");
  }

  const tipoReceptor = row.tipo_receptor_fe;
  if (!tipoReceptor) {
    missing.push("tipo de receptor FE");
  }

  // Extranjero (04): id_extranjero + pais_receptor.
  // Resto (01/02/03): codigo_ubicacion + corregimiento + distrito + provincia.
  if (tipoReceptor === "04") {
    if (!toStringOrNull(row.id_extranjero)) missing.push("ID extranjero");
    if (!toStringOrNull(row.pais_receptor)) missing.push("país del receptor");
  } else if (tipoReceptor === "01" || tipoReceptor === "02" || tipoReceptor === "03") {
    if (!toStringOrNull(row.codigo_ubicacion)) missing.push("código de ubicación DGI");
    if (!toStringOrNull(row.corregimiento)) missing.push("corregimiento");
    if (!toStringOrNull(row.distrito)) missing.push("distrito");
    if (!toStringOrNull(row.provincia)) missing.push("provincia");
  }

  if (missing.length > 0) {
    throw new MutationError(
      `El cliente no tiene los datos fiscales mínimos para emitir al PAC. Falta: ${missing.join(
        ", "
      )}.`,
      400
    );
  }
}

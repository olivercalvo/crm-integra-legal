/**
 * Server-only: arma el bundle de una NOTA DE CRÉDITO para el mapper.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ES EL MISMO BUNDLE QUE UNA FACTURA, A PROPÓSITO
 * ═════════════════════════════════════════════════════════════════════════════
 * Una nota de crédito se manda por el MISMO endpoint (`POST /api/v1/Invoices`)
 * y con la MISMA forma de documento: cambia el `tipoDocumento` (`04`), las
 * líneas —sólo las acreditadas, con su cantidad— y el bloque de referencia.
 * Nada de eso justifica un segundo mapper.
 *
 * Así que esto devuelve un `InvoiceEfacturaBundle` con la NC ocupando el lugar
 * de la factura. Dos consecuencias buenas: el receptor sale del MISMO
 * `mapReceptor` congelado, y el ITBMS proporcional de una NC parcial lo calcula
 * el mismo `mapTotales` que ya funciona.
 *
 * 🔴 `invoice_kind` SE HEREDA DE LA FACTURA ORIGINAL. De ahí sale el CPBS
 * (`EFACTURA_EMISOR_CPBS_HON` / `_REI`), y una NC sobre un reembolso tiene que
 * llevar el mismo código de bien o servicio que el documento que corrige. Es un
 * dato que la NC no tiene por su cuenta y que es fácil dejar en HONORARIOS sin
 * que nada falle hasta que la DGI observa el anexo.
 *
 * 🔴 EL GATE FISCAL DEL CLIENTE SE VUELVE A CORRER. El cliente pudo cambiar (o
 * empeorar) entre la factura y la NC — es literalmente el caso del rechazo
 * `1601` que motivó SOP-041.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceKind, InvoiceStatus } from "@/lib/finanzas/types/invoice";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { validateClientFiscalGate } from "./fetch-invoice-efactura-bundle";
import type {
  InvoiceEfacturaBundle,
  EfacturaBundleClient,
  EfacturaBundleInvoice,
  EfacturaBundleLine,
} from "./invoice-efactura-bundle";

type DB = SupabaseClient;

const HEADER_SELECT = `
  id, tenant_id, credit_note_number, status, issue_date, reason, observations,
  subtotal_total, tax_total, grand_total,
  client_id, invoice_id,
  invoice:invoices!credit_notes_invoice_id_fkey(
    id, invoice_number, invoice_kind, issue_date, dgi_cufe, dgi_cufe_origen
  ),
  client:clients!credit_notes_client_id_fkey(
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

function unaFila(v: unknown): Record<string, unknown> | null {
  const r = Array.isArray(v) ? v[0] : v;
  return (r as Record<string, unknown> | null | undefined) ?? null;
}

export interface CreditNoteEfacturaBundle {
  /** Con la NC ocupando el lugar de la factura: el mapper es el mismo. */
  bundle: InvoiceEfacturaBundle;
  /** La factura que se corrige, para el bloque de referencia y los gates. */
  factura: {
    id: string;
    invoice_number: string;
    issue_date: string;
    /** `null` ⇒ caso B o C: hay que cargar el CUFE antes de emitir. */
    dgi_cufe: string | null;
    dgi_cufe_origen: string | null;
  };
  credit_note_number: string;
}

export async function fetchCreditNoteEfacturaBundle(
  db: DB,
  tenantId: string,
  creditNoteId: string
): Promise<CreditNoteEfacturaBundle> {
  const { data: header, error: errHeader } = await db
    .from("credit_notes")
    .select(HEADER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", creditNoteId)
    .maybeSingle();

  if (errHeader) {
    throw new MutationError(pgErrorToMessage(errHeader), 500, errHeader);
  }
  if (!header) {
    throw new MutationError("Nota de crédito no encontrada", 404);
  }

  const h = header as Record<string, unknown>;
  const clientRow = unaFila(h.client);
  const invoiceRow = unaFila(h.invoice);

  if (!clientRow) {
    throw new MutationError(
      "La nota de crédito no tiene cliente asociado. Esto es inesperado — comuníquese con soporte.",
      500
    );
  }
  if (!invoiceRow) {
    throw new MutationError(
      "La nota de crédito no tiene factura asociada. Esto es inesperado — comuníquese con soporte.",
      500
    );
  }

  // El cliente pudo cambiar entre la factura y la NC: se revalida.
  validateClientFiscalGate(clientRow);

  const { data: linesRaw, error: errLines } = await db
    .from("credit_note_lines")
    .select(LINES_SELECT)
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", creditNoteId)
    .order("line_order", { ascending: true });

  if (errLines) {
    throw new MutationError(pgErrorToMessage(errLines), 500, errLines);
  }
  if (!linesRaw || linesRaw.length === 0) {
    throw new MutationError(
      "La nota de crédito no tiene líneas. No hay nada que enviar a la DGI.",
      400
    );
  }

  const invoice: EfacturaBundleInvoice = {
    id: String(h.id),
    // El número interno no viaja al PAC (el correlativo fiscal es otro), pero
    // sí aparece en logs y en el payload guardado: que diga NC-xxxx y no el de
    // una factura es lo que hace legible un `fe_emisiones` de meses después.
    invoice_number: String(h.credit_note_number),
    // 🔴 Heredado. Ver el encabezado: de acá sale el CPBS.
    invoice_kind: invoiceRow.invoice_kind as InvoiceKind,
    status: "emitida" as InvoiceStatus,
    issue_date: String(h.issue_date),
    // Una NC no vence. Se repite la fecha de emisión porque el contrato pide
    // el campo, no porque signifique algo.
    due_date: String(h.issue_date),
    notes: toStringOrNull(h.observations) ?? toStringOrNull(h.reason),
    subtotal_total: toNumber(h.subtotal_total),
    tax_total: toNumber(h.tax_total),
    grand_total: toNumber(h.grand_total),
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

  const lines: EfacturaBundleLine[] = (linesRaw as Array<Record<string, unknown>>).map((ln) => ({
    line_order: Number(ln.line_order),
    description: String(ln.description ?? ""),
    quantity: toNumber(ln.quantity),
    unit_price: toNumber(ln.unit_price),
    tax_code: String(ln.tax_code ?? ""),
    tax_rate: toNumber(ln.tax_rate),
    subtotal: toNumber(ln.subtotal),
    tax_amount: toNumber(ln.tax_amount),
    line_total: toNumber(ln.line_total),
  }));

  return {
    bundle: { invoice, client, lines },
    factura: {
      id: String(invoiceRow.id),
      invoice_number: String(invoiceRow.invoice_number),
      issue_date: String(invoiceRow.issue_date),
      dgi_cufe: toStringOrNull(invoiceRow.dgi_cufe),
      dgi_cufe_origen: toStringOrNull(invoiceRow.dgi_cufe_origen),
    },
    credit_note_number: String(h.credit_note_number),
  };
}

/**
 * Lo que necesita `validarParaLaDgi` (validaciones-previas.ts), leído de la base,
 * y el motivo pendiente de cada documento (085).
 *
 * Separado del módulo puro para que la regla se pruebe sin base y el I/O quede
 * en un solo lugar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import type {
  DocumentoParaValidar,
  ReceptorParaValidar,
} from "@/lib/finanzas/efactura/validaciones-previas";

type DB = SupabaseClient;

const RECEPTOR_SELECT =
  "name, client_type, client_status, tipo_receptor_fe, tax_id_type, tax_id, ruc, digito_verificador, id_extranjero, pais_receptor";

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** La ficha fiscal del cliente, como la valida la DGI. */
export async function cargarReceptor(db: DB, tenantId: string, clientId: string): Promise<ReceptorParaValidar> {
  const { data, error } = await db.from("clients").select(RECEPTOR_SELECT).eq("tenant_id", tenantId).eq("id", clientId).maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!data) throw new MutationError("Cliente no encontrado", 404);
  const r = data as Record<string, unknown>;
  return {
    name: s(r.name),
    client_type: s(r.client_type),
    client_status: s(r.client_status),
    tipo_receptor_fe: s(r.tipo_receptor_fe),
    tax_id_type: s(r.tax_id_type),
    tax_id: s(r.tax_id),
    ruc: s(r.ruc),
    digito_verificador: s(r.digito_verificador),
    id_extranjero: s(r.id_extranjero),
    pais_receptor: s(r.pais_receptor),
  };
}

/**
 * Una factura o nota de débito, lista para validar. La ND lee la factura que
 * ajusta con `*` (la columna sólo existe desde la 077 y sólo se nombra en una ND).
 */
export async function cargarFacturaParaValidar(db: DB, tenantId: string, invoiceId: string): Promise<DocumentoParaValidar> {
  const { data: inv, error } = await db
    .from("invoices")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!inv) throw new MutationError("Factura no encontrada", 404);
  const f = inv as Record<string, unknown>;

  const { data: lineas, error: e2 } = await db
    .from("invoice_lines")
    .select("description, quantity, unit_price, tax_rate, subtotal, tax_amount")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("line_order", { ascending: true });
  if (e2) throw new MutationError(pgErrorToMessage(e2), 500, e2);

  let referencia: DocumentoParaValidar["referencia"] = null;
  const esNd = f.invoice_kind === "NOTA_DEBITO";
  const refId = esNd ? (f.referenced_invoice_id as string | null | undefined) ?? null : null;
  if (refId) {
    const { data: ref } = await db
      .from("invoices")
      .select("invoice_number, issue_date, dgi_cufe")
      .eq("tenant_id", tenantId)
      .eq("id", refId)
      .maybeSingle();
    if (ref) {
      referencia = { numero: String(ref.invoice_number), fecha: String(ref.issue_date), cufe: s(ref.dgi_cufe) };
    }
  }

  return {
    clase: esNd ? "nota_debito" : "factura",
    receptor: await cargarReceptor(db, tenantId, String(f.client_id)),
    lineas: ((lineas ?? []) as Record<string, unknown>[]).map((l) => ({
      description: l.description as string | null,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      tax_rate: Number(l.tax_rate),
      subtotal: l.subtotal == null ? null : Number(l.subtotal),
      tax_amount: l.tax_amount == null ? null : Number(l.tax_amount),
    })),
    totales: { subtotal: Number(f.subtotal_total), impuesto: Number(f.tax_total), total: Number(f.grand_total) },
    fechaDocumento: String(f.issue_date).slice(0, 10),
    referencia,
  };
}

/** Una NC ya creada, lista para validar (el reenvío a la DGI). */
export async function cargarNotaDeCreditoParaValidar(db: DB, tenantId: string, creditNoteId: string): Promise<DocumentoParaValidar> {
  const { data: nc, error } = await db
    .from("credit_notes")
    .select("client_id, invoice_id, issue_date, subtotal_total, tax_total, grand_total")
    .eq("tenant_id", tenantId)
    .eq("id", creditNoteId)
    .maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!nc) throw new MutationError("Nota de crédito no encontrada", 404);

  const { data: lineas, error: e2 } = await db
    .from("credit_note_lines")
    .select("description, quantity, unit_price, tax_rate, subtotal, tax_amount")
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", creditNoteId)
    .order("line_order", { ascending: true });
  if (e2) throw new MutationError(pgErrorToMessage(e2), 500, e2);

  let referencia: DocumentoParaValidar["referencia"] = null;
  if (nc.invoice_id) {
    const { data: ref } = await db
      .from("invoices")
      .select("invoice_number, issue_date, dgi_cufe")
      .eq("tenant_id", tenantId)
      .eq("id", nc.invoice_id)
      .maybeSingle();
    if (ref) referencia = { numero: String(ref.invoice_number), fecha: String(ref.issue_date), cufe: s(ref.dgi_cufe) };
  }

  return {
    clase: "nota_credito",
    receptor: await cargarReceptor(db, tenantId, String(nc.client_id)),
    lineas: ((lineas ?? []) as Record<string, unknown>[]).map((l) => ({
      description: l.description as string | null,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      tax_rate: Number(l.tax_rate),
      subtotal: l.subtotal == null ? null : Number(l.subtotal),
      tax_amount: l.tax_amount == null ? null : Number(l.tax_amount),
    })),
    totales: { subtotal: Number(nc.subtotal_total), impuesto: Number(nc.tax_total), total: Number(nc.grand_total) },
    fechaDocumento: String(nc.issue_date).slice(0, 10),
    referencia,
  };
}

/**
 * Guarda (o limpia, con `null`) el motivo por el que el documento no llegó a la
 * DGI. Nunca lanza: si no se puede guardar el motivo, el error original es el
 * que tiene que llegar a la pantalla.
 */
export async function guardarMotivoPendiente(
  db: DB,
  tenantId: string,
  tabla: "invoices" | "credit_notes",
  id: string,
  motivo: string | null
): Promise<void> {
  const texto = motivo ? motivo.trim().slice(0, 4000) : null;
  const { error } = await db
    .from(tabla)
    .update({ fe_motivo_pendiente: texto || null, fe_motivo_pendiente_en: texto ? new Date().toISOString() : null })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) console.error("[efactura] no se pudo guardar el motivo pendiente", { tabla, id, error: error.message });
}

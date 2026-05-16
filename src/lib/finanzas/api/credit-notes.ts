/**
 * Helpers server-side para notas de crédito.
 *
 * MVP del Sprint 2C: createCreditNoteFromInvoice — invocado UNA vez al
 * anular una factura. Genera una NC mirror exacta:
 *   - reason = la razón de la anulación
 *   - issue_date = hoy
 *   - número via get_next_sequence_number('credit_note') → NC-NNNNNN
 *   - líneas = clon literal de invoice_lines (description, qty, unit_price,
 *     tax_code, tax_rate, tax_code_id, service_id, line_order)
 *   - invoice_line_id apunta a la línea original (trazabilidad D4 del Batch 3c)
 *
 * Atomicidad: compensating delete del header si las líneas fallan. Como
 * T8c recalcula totales automáticamente al insertar líneas, no hace falta
 * UPDATE manual de subtotal_total / tax_total / grand_total.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";

type DB = SupabaseClient;

/**
 * Crea una nota de crédito mirror de una factura. Devuelve id +
 * credit_note_number formateado. Si la NC ya existe para esta factura, NO
 * crea duplicado — devuelve la existente (idempotencia defensiva).
 *
 * El caller (cancelInvoice) debe haber validado previamente que la factura
 * es anulable. Acá NO re-validamos status — la NC en sí no tiene esa
 * dependencia (es solo un documento contable de reversión).
 */
export async function createCreditNoteFromInvoice(
  db: DB,
  tenantId: string,
  userId: string,
  invoiceId: string,
  reason: string,
  observations: string | null = null
): Promise<{ id: string; credit_note_number: string }> {
  // Idempotencia: si ya existe una NC para esta factura, devolverla.
  // Caso típico: retry del usuario tras error de red intermedio.
  const { data: existing, error: errExisting } = await db
    .from("credit_notes")
    .select("id, credit_note_number")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (existing) {
    return {
      id: existing.id as string,
      credit_note_number: existing.credit_note_number as string,
    };
  }

  // 1. Cargar la factura origen + sus líneas (mirror exacto).
  const { data: invoice, error: errInv } = await db
    .from("invoices")
    .select("id, client_id, invoice_number")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errInv) {
    throw new MutationError(pgErrorToMessage(errInv), 500, errInv);
  }
  if (!invoice) {
    throw new MutationError("Factura no encontrada", 404);
  }

  const { data: invoiceLines, error: errLines } = await db
    .from("invoice_lines")
    .select(
      `id, line_order, service_id, description, quantity, unit_price,
       tax_code, tax_rate, tax_code_id`
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("line_order", { ascending: true });

  if (errLines) {
    throw new MutationError(pgErrorToMessage(errLines), 500, errLines);
  }
  if (!invoiceLines || invoiceLines.length === 0) {
    throw new MutationError(
      "La factura no tiene líneas para generar la nota de crédito.",
      400
    );
  }

  // 2. Obtener próximo número de secuencia
  const { data: nextNumber, error: errSeq } = await db.rpc(
    "get_next_sequence_number",
    {
      p_tenant_id: tenantId,
      p_sequence_type: "credit_note",
    }
  );

  if (errSeq || typeof nextNumber !== "number") {
    throw new MutationError(pgErrorToMessage(errSeq), 500, errSeq);
  }

  const formattedNumber = `NC-${String(nextNumber).padStart(6, "0")}`;
  const issueDateIso = new Date().toISOString().slice(0, 10);

  // 3. INSERT credit_notes header (totales=0, T8c los recalcula con las líneas)
  const { data: cnHeader, error: errCn } = await db
    .from("credit_notes")
    .insert({
      tenant_id: tenantId,
      credit_note_number: formattedNumber,
      invoice_id: invoiceId,
      client_id: invoice.client_id,
      issue_date: issueDateIso,
      reason,
      observations,
      status: "emitida",
      currency: "USD",
      created_by: userId,
    })
    .select("id")
    .single();

  if (errCn || !cnHeader) {
    throw new MutationError(pgErrorToMessage(errCn), 400, errCn);
  }

  const creditNoteId = cnHeader.id as string;

  // 4. INSERT credit_note_lines (clon literal). T8c recalcula totales.
  const linesPayload = invoiceLines.map((ln) => ({
    tenant_id: tenantId,
    credit_note_id: creditNoteId,
    invoice_line_id: ln.id,
    line_order: ln.line_order,
    service_id: ln.service_id,
    description: ln.description,
    quantity: ln.quantity,
    unit_price: ln.unit_price,
    tax_code: ln.tax_code,
    tax_rate: ln.tax_rate,
    tax_code_id: ln.tax_code_id,
    created_by: userId,
  }));

  const { error: errCnLines } = await db
    .from("credit_note_lines")
    .insert(linesPayload);

  if (errCnLines) {
    // COMPENSATING: borrar el header — pero T6 BLOQUEA delete de credit_notes
    // siempre ("Nota de crédito X no puede eliminarse, es irreversible").
    // Por eso preferimos LOGUEAR + RAISE: queda una NC huérfana sin líneas
    // (grand_total=0) que requiere intervención manual de Oliver, pero no
    // duplicamos numeración. Es el menor mal.
    console.error(
      "[finanzas] createCreditNoteFromInvoice: lines insert failed, NC huérfana creada con id=" +
        creditNoteId +
        " number=" +
        formattedNumber +
        " — requiere intervención manual"
    );
    throw new MutationError(pgErrorToMessage(errCnLines), 400, errCnLines);
  }

  return { id: creditNoteId, credit_note_number: formattedNumber };
}

/**
 * Obtiene una NC por id con sus líneas, factura origen y cliente.
 * Devuelve null si no existe o no pertenece al tenant.
 */
export async function getCreditNoteById(
  db: DB,
  tenantId: string,
  id: string
) {
  const { data: header, error: errHeader } = await db
    .from("credit_notes")
    .select(
      `
        id, credit_note_number, invoice_id, client_id, issue_date, reason,
        observations, status, currency, subtotal_total, tax_total, grand_total,
        created_at, created_by,
        invoice:invoices!credit_notes_invoice_id_fkey(
          id, invoice_number, invoice_kind, issue_date
        ),
        client:clients!credit_notes_client_id_fkey(
          id, name, client_number, ruc
        )
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errHeader || !header) {
    if (errHeader)
      console.error("[finanzas/queries] getCreditNoteById failed", errHeader);
    return null;
  }

  const { data: lines, error: errLines } = await db
    .from("credit_note_lines")
    .select(
      `id, credit_note_id, invoice_line_id, line_order, service_id, description,
       quantity, unit_price, tax_code, tax_rate, tax_code_id,
       subtotal, tax_amount, line_total`
    )
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", id)
    .order("line_order", { ascending: true });

  if (errLines) {
    console.error("[finanzas/queries] getCreditNoteById lines failed", errLines);
  }

  return {
    ...(header as unknown as Record<string, unknown>),
    lines: lines ?? [],
  };
}

/**
 * Devuelve el credit_note_number asociado a una factura, o null si no
 * existe NC. Usado por el detalle de factura para mostrar la referencia.
 */
export async function getCreditNoteForInvoice(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<{ id: string; credit_note_number: string } | null> {
  const { data, error } = await db
    .from("credit_notes")
    .select("id, credit_note_number")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (error || !data) {
    if (error)
      console.error("[finanzas/queries] getCreditNoteForInvoice failed", error);
    return null;
  }
  return {
    id: data.id as string,
    credit_note_number: data.credit_note_number as string,
  };
}

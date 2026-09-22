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
import {
  validarLineasDeNotaDeCredito,
  type CreateCreditNoteInput,
  type LineaFacturada,
} from "@/lib/finanzas/validators/credit-note";
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import { construirAsientoDeNotaDeCredito } from "@/lib/finanzas/contabilidad/asiento-nota-credito";
import { cargarNotaDeCreditoParaAsiento } from "@/lib/finanzas/queries/nota-credito-para-asiento";

type DB = SupabaseClient;

/**
 * UN SOLO CREADOR DE NOTAS DE CRÉDITO (Bloque 5, 22/09/2026).
 *
 * `createCreditNote` recibe las líneas de la factura que se acreditan, con su
 * cantidad, y arma la NC: valida contra la factura (`validarLineasDeNotaDeCredito`:
 * cantidades acumuladas por línea, tope en `balance_due`), toma el número
 * `NC-`, inserta la cabecera con fecha de HOY y las líneas (T8c recalcula los
 * totales; el trigger de la 051 deriva `invoices.credited_total`).
 *
 * `createCreditNoteFromInvoice` es la MISMA función con todas las líneas por
 * su cantidad completa: la NC total automática que acompaña a la anulación.
 * No hay un segundo camino que arme líneas (`nota-de-credito-un-solo-creador`
 * lo vigila leyendo `cancelInvoice` y este archivo).
 *
 * Qué NO hace: no postea. El asiento propio de la NC (source_type
 * `nota_credito`, source_id = la NC) y la reversión de la anulación son del
 * commit 3 de este bloque y viven en quien llama (`emitCreditNote` /
 * `cancelInvoice`), no acá, para que la anulación NO postee la NC aparte (D5).
 *
 * 🔴 La fecha es la de HOY, nunca la de la factura (Josuarth: el documento que
 * corrige lleva la fecha en que se hace). Un test lee este archivo y falla si
 * aparece `issue_date` de la factura en el insert.
 */
/**
 * Cantidad ya acreditada por NC anteriores, por `invoice_line_id`. La usa
 * `createCreditNote` para validar y el detalle de la factura para ofrecer en
 * el diálogo solo lo que queda: una sola consulta, para que lo que la pantalla
 * ofrece sea exactamente lo que el servidor va a aceptar.
 */
export async function acreditadoPorLineaDeFactura(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<Map<string, number>> {
  const { data: previas, error: errPrevias } = await db
    .from("credit_note_lines")
    .select("invoice_line_id, quantity, credit_notes!inner(invoice_id, status)")
    .eq("tenant_id", tenantId)
    .eq("credit_notes.invoice_id", invoiceId)
    .eq("credit_notes.status", "emitida");
  if (errPrevias) {
    throw new MutationError(pgErrorToMessage(errPrevias), 500, errPrevias);
  }
  const acreditadoPorLinea = new Map<string, number>();
  for (const l of (previas ?? []) as { invoice_line_id: string | null; quantity: number | string }[]) {
    if (!l.invoice_line_id) continue;
    acreditadoPorLinea.set(l.invoice_line_id, (acreditadoPorLinea.get(l.invoice_line_id) ?? 0) + Number(l.quantity));
  }
  return acreditadoPorLinea;
}

export async function createCreditNote(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateCreditNoteInput
): Promise<{ id: string; credit_note_number: string; total: number }> {
  // 1. La factura y sus líneas
  const { data: invoice, error: errInv } = await db
    .from("invoices")
    .select("id, client_id, invoice_number, status, balance_due")
    .eq("tenant_id", tenantId)
    .eq("id", input.invoice_id)
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
    .eq("invoice_id", input.invoice_id)
    .order("line_order", { ascending: true });
  if (errLines) {
    throw new MutationError(pgErrorToMessage(errLines), 500, errLines);
  }
  if (!invoiceLines || invoiceLines.length === 0) {
    throw new MutationError("La factura no tiene líneas para generar la nota de crédito.", 400);
  }

  // 2. Lo ya acreditado por línea (NC anteriores de esta factura)
  const acreditadoPorLinea = await acreditadoPorLineaDeFactura(db, tenantId, input.invoice_id);

  // 3. La regla contable (pura)
  const facturadas: LineaFacturada[] = (invoiceLines as Record<string, unknown>[]).map((ln) => ({
    id: String(ln.id),
    line_order: Number(ln.line_order),
    service_id: (ln.service_id as string | null) ?? null,
    description: String(ln.description ?? ""),
    quantity: Number(ln.quantity),
    unit_price: Number(ln.unit_price),
    tax_code: String(ln.tax_code ?? ""),
    tax_rate: Number(ln.tax_rate ?? 0),
    tax_code_id: (ln.tax_code_id as string | null) ?? null,
  }));
  const validacion = validarLineasDeNotaDeCredito({
    factura: {
      invoice_number: String(invoice.invoice_number ?? ""),
      status: String(invoice.status),
      balance_due: Number(invoice.balance_due ?? 0),
    },
    facturadas,
    acreditadoPorLinea,
    pedido: input.lineas,
  });
  if (!validacion.ok) {
    throw new MutationError(validacion.mensaje, validacion.status, undefined, validacion.fieldErrors);
  }

  // 4. El número, después de todas las validaciones (un 400 no quema correlativo)
  const { data: nextNumber, error: errSeq } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: "credit_note",
  });
  if (errSeq || typeof nextNumber !== "number") {
    throw new MutationError(pgErrorToMessage(errSeq), 500, errSeq);
  }
  const formattedNumber = `NC-${String(nextNumber).padStart(6, "0")}`;

  // 5. Cabecera con la fecha de HOY (totales = 0; T8c los recalcula con las líneas)
  const issueDateIso = new Date().toISOString().slice(0, 10);
  const { data: cnHeader, error: errCn } = await db
    .from("credit_notes")
    .insert({
      tenant_id: tenantId,
      credit_note_number: formattedNumber,
      invoice_id: input.invoice_id,
      client_id: invoice.client_id,
      issue_date: issueDateIso,
      reason: input.reason,
      observations: input.observations,
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

  // 6. Las líneas. T8c recalcula totales; la 051 deriva credited_total.
  const { error: errCnLines } = await db.from("credit_note_lines").insert(
    validacion.lineas.map((ln) => ({
      tenant_id: tenantId,
      credit_note_id: creditNoteId,
      invoice_line_id: ln.invoice_line_id,
      line_order: ln.line_order,
      service_id: ln.service_id,
      description: ln.description,
      quantity: ln.quantity,
      unit_price: ln.unit_price,
      tax_code: ln.tax_code,
      tax_rate: ln.tax_rate,
      tax_code_id: ln.tax_code_id,
      created_by: userId,
    }))
  );
  if (errCnLines) {
    // COMPENSATING: T6 BLOQUEA el delete de credit_notes siempre ("no puede
    // eliminarse, es irreversible"). Queda una NC huérfana sin líneas
    // (grand_total = 0, credited_total no se mueve) que requiere intervención
    // manual; no se duplica numeración. Es el menor mal, y se loguea.
    console.error(
      "[finanzas] createCreditNote: lines insert failed, NC huérfana creada con id=" +
        creditNoteId +
        " number=" +
        formattedNumber +
        " — requiere intervención manual"
    );
    throw new MutationError(pgErrorToMessage(errCnLines), 400, errCnLines);
  }

  return { id: creditNoteId, credit_note_number: formattedNumber, total: validacion.total };
}

/**
 * DESHACER una NC recién creada cuyo asiento no pudo postearse (o cuya
 * anulación falló). Es el DELETE compensatorio de SOP-031, con la válvula de
 * la 052 (`finanzas.nc_compensar`): T6 y el trigger de líneas la dejan pasar
 * SOLO si la NC no tiene asiento. Va por el cliente de SERVICIO, en el mismo
 * request. El número `NC-` ya se consumió: queda un hueco, como en cobros.
 *
 * Si la compensación falla, se loguea y se lanza la causa original: una NC
 * con número y sin libro es visible (no aparece en el Mayor) y requiere
 * intervención manual; nunca se tapa.
 */
export async function compensarNotaDeCredito(
  ledgerDb: DB,
  tenantId: string,
  ncId: string,
  causa: MutationError
): Promise<never> {
  const { error } = await ledgerDb.rpc("finanzas_compensar_nota_de_credito", {
    p_tenant_id: tenantId,
    p_credit_note_id: ncId,
  });
  if (error) {
    console.error(
      "[finanzas] DELETE compensatorio FALLÓ para la nota de crédito %s. Quedó con número y sin libro.",
      ncId,
      error
    );
  }
  throw causa;
}

/**
 * EMITIR una NC manual (parcial o total, mes cerrado o no): la crea con
 * `createCreditNote` y postea su asiento PROPIO (`nota_credito`, D5). Si el
 * posteo falla (período de hoy cerrado, cuenta de ingreso inactiva, RPC), la
 * NC se deshace con la válvula y el error vuelve tal cual.
 *
 * `ledgerDb` es el cliente de SERVICIO (SOP-014): postea y compensa.
 */
export async function emitCreditNote(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  input: CreateCreditNoteInput
): Promise<{ id: string; credit_note_number: string; total: number; entry_id: string }> {
  const nc = await createCreditNote(db, tenantId, userId, input);

  const datos = await cargarNotaDeCreditoParaAsiento(ledgerDb, tenantId, nc.id);
  if (!datos) {
    await compensarNotaDeCredito(ledgerDb, tenantId, nc.id, new MutationError("La nota de crédito se creó pero no se pudo releer para contabilizarla.", 500));
  }
  const armado = construirAsientoDeNotaDeCredito(datos as NonNullable<typeof datos>);
  if (!armado.ok) {
    await compensarNotaDeCredito(ledgerDb, tenantId, nc.id, new MutationError(armado.mensaje, 422));
  }
  let entryId: string;
  try {
    entryId = await postJournalEntry(ledgerDb, tenantId, (armado as { ok: true; asiento: import("@/lib/finanzas/contabilidad/posting").AsientoInput }).asiento, userId);
  } catch (err) {
    await compensarNotaDeCredito(ledgerDb, tenantId, nc.id, err instanceof MutationError ? err : new MutationError(String(err), 500));
    throw err; // inalcanzable: compensar lanza siempre
  }
  return { ...nc, entry_id: entryId };
}

/**
 * La NC TOTAL de una factura: la misma `createCreditNote` con todas las líneas
 * por su cantidad completa. La usa `cancelInvoice`.
 *
 * Idempotente para el reintento: si la factura ya está acreditada al 100%
 * (una NC anterior por el total), devuelve esa NC en vez de fallar por el
 * tope de `balance_due`.
 */
export async function createCreditNoteFromInvoice(
  db: DB,
  tenantId: string,
  userId: string,
  invoiceId: string,
  reason: string,
  observations: string | null = null
): Promise<{ id: string; credit_note_number: string }> {
  const { data: inv, error: errInv } = await db
    .from("invoices")
    .select("id, grand_total, credited_total")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (errInv) {
    throw new MutationError(pgErrorToMessage(errInv), 500, errInv);
  }
  if (!inv) {
    throw new MutationError("Factura no encontrada", 404);
  }
  if (Number(inv.credited_total) >= Number(inv.grand_total) - 0.005 && Number(inv.grand_total) > 0) {
    const { data: ya } = await db
      .from("credit_notes")
      .select("id, credit_note_number")
      .eq("tenant_id", tenantId)
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ya) {
      return { id: ya.id as string, credit_note_number: ya.credit_note_number as string };
    }
  }

  const { data: lines, error: errLines } = await db
    .from("invoice_lines")
    .select("id, quantity")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);
  if (errLines) {
    throw new MutationError(pgErrorToMessage(errLines), 500, errLines);
  }
  const r = await createCreditNote(db, tenantId, userId, {
    invoice_id: invoiceId,
    reason,
    observations,
    lineas: ((lines ?? []) as { id: string; quantity: number | string }[]).map((l) => ({
      invoice_line_id: l.id,
      quantity: Number(l.quantity),
    })),
  });
  return { id: r.id, credit_note_number: r.credit_note_number };
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
        fe_estado, dgi_cufe, dgi_fecha_autorizacion,
        created_at, created_by,
        invoice:invoices!credit_notes_invoice_id_fkey(
          id, invoice_number, invoice_kind, issue_date, status, grand_total
        ),
        client:clients!credit_notes_client_id_fkey(
          id, name, client_number, ruc, digito_verificador
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
    // Desde la 051 una factura puede tener VARIAS NC (parciales): esta
    // devuelve la última; el listado completo es `listCreditNotesForInvoice`.
    .order("created_at", { ascending: false })
    .limit(1)
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

/** Todas las NC de una factura, más nuevas primero (051: pueden ser varias). */
export async function listCreditNotesForInvoice(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<{ id: string; credit_note_number: string; issue_date: string; reason: string; grand_total: number; fe_estado: string }[]> {
  const { data, error } = await db
    .from("credit_notes")
    .select("id, credit_note_number, issue_date, reason, grand_total, fe_estado")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[finanzas/queries] listCreditNotesForInvoice failed", error);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    credit_note_number: String(r.credit_note_number),
    issue_date: String(r.issue_date),
    reason: String(r.reason ?? ""),
    grand_total: Number(r.grand_total ?? 0),
    fe_estado: String(r.fe_estado ?? "no_emitida"),
  }));
}

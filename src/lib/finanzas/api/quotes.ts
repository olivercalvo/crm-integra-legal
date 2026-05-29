/**
 * Helpers server-side para mutaciones de cotizaciones. Llamados desde route
 * handlers `/api/finanzas/quotes/...`. NO marcar 'use server' — son
 * funciones server-side puras invocadas dentro de route handlers Next.js.
 *
 * Patrón consistente con api/invoices.ts: admin client (bypass RLS) + filter
 * manual por tenant_id. Cada función recibe el client + tenantId del
 * contexto autenticado del route handler.
 *
 * TODO(hardening): migrar createQuote a una RPC SECURITY DEFINER para
 * atomicidad real con transacción server-side. Por ahora compensating delete
 * es safe-enough para MVP — mismo patrón que invoices.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateQuoteInput,
  UpdateQuoteInput,
  NewQuoteLineInput,
  NewProspectInput,
  SendQuoteInput,
  CancelQuoteInput,
  MarkRejectedInput,
  QuoteLineKind,
} from "@/lib/finanzas/types/quote";
import {
  QUOTE_SEQUENCE_TYPE,
  QUOTE_NUMBER_PREFIX,
  QUOTE_TITLE_MIN,
  QUOTE_TITLE_MAX,
  QUOTE_OBSERVATIONS_MAX,
} from "@/lib/finanzas/types/quote";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { createInvoice } from "@/lib/finanzas/api/invoices";
import { getTermsTemplate } from "@/lib/finanzas/api/quote-terms";

type DB = SupabaseClient;

// ---------------------------------------------------------------------------
// Validators — devuelven { ok, data, errors } estilo invoices/validators
// ---------------------------------------------------------------------------

export type QuoteValidationErrors = Record<string, string>;

export type QuoteValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: QuoteValidationErrors };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_KINDS: QuoteLineKind[] = ["HON", "REI"];

/**
 * Valida el campo observations (Sprint QUOTES-POLISH). Opcional; si viene,
 * trim + máx QUOTE_OBSERVATIONS_MAX. Devuelve mensaje o null. El CHECK en
 * BD enforza el mismo límite.
 */
function validateObservations(raw: unknown): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > QUOTE_OBSERVATIONS_MAX) {
    return `Observaciones máximo ${QUOTE_OBSERVATIONS_MAX} caracteres`;
  }
  return null;
}

/** Normaliza observations: trim, devuelve null si queda vacío. */
function normalizeObservations(raw: unknown): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Valida un title de cotización (Sprint 2E.3.2). Devuelve mensaje de error
 * o null si está OK. Trim siempre antes de validar para que un usuario que
 * solo pone espacios reciba el mismo error que un campo vacío.
 *
 * El CHECK quotes_title_length en BD enforza los mismos límites, así que
 * server-side y client-side comparten constantes (QUOTE_TITLE_MIN/MAX).
 */
function validateTitle(raw: unknown): string | null {
  if (raw == null) return "Título requerido";
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return "Título requerido";
  if (trimmed.length < QUOTE_TITLE_MIN) {
    return `Título mínimo ${QUOTE_TITLE_MIN} caracteres`;
  }
  if (trimmed.length > QUOTE_TITLE_MAX) {
    return `Título máximo ${QUOTE_TITLE_MAX} caracteres`;
  }
  return null;
}

/**
 * Valida una línea individual. Devuelve un mapa flat de errores; el caller
 * lo prefijea con `lines.<idx>.<campo>` si corresponde.
 */
function validateLine(line: Partial<NewQuoteLineInput>): QuoteValidationErrors {
  const e: QuoteValidationErrors = {};

  if (!line.invoice_kind || !VALID_KINDS.includes(line.invoice_kind as QuoteLineKind)) {
    e.invoice_kind = "Tipo (HON o REI) requerido";
  }

  if (!line.description || !String(line.description).trim()) {
    e.description = "Descripción requerida";
  }

  const qty = Number(line.quantity);
  if (!isFinite(qty) || qty <= 0) {
    e.quantity = "Cantidad debe ser mayor a 0";
  }

  const price = Number(line.unit_price);
  if (!isFinite(price) || price < 0) {
    e.unit_price = "Precio no puede ser negativo";
  }

  // tax_rate es DECIMAL [0, 1] (0.07 = 7%), NO porcentaje.
  const rate = Number(line.tax_rate);
  if (!isFinite(rate) || rate < 0 || rate > 1) {
    e.tax_rate = "Tasa fuera de rango (debe ser decimal entre 0 y 1)";
  }

  if (!line.tax_code || !String(line.tax_code).trim()) {
    e.tax_code = "Código de impuesto requerido";
  }

  return e;
}

/** Valida los datos del prospect creado inline (D13). */
export function validateNewProspectInput(
  raw: Partial<NewProspectInput> | null | undefined
): QuoteValidationResult<NewProspectInput> {
  const errors: QuoteValidationErrors = {};
  const name = raw?.name ? String(raw.name).trim() : "";
  const email = raw?.email ? String(raw.email).trim() : "";
  const phone = raw?.phone ? String(raw.phone).trim() : "";
  const clientType = raw?.client_type;

  if (name.length < 2) errors.name = "Nombre del cliente requerido (mínimo 2 caracteres)";
  if (!email) errors.email = "Email del cliente requerido";
  else if (!EMAIL_RE.test(email)) errors.email = "Email inválido";

  if (!clientType || !["persona_natural", "persona_juridica"].includes(clientType)) {
    errors.client_type = "Tipo de cliente requerido (persona natural o jurídica)";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      name,
      email,
      phone: phone || null,
      client_type: clientType as NewProspectInput["client_type"],
    },
  };
}

/** Valida un payload de creación de cotización. */
export function validateCreateQuote(
  raw: Partial<CreateQuoteInput>
): QuoteValidationResult<CreateQuoteInput> {
  const errors: QuoteValidationErrors = {};

  // Exactly one of client_id OR new_prospect.
  const hasClientId = !!raw.client_id;
  const hasNewProspect = !!raw.new_prospect;
  if (hasClientId === hasNewProspect) {
    errors.client_id = "Indica un cliente existente O los datos de un cliente nuevo (no ambos, no ninguno)";
  } else if (hasClientId && !UUID_RE.test(String(raw.client_id))) {
    errors.client_id = "Cliente inválido";
  } else if (hasNewProspect) {
    const v = validateNewProspectInput(raw.new_prospect);
    if (!v.ok) {
      for (const [k, msg] of Object.entries(v.errors)) {
        errors[`new_prospect.${k}`] = msg;
      }
    }
  }

  // case_id opcional, pero si viene debe ser UUID válido.
  if (raw.case_id && !UUID_RE.test(String(raw.case_id))) {
    errors.case_id = "Caso inválido";
  }

  // title obligatorio (Sprint 2E.3.2). 3-100 chars luego de trim.
  const titleError = validateTitle(raw.title);
  if (titleError) errors.title = titleError;

  // observations opcional (Sprint QUOTES-POLISH). Si viene, máx 2000 chars.
  const obsError = validateObservations(raw.observations);
  if (obsError) errors.observations = obsError;

  // issue_date opcional (default hoy); valid_until obligatorio.
  if (raw.issue_date && !DATE_RE.test(String(raw.issue_date))) {
    errors.issue_date = "Fecha de emisión inválida";
  }
  if (!raw.valid_until || !DATE_RE.test(String(raw.valid_until))) {
    errors.valid_until = "Fecha de validez requerida (formato YYYY-MM-DD)";
  } else {
    const issue = raw.issue_date ?? new Date().toISOString().slice(0, 10);
    if (raw.valid_until < issue) {
      errors.valid_until = "La fecha de validez no puede ser anterior a la fecha de emisión";
    }
  }

  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  if (lines.length === 0) {
    errors.lines = "Agrega al menos una línea a la cotización";
  } else {
    lines.forEach((ln, idx) => {
      const lineErrors = validateLine(ln);
      for (const [k, v] of Object.entries(lineErrors)) {
        errors[`lines.${idx}.${k}`] = v;
      }
    });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      client_id: raw.client_id,
      new_prospect: raw.new_prospect,
      case_id: raw.case_id ?? null,
      issue_date: raw.issue_date,
      valid_until: raw.valid_until as string,
      title: String(raw.title ?? "").trim(),
      notes: raw.notes ?? null,
      observations: normalizeObservations(raw.observations),
      terms_and_conditions: raw.terms_and_conditions ?? null,
      lines: lines.map((ln) => ({
        invoice_kind: ln.invoice_kind as QuoteLineKind,
        description: String(ln.description).trim(),
        quantity: Number(ln.quantity),
        unit_price: Number(ln.unit_price),
        tax_rate: Number(ln.tax_rate),
        tax_code: String(ln.tax_code),
        service_id: ln.service_id ?? null,
        tax_code_id: ln.tax_code_id ?? null,
      })),
    },
  };
}

/** Valida payload de update (mismo shape que create pero todos opcionales). */
export function validateUpdateQuote(
  raw: Partial<UpdateQuoteInput>
): QuoteValidationResult<UpdateQuoteInput> {
  const errors: QuoteValidationErrors = {};

  if (raw.client_id !== undefined && !UUID_RE.test(String(raw.client_id))) {
    errors.client_id = "Cliente inválido";
  }
  if (raw.case_id != null && !UUID_RE.test(String(raw.case_id))) {
    errors.case_id = "Caso inválido";
  }
  if (raw.issue_date && !DATE_RE.test(String(raw.issue_date))) {
    errors.issue_date = "Fecha de emisión inválida";
  }
  if (raw.valid_until && !DATE_RE.test(String(raw.valid_until))) {
    errors.valid_until = "Fecha de validez inválida";
  }
  if (raw.issue_date && raw.valid_until && raw.valid_until < raw.issue_date) {
    errors.valid_until = "La fecha de validez no puede ser anterior a la fecha de emisión";
  }

  // title opcional en update — pero si viene, debe respetar 3-100 chars.
  // No se permite enviar "" (la BD lo rechazaría por CHECK).
  if (raw.title !== undefined) {
    const titleError = validateTitle(raw.title);
    if (titleError) errors.title = titleError;
  }

  // observations opcional en update — si viene, máx 2000 chars.
  if (raw.observations !== undefined) {
    const obsError = validateObservations(raw.observations);
    if (obsError) errors.observations = obsError;
  }

  if (raw.lines !== undefined) {
    const lines = Array.isArray(raw.lines) ? raw.lines : [];
    if (lines.length === 0) {
      errors.lines = "La cotización debe tener al menos una línea";
    } else {
      lines.forEach((ln, idx) => {
        const lineErrors = validateLine(ln);
        for (const [k, v] of Object.entries(lineErrors)) {
          errors[`lines.${idx}.${k}`] = v;
        }
      });
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  // Normalizar title con trim para que el UPDATE persista la versión limpia
  // (consistente con createQuote). Idem observations.
  const normalized: UpdateQuoteInput = {
    ...(raw as UpdateQuoteInput),
    ...(raw.title !== undefined ? { title: String(raw.title).trim() } : {}),
    ...(raw.observations !== undefined
      ? { observations: normalizeObservations(raw.observations) }
      : {}),
  };

  return { ok: true, errors: null, data: normalized };
}

/** Valida payload de envío (sent_to_email + reglas de estado se chequean en sendQuote). */
export function validateSendQuote(
  raw: Partial<SendQuoteInput>
): QuoteValidationResult<SendQuoteInput> {
  const email = raw?.sent_to_email ? String(raw.sent_to_email).trim() : "";
  if (!email) {
    return { ok: false, data: null, errors: { sent_to_email: "Email destinatario requerido" } };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, data: null, errors: { sent_to_email: "Email destinatario inválido" } };
  }
  return { ok: true, errors: null, data: { sent_to_email: email } };
}

/** Valida razón de cancelación pre-envío (D5: opcional). */
export function validateCancelQuote(
  raw: Partial<CancelQuoteInput> | null | undefined
): QuoteValidationResult<CancelQuoteInput> {
  const reason = raw?.reason ? String(raw.reason).trim() : "";
  // Opcional, pero si viene no puede pasarse de 1000 chars (consistencia con anular factura).
  if (reason.length > 1000) {
    return {
      ok: false,
      data: null,
      errors: { reason: "La razón no puede tener más de 1000 caracteres" },
    };
  }
  return { ok: true, errors: null, data: { reason: reason || null } };
}

/** Valida razón de rechazo manual (D5: opcional). */
export function validateMarkRejected(
  raw: Partial<MarkRejectedInput> | null | undefined
): QuoteValidationResult<MarkRejectedInput> {
  return validateCancelQuote(raw) as QuoteValidationResult<MarkRejectedInput>;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Genera el siguiente client_number CLI-NNN para un tenant. Replica el patrón
 * existente del módulo Clientes (ver src/app/api/clients/route.ts). Acá no
 * hay sequence en numbering_sequences para clients — se usa max+1.
 *
 * Race condition: si dos requests concurrentes computan el mismo CLI-NNN,
 * la segunda INSERT falla por UNIQUE constraint y el caller debe reintentar.
 * Aceptable para MVP; documento volúmenes esperados (un puñado de prospects
 * por día).
 */
async function generateNextClientNumber(db: DB, tenantId: string): Promise<string> {
  const { data: lastClient } = await db
    .from("clients")
    .select("client_number")
    .eq("tenant_id", tenantId)
    .order("client_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextNumber = 1;
  if (lastClient?.client_number) {
    const match = (lastClient.client_number as string).match(/CLI-(\d+)/);
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }
  return `CLI-${String(nextNumber).padStart(3, "0")}`;
}

/**
 * Crea un prospect (cliente con client_status='prospect') a partir de los
 * datos mínimos D13. Devuelve el client_id generado.
 *
 * Si la INSERT falla, lanza MutationError. El caller debe propagar.
 */
async function insertProspectClient(
  db: DB,
  tenantId: string,
  data: NewProspectInput
): Promise<string> {
  const clientNumber = await generateNextClientNumber(db, tenantId);

  const { data: newClient, error } = await db
    .from("clients")
    .insert({
      tenant_id: tenantId,
      client_number: clientNumber,
      name: data.name,
      email: data.email,
      phone: data.phone ?? null,
      client_status: "prospect",
      client_type: data.client_type,
      observations: "Prospect creado desde una cotización (Sprint 2E.1).",
    })
    .select("id")
    .single();

  if (error || !newClient) {
    throw new MutationError(
      pgErrorToMessage(error) || "No se pudo crear el cliente prospect",
      400,
      error
    );
  }
  return newClient.id as string;
}

/** Calcula totales de líneas client-side. La BD recalcula via trigger T8b-quote. */
function calcTotals(lines: NewQuoteLineInput[]): {
  subtotal_total: number;
  tax_total: number;
  grand_total: number;
  subtotal_hon: number;
  subtotal_rei: number;
} {
  let subtotal_total = 0;
  let tax_total = 0;
  let subtotal_hon = 0;
  let subtotal_rei = 0;
  for (const ln of lines) {
    const q = Number(ln.quantity) || 0;
    const p = Number(ln.unit_price) || 0;
    const r = Number(ln.tax_rate) || 0;
    const lineSub = q * p;
    subtotal_total += lineSub;
    tax_total += lineSub * r;
    if (ln.invoice_kind === "HON") subtotal_hon += lineSub;
    else if (ln.invoice_kind === "REI") subtotal_rei += lineSub;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    subtotal_total: round2(subtotal_total),
    tax_total: round2(tax_total),
    grand_total: round2(subtotal_total + tax_total),
    subtotal_hon: round2(subtotal_hon),
    subtotal_rei: round2(subtotal_rei),
  };
}

/** Random 16 hex chars usando Web Crypto. Para public_token de portal. */
function generatePublicToken(): string {
  // UUID v4 vía randomUUID() — disponible en Node 20+ y Edge runtime.
  // Si no está disponible, fallback a getRandomValues + format.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const arr = new Uint8Array(16);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Crea una cotización en estado 'emitida' con sus líneas.
 *
 * Hot-fix QUOTES-FLOW (2026-05-17): el status final pasó de 'borrador' a
 * 'emitida' para eliminar el paso intermedio "guardar borrador → emitir".
 * La cotización nace con número definitivo, lista para entregar al cliente
 * y todavía editable mientras esté en 'emitida'.
 *
 * Flujo (compensating delete pattern, mismo que createInvoice):
 *   1. Si new_prospect: INSERT cliente con client_status='prospect'.
 *      Si falla → 400, abortamos (no hay cleanup).
 *   2. Validar client_id (existente o recién creado): tenant + status != inactive.
 *   3. Si case_id: validar que existe y pertenece al mismo cliente.
 *   4. Snapshot del T&C: si terms_and_conditions vacío → cargar template del tenant.
 *   5. Calcular totales (client-side; trigger T8b-quote los re-confirma).
 *   6. Consumir secuencia 'quote' via RPC get_next_sequence_number.
 *   7. INSERT cabecera (status='borrador' transitorio) + INSERT líneas bulk
 *      + UPDATE status='emitida' al final. La cabecera nace 'borrador' para
 *      no romper el compensating delete (T6 bloquea delete de 'emitida',
 *      D2 congelada). Si algún paso entre el INSERT cabecera y el UPDATE
 *      final falla, el DELETE compensating funciona porque la cabecera
 *      sigue en 'borrador'.
 *   8. Si las líneas fallan o el UPDATE status='emitida' falla, DELETE
 *      cabecera (sigue 'borrador', T6 lo permite).
 *   9. Si se creó un prospect y la cotización falla post-prospect, NO
 *      eliminar el prospect (queda en BD para que la abogada decida qué
 *      hacer con él — los datos del cliente nuevo son trabajo capturado).
 *
 * Devuelve { id, quote_number, created_prospect_id? }.
 */
export async function createQuote(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateQuoteInput
): Promise<{ id: string; quote_number: string; created_prospect_id?: string }> {
  // ---------- 1. Resolver client_id (existente o crear prospect) ----------
  let clientId: string;
  let createdProspectId: string | undefined;

  if (input.new_prospect) {
    createdProspectId = await insertProspectClient(db, tenantId, input.new_prospect);
    clientId = createdProspectId;
  } else if (input.client_id) {
    const { data: existingClient, error: errClient } = await db
      .from("clients")
      .select("client_status")
      .eq("tenant_id", tenantId)
      .eq("id", input.client_id)
      .maybeSingle();

    if (errClient) throw new MutationError(pgErrorToMessage(errClient), 500, errClient);
    if (!existingClient) throw new MutationError("Cliente no encontrado", 404);
    if (existingClient.client_status === "inactive") {
      throw new MutationError(
        "No se puede crear una cotización para un cliente inactivo. Reactiva el cliente desde el módulo Clientes.",
        400
      );
    }
    clientId = input.client_id;
  } else {
    // Validator ya bloquea esto, pero defensa en profundidad.
    throw new MutationError("Falta indicar cliente o datos de cliente nuevo", 400);
  }

  // ---------- 2. Validar case_id si viene ----------
  if (input.case_id) {
    const { data: kase, error: errCase } = await db
      .from("cases")
      .select("client_id")
      .eq("tenant_id", tenantId)
      .eq("id", input.case_id)
      .maybeSingle();

    if (errCase) throw new MutationError(pgErrorToMessage(errCase), 500, errCase);
    if (!kase) throw new MutationError("Caso no encontrado", 404);
    if (kase.client_id !== clientId) {
      throw new MutationError("El caso no pertenece al cliente indicado", 400);
    }
  }

  // ---------- 3. Snapshot del T&C ----------
  let terms = input.terms_and_conditions ? String(input.terms_and_conditions).trim() : "";
  if (!terms) {
    terms = await getTermsTemplate(db, tenantId);
  }

  // ---------- 4. Totales ----------
  const totals = calcTotals(input.lines);

  // ---------- 5. Consumir secuencia ----------
  const { data: seqResult, error: errSeq } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: QUOTE_SEQUENCE_TYPE,
  });

  if (errSeq || typeof seqResult !== "number") {
    throw new MutationError(pgErrorToMessage(errSeq), 500, errSeq);
  }
  const quoteNumber = `${QUOTE_NUMBER_PREFIX}-${String(seqResult).padStart(6, "0")}`;

  // ---------- 6. INSERT cabecera ----------
  const issueDate = input.issue_date ?? new Date().toISOString().slice(0, 10);

  const { data: header, error: errHeader } = await db
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      quote_number: quoteNumber,
      client_id: clientId,
      case_id: input.case_id ?? null,
      issue_date: issueDate,
      valid_until: input.valid_until,
      title: input.title,
      // Cabecera nace 'borrador' transitorio para que el compensating delete
      // funcione si las líneas fallan (T6 bloquea delete de 'emitida').
      // Tras insertar las líneas se promociona a 'emitida' (paso 8).
      status: "borrador",
      currency: "USD",
      subtotal_total: totals.subtotal_total,
      tax_total: totals.tax_total,
      grand_total: totals.grand_total,
      subtotal_hon: totals.subtotal_hon,
      subtotal_rei: totals.subtotal_rei,
      terms_and_conditions: terms,
      notes: input.notes ?? null,
      observations: normalizeObservations(input.observations),
      created_by: userId,
    })
    .select("id")
    .single();

  if (errHeader || !header) {
    throw new MutationError(pgErrorToMessage(errHeader), 400, errHeader);
  }

  const quoteId = header.id as string;

  // ---------- 7. INSERT líneas (line_order desde 1) ----------
  const linesPayload = input.lines.map((ln, idx) => ({
    tenant_id: tenantId,
    quote_id: quoteId,
    line_order: idx + 1,
    invoice_kind: ln.invoice_kind,
    service_id: ln.service_id ?? null,
    description: ln.description,
    quantity: ln.quantity,
    unit_price: ln.unit_price,
    tax_code: ln.tax_code,
    tax_rate: ln.tax_rate,
    tax_code_id: ln.tax_code_id ?? null,
    created_by: userId,
  }));

  const { error: errLines } = await db.from("quote_lines").insert(linesPayload);

  if (errLines) {
    // Compensating delete: cabecera sin líneas no debe quedar. T6-quote
    // permite borrar borradores. Si DELETE falla por red, queda residuo
    // (totals=0) que se limpia aparte.
    await db.from("quotes").delete().eq("tenant_id", tenantId).eq("id", quoteId);
    // El prospect creado inline NO se elimina — datos capturados son trabajo
    // útil aún si la cotización falló. La abogada decide qué hacer.
    if (createdProspectId) {
      console.warn(
        "[finanzas/quotes] createQuote falló post-prospect; el cliente prospect %s queda persistido",
        createdProspectId
      );
    }
    throw new MutationError(pgErrorToMessage(errLines), 400, errLines);
  }

  // ---------- 8. Promover status borrador → emitida ----------
  // Después de migration 014: T1 permite quote|borrador → emitida.
  // Si este UPDATE falla, hacemos compensating delete (la cabecera sigue
  // en 'borrador', T6 lo permite). Las líneas se borran en cascada por el
  // FK ON DELETE CASCADE definido en quote_lines.
  const { error: errPromote } = await db
    .from("quotes")
    .update({ status: "emitida" })
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (errPromote) {
    await db.from("quotes").delete().eq("tenant_id", tenantId).eq("id", quoteId);
    if (createdProspectId) {
      console.warn(
        "[finanzas/quotes] createQuote falló al promover a emitida; el cliente prospect %s queda persistido",
        createdProspectId
      );
    }
    throw new MutationError(pgErrorToMessage(errPromote), 400, errPromote);
  }

  return {
    id: quoteId,
    quote_number: quoteNumber,
    created_prospect_id: createdProspectId,
  };
}

// ---------------------------------------------------------------------------
// DUPLICATE — copiar cotización para reutilizarla (Sprint 2E.4)
// ---------------------------------------------------------------------------

/**
 * Duplica una cotización existente. La nueva nace en `borrador` con:
 *   - Mismo cliente del origen (NOT NULL en BD obliga; la abogada puede
 *     cambiarlo desde el editor, ver banner amarillo en edit page).
 *   - Mismo título, observaciones y T&C (snapshot del origen).
 *   - Todas las líneas copiadas (descripción, cantidad, precios, kind,
 *     tax_code, tax_rate, service_id, tax_code_id). Los totales (subtotal,
 *     tax_amount, line_total) se recalculan automáticamente por el trigger
 *     T8b-quote sobre las líneas insertadas.
 *   - issue_date = hoy, valid_until = hoy + 30 días (cumple el CHECK
 *     quotes_valid_until_check).
 *   - quote_number = nuevo COT-NNNNNN definitivo (consume la secuencia).
 *   - source_quote_id = id del origen (para el banner amarillo en el editor).
 *   - Campos de envío/decisión/cancelación/conversión: todos NULL (lógica
 *     "vida nueva", el ciclo arranca de cero).
 *
 * Permitido desde TODOS los estados del origen (D4) — no hay razón legal
 * ni operativa para bloquearlo.
 *
 * Patrón compensating delete idéntico a createQuote: si la inserción de
 * líneas falla, se borra la cabecera. La cabecera nace 'borrador' (no
 * 'emitida') para que el compensating delete pase T6-quote.
 */
export async function duplicateQuote(
  db: DB,
  tenantId: string,
  userId: string,
  sourceQuoteId: string
): Promise<{ id: string; quote_number: string }> {
  // 1. Cargar quote origen (cabecera).
  const { data: source, error: errSource } = await db
    .from("quotes")
    .select(
      `id, client_id, case_id, title, observations, terms_and_conditions, notes`
    )
    .eq("tenant_id", tenantId)
    .eq("id", sourceQuoteId)
    .maybeSingle();

  if (errSource) throw new MutationError(pgErrorToMessage(errSource), 500, errSource);
  if (!source) throw new MutationError("Cotización origen no encontrada", 404);

  // 2. Cargar líneas del origen (ordenadas por line_order).
  const { data: sourceLines, error: errLines } = await db
    .from("quote_lines")
    .select(
      `line_order, invoice_kind, service_id, description, quantity,
       unit_price, tax_code, tax_rate, tax_code_id`
    )
    .eq("tenant_id", tenantId)
    .eq("quote_id", sourceQuoteId)
    .order("line_order", { ascending: true });

  if (errLines) throw new MutationError(pgErrorToMessage(errLines), 500, errLines);
  if (!sourceLines || sourceLines.length === 0) {
    throw new MutationError(
      "La cotización origen no tiene líneas para duplicar",
      400
    );
  }

  // 3. Calcular totales del nuevo quote (los mismos del origen porque las
  //    líneas se copian tal cual). El trigger T8b-quote los recalcula al
  //    insertar las líneas, pero la cabecera nace consistente.
  const totals = calcTotals(
    sourceLines.map((ln) => ({
      invoice_kind: ln.invoice_kind as QuoteLineKind,
      description: String(ln.description),
      quantity: Number(ln.quantity),
      unit_price: Number(ln.unit_price),
      tax_rate: Number(ln.tax_rate),
      tax_code: String(ln.tax_code),
    }))
  );

  // 4. Consumir secuencia → COT-NNNNNN definitivo.
  const { data: seqResult, error: errSeq } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: QUOTE_SEQUENCE_TYPE,
  });
  if (errSeq || typeof seqResult !== "number") {
    throw new MutationError(pgErrorToMessage(errSeq), 500, errSeq);
  }
  const quoteNumber = `${QUOTE_NUMBER_PREFIX}-${String(seqResult).padStart(6, "0")}`;

  // 5. Calcular fechas. issue_date=hoy, valid_until=hoy+30 (mismo default
  //    que el editor). Cumple CHECK quotes_valid_until_check.
  const today = new Date();
  const issueDateStr = today.toISOString().slice(0, 10);
  const validUntilDate = new Date(today);
  validUntilDate.setDate(validUntilDate.getDate() + 30);
  const validUntilStr = validUntilDate.toISOString().slice(0, 10);

  // 6. INSERT cabecera en 'borrador'.
  //    case_id: solo se copia si el caso pertenece al mismo cliente — como
  //    el cliente puede cambiarse en el editor, dejamos el case_id por
  //    ahora; el form de edición filtra los casos al cliente actual.
  const { data: header, error: errHeader } = await db
    .from("quotes")
    .insert({
      tenant_id: tenantId,
      quote_number: quoteNumber,
      client_id: source.client_id as string,
      case_id: source.case_id as string | null,
      issue_date: issueDateStr,
      valid_until: validUntilStr,
      title: source.title as string,
      status: "borrador",
      currency: "USD",
      subtotal_total: totals.subtotal_total,
      tax_total: totals.tax_total,
      grand_total: totals.grand_total,
      subtotal_hon: totals.subtotal_hon,
      subtotal_rei: totals.subtotal_rei,
      terms_and_conditions: source.terms_and_conditions as string | null,
      notes: source.notes as string | null,
      observations: source.observations as string | null,
      source_quote_id: sourceQuoteId,
      created_by: userId,
    })
    .select("id")
    .single();

  if (errHeader || !header) {
    throw new MutationError(pgErrorToMessage(errHeader), 400, errHeader);
  }

  const newQuoteId = header.id as string;

  // 7. INSERT líneas (nuevo line_order desde 1).
  const linesPayload = sourceLines.map((ln, idx) => ({
    tenant_id: tenantId,
    quote_id: newQuoteId,
    line_order: idx + 1,
    invoice_kind: ln.invoice_kind,
    service_id: (ln.service_id as string | null) ?? null,
    description: ln.description,
    quantity: ln.quantity,
    unit_price: ln.unit_price,
    tax_code: ln.tax_code,
    tax_rate: ln.tax_rate,
    tax_code_id: (ln.tax_code_id as string | null) ?? null,
    created_by: userId,
  }));

  const { error: errInsLines } = await db.from("quote_lines").insert(linesPayload);

  if (errInsLines) {
    // Compensating delete: la cabecera sigue en 'borrador', T6-quote lo permite.
    await db.from("quotes").delete().eq("tenant_id", tenantId).eq("id", newQuoteId);
    throw new MutationError(pgErrorToMessage(errInsLines), 400, errInsLines);
  }

  return { id: newQuoteId, quote_number: quoteNumber };
}

// ---------------------------------------------------------------------------
// UPDATE (solo borradores)
// ---------------------------------------------------------------------------

export async function updateQuote(
  db: DB,
  tenantId: string,
  userId: string,
  quoteId: string,
  input: UpdateQuoteInput
): Promise<{ id: string }> {
  // 1. Verificar status editable (T5b-quote también valida en BD las líneas).
  //    Post-hot-fix QUOTES-FLOW: editable = 'borrador' (legacy) | 'emitida' (default).
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select("id, status, client_id, issue_date, valid_until")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);
  if (quote.status !== "borrador" && quote.status !== "emitida") {
    throw new MutationError(
      `Solo se pueden modificar cotizaciones en borrador o emitidas. Estado actual: '${quote.status}'.`,
      400
    );
  }

  // Hot-fix BUG EDITOR: validar valid_until ≥ issue_date contra los valores
  // EFECTIVOS post-merge (input || persistido). El validator solo cruza si
  // ambos vienen en el payload, así que un edit donde el usuario solo cambia
  // valid_until pasaba el validator y se estrellaba contra el CHECK
  // quotes_valid_until_check con un mensaje feo. Acá lo atrapamos friendly.
  const effectiveIssueDate =
    (input.issue_date as string | undefined) ?? (quote.issue_date as string);
  const effectiveValidUntil =
    (input.valid_until as string | undefined) ?? (quote.valid_until as string);
  if (
    effectiveIssueDate &&
    effectiveValidUntil &&
    effectiveValidUntil < effectiveIssueDate
  ) {
    throw new MutationError(
      "La fecha de vigencia debe ser igual o posterior a la fecha de emisión",
      400
    );
  }

  // 2. UPDATE header con campos cambiados.
  const headerUpdate: Record<string, unknown> = {};
  if (input.client_id !== undefined) headerUpdate.client_id = input.client_id;
  if (input.case_id !== undefined) headerUpdate.case_id = input.case_id;
  if (input.issue_date !== undefined) headerUpdate.issue_date = input.issue_date;
  if (input.valid_until !== undefined) headerUpdate.valid_until = input.valid_until;
  if (input.title !== undefined) headerUpdate.title = input.title;
  if (input.notes !== undefined) headerUpdate.notes = input.notes;
  if (input.observations !== undefined) {
    headerUpdate.observations = normalizeObservations(input.observations);
  }
  if (input.terms_and_conditions !== undefined) {
    headerUpdate.terms_and_conditions = input.terms_and_conditions;
  }

  // Si vienen líneas, recalcular totales y meter en el mismo UPDATE.
  if (input.lines !== undefined) {
    const totals = calcTotals(input.lines);
    headerUpdate.subtotal_total = totals.subtotal_total;
    headerUpdate.tax_total = totals.tax_total;
    headerUpdate.grand_total = totals.grand_total;
    headerUpdate.subtotal_hon = totals.subtotal_hon;
    headerUpdate.subtotal_rei = totals.subtotal_rei;
  }

  if (Object.keys(headerUpdate).length > 0) {
    const { error: errUpd } = await db
      .from("quotes")
      .update(headerUpdate)
      .eq("tenant_id", tenantId)
      .eq("id", quoteId);
    if (errUpd) throw new MutationError(pgErrorToMessage(errUpd), 400, errUpd);
  }

  // 3. Si vienen líneas, reemplazar todas (delete + insert). Más simple que
  //    diff, y a este volumen (1-20 líneas) no hay impacto.
  if (input.lines !== undefined) {
    const { error: errDel } = await db
      .from("quote_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("quote_id", quoteId);
    if (errDel) throw new MutationError(pgErrorToMessage(errDel), 400, errDel);

    const linesPayload = input.lines.map((ln, idx) => ({
      tenant_id: tenantId,
      quote_id: quoteId,
      line_order: idx + 1,
      invoice_kind: ln.invoice_kind,
      service_id: ln.service_id ?? null,
      description: ln.description,
      quantity: ln.quantity,
      unit_price: ln.unit_price,
      tax_code: ln.tax_code,
      tax_rate: ln.tax_rate,
      tax_code_id: ln.tax_code_id ?? null,
      created_by: userId,
    }));
    const { error: errIns } = await db.from("quote_lines").insert(linesPayload);
    if (errIns) throw new MutationError(pgErrorToMessage(errIns), 400, errIns);
  }

  return { id: quoteId };
}

// ---------------------------------------------------------------------------
// DELETE — solo borradores o canceladas pre-envío
// ---------------------------------------------------------------------------

export async function deleteQuote(
  db: DB,
  tenantId: string,
  quoteId: string
): Promise<{ id: string }> {
  // T6-quote bloquea estados no permitidos. Filtrar acá igual para
  // diagnóstico claro.
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);
  if (quote.status !== "borrador" && quote.status !== "cancelada_pre_envio") {
    throw new MutationError(
      `No se puede eliminar una cotización en estado '${quote.status}'. Solo borradores o canceladas pre-envío.`,
      400
    );
  }

  // Sprint 2E.3 D9: limpiar PDFs auto-generados antes de borrar la
  // cotización (no hay FK porque documents es polimórfico — la limpieza
  // explícita evita filas huérfanas y blobs olvidados en Storage).
  const { data: autoPdfs } = await db
    .from("documents")
    .select("id, storage_key")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "quote")
    .eq("entity_id", quoteId)
    .eq("source", "auto_quote_pdf");

  for (const row of autoPdfs ?? []) {
    const storageKey = (row as { storage_key: string | null }).storage_key;
    if (storageKey) {
      await db.storage.from("documents").remove([storageKey]);
    }
    await db
      .from("documents")
      .delete()
      .eq("id", (row as { id: string }).id)
      .eq("tenant_id", tenantId);
  }

  const { error } = await db
    .from("quotes")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (error) throw new MutationError(pgErrorToMessage(error), 400, error);
  return { id: quoteId };
}

// ---------------------------------------------------------------------------
// CANCEL pre-envío (admin descarta borrador con razón)
// ---------------------------------------------------------------------------

export async function cancelQuote(
  db: DB,
  tenantId: string,
  quoteId: string,
  reason: string | null
): Promise<{ id: string }> {
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);
  // Post-hot-fix QUOTES-FLOW: cancelable = 'borrador' (legacy) | 'emitida' (default).
  // Para 'emitida' es el escape hatch obligatorio (T6 bloquea delete).
  if (quote.status !== "borrador" && quote.status !== "emitida") {
    throw new MutationError(
      `Solo se pueden cancelar cotizaciones en borrador o emitidas. Estado actual: '${quote.status}'.`,
      400
    );
  }

  const { error } = await db
    .from("quotes")
    .update({
      status: "cancelada_pre_envio",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (error) throw new MutationError(pgErrorToMessage(error), 400, error);
  return { id: quoteId };
}

// ---------------------------------------------------------------------------
// SEND — enviar al cliente (genera public_token; envío de email diferido a 2E.3)
// ---------------------------------------------------------------------------

export async function sendQuote(
  db: DB,
  tenantId: string,
  userId: string,
  quoteId: string,
  input: SendQuoteInput
): Promise<{ id: string; public_token: string }> {
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);
  // Post-hot-fix QUOTES-FLOW: enviable = 'borrador' (legacy) | 'emitida' (default).
  if (quote.status !== "borrador" && quote.status !== "emitida") {
    throw new MutationError(
      `Solo se pueden enviar cotizaciones en borrador o emitidas. Estado actual: '${quote.status}'.`,
      400
    );
  }

  // Verificar que tiene al menos una línea.
  const { count, error: errCount } = await db
    .from("quote_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("quote_id", quoteId);
  if (errCount) throw new MutationError(pgErrorToMessage(errCount), 500, errCount);
  if (!count || count === 0) {
    throw new MutationError(
      "La cotización no tiene líneas. Agrega al menos una antes de enviar.",
      400
    );
  }

  const publicToken = generatePublicToken();

  const { error } = await db
    .from("quotes")
    .update({
      status: "enviada",
      public_token: publicToken,
      sent_at: new Date().toISOString(),
      sent_to_email: input.sent_to_email,
      sent_by: userId,
    })
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (error) throw new MutationError(pgErrorToMessage(error), 400, error);

  // TODO(2E.3): integrar Resend.send acá para mandar el email con el link
  // del portal usando publicToken.

  return { id: quoteId, public_token: publicToken };
}

// ---------------------------------------------------------------------------
// RESEND — reenviar cotización ya enviada/aceptada/rechazada (Sprint 2E.3 hotfix)
// ---------------------------------------------------------------------------

/**
 * Reenviar la cotización a una dirección (puede ser la misma o distinta a la
 * original). NO toca status: una cotización ya 'enviada' sigue 'enviada',
 * 'aceptada' sigue 'aceptada', 'rechazada' sigue 'rechazada'. Solo refresca
 * sent_at / sent_to_email / sent_by para reflejar el último envío, y conserva
 * el mismo public_token (el link del portal no cambia).
 *
 * El caller (route handler) hace el envío del email y la materialización del
 * PDF. Esta función solo se ocupa de la transición de columnas en BD y de la
 * auditoría.
 *
 * Retorna el public_token y los datos previos para que el caller los registre
 * en audit_log.
 */
export async function resendQuote(
  db: DB,
  tenantId: string,
  userId: string,
  quoteId: string,
  input: SendQuoteInput
): Promise<{
  id: string;
  public_token: string;
  previous_sent_at: string | null;
  previous_sent_to_email: string | null;
}> {
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select("id, status, public_token, sent_at, sent_to_email")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);

  const allowedStatuses = ["enviada", "aceptada", "rechazada"];
  if (!allowedStatuses.includes(quote.status as string)) {
    throw new MutationError(
      `Solo se pueden reenviar cotizaciones en estado enviada/aceptada/rechazada. Estado actual: '${quote.status}'.`,
      400
    );
  }

  // El public_token debería existir desde el envío original; si por algún
  // motivo está NULL (cotizaciones legacy), generamos uno nuevo.
  const publicToken =
    (quote.public_token as string | null) ?? generatePublicToken();

  const { error } = await db
    .from("quotes")
    .update({
      // status NO se toca.
      public_token: publicToken,
      sent_at: new Date().toISOString(),
      sent_to_email: input.sent_to_email,
      sent_by: userId,
    })
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (error) throw new MutationError(pgErrorToMessage(error), 400, error);

  return {
    id: quoteId,
    public_token: publicToken,
    previous_sent_at: (quote.sent_at as string | null) ?? null,
    previous_sent_to_email: (quote.sent_to_email as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// MARK ACCEPTED MANUAL — escape hatch (D1) cuando el cliente acepta offline
// ---------------------------------------------------------------------------

export async function markAcceptedManual(
  db: DB,
  tenantId: string,
  _userId: string,
  quoteId: string
): Promise<{ id: string }> {
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);
  if (quote.status !== "enviada") {
    throw new MutationError(
      `Solo se pueden aceptar cotizaciones en estado 'enviada'. Estado actual: '${quote.status}'.`,
      400
    );
  }

  const { error } = await db
    .from("quotes")
    .update({
      status: "aceptada",
      approved_at: new Date().toISOString(),
      // approved_by_ip / user_agent quedan NULL = aceptación manual (no portal).
      approved_by_ip: null,
      approved_by_user_agent: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (error) throw new MutationError(pgErrorToMessage(error), 400, error);
  return { id: quoteId };
}

// ---------------------------------------------------------------------------
// MARK REJECTED MANUAL — escape hatch (D5: razón opcional)
// ---------------------------------------------------------------------------

export async function markRejectedManual(
  db: DB,
  tenantId: string,
  _userId: string,
  quoteId: string,
  reason: string | null
): Promise<{ id: string }> {
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);
  if (quote.status !== "enviada") {
    throw new MutationError(
      `Solo se pueden rechazar cotizaciones en estado 'enviada'. Estado actual: '${quote.status}'.`,
      400
    );
  }

  const { error } = await db
    .from("quotes")
    .update({
      status: "rechazada",
      rejected_at: new Date().toISOString(),
      rejected_by_ip: null,
      rejected_by_user_agent: null,
      rejection_reason: reason,
    })
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (error) throw new MutationError(pgErrorToMessage(error), 400, error);
  return { id: quoteId };
}

// ---------------------------------------------------------------------------
// CONVERT — generar facturas (1 por invoice_kind presente; D2)
// ---------------------------------------------------------------------------

/**
 * Convierte una cotización aceptada en 1 o 2 facturas (una por invoice_kind
 * presente en las líneas).
 *
 * Validaciones:
 *   - status='aceptada'
 *   - cliente.client_status='active' (sino el gate de createInvoice rebota)
 *   - hay al menos una línea
 *
 * Compensating: si la creación de la 2da factura falla, dropeamos la 1ra
 * para no dejar facturas huérfanas. Si el UPDATE final del quote falla,
 * dropeamos ambas facturas.
 */
export async function convertToInvoices(
  db: DB,
  tenantId: string,
  userId: string,
  quoteId: string
): Promise<{ invoice_ids: string[] }> {
  // 1. Cargar quote con líneas y cliente.
  const { data: quote, error: errFetch } = await db
    .from("quotes")
    .select(
      `
        id, status, client_id, case_id, quote_number,
        client:clients!quotes_client_id_fkey(id, client_status, default_payment_terms_days)
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", quoteId)
    .maybeSingle();

  if (errFetch) throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  if (!quote) throw new MutationError("Cotización no encontrada", 404);
  if (quote.status !== "aceptada") {
    throw new MutationError(
      `Solo se pueden convertir cotizaciones aceptadas. Estado actual: '${quote.status}'.`,
      400
    );
  }

  // Supabase devuelve relations como objeto único cuando es FK simple, pero
  // en algunos shapes lo serializa como array. Manejamos ambos.
  const clientRaw = quote.client as
    | { id: string; client_status: string; default_payment_terms_days: number | null }
    | { id: string; client_status: string; default_payment_terms_days: number | null }[]
    | null;
  const client = Array.isArray(clientRaw) ? clientRaw[0] : clientRaw;

  if (!client) {
    throw new MutationError("La cotización no tiene cliente asociado", 500);
  }
  if (client.client_status !== "active") {
    const stateLabel = client.client_status === "prospect" ? "prospecto" : client.client_status;
    throw new MutationError(
      `No se puede convertir: el cliente está en estado '${stateLabel}'. Promueve el cliente a activo desde el módulo Clientes antes de convertir.`,
      400
    );
  }

  // 2. Cargar líneas y agrupar por invoice_kind.
  const { data: lines, error: errLines } = await db
    .from("quote_lines")
    .select(
      `id, line_order, service_id, description, quantity, unit_price,
       tax_code, tax_rate, tax_code_id, invoice_kind`
    )
    .eq("tenant_id", tenantId)
    .eq("quote_id", quoteId)
    .order("line_order", { ascending: true });

  if (errLines) throw new MutationError(pgErrorToMessage(errLines), 500, errLines);
  if (!lines || lines.length === 0) {
    throw new MutationError("La cotización no tiene líneas para convertir", 400);
  }

  const groupedLines: Record<QuoteLineKind, typeof lines> = { HON: [], REI: [] };
  for (const ln of lines) {
    groupedLines[ln.invoice_kind as QuoteLineKind].push(ln);
  }

  // 3. Calcular due_date desde default_payment_terms_days (default = 0 = al acto).
  const today = new Date();
  const issueDateStr = today.toISOString().slice(0, 10);
  const termDays = client.default_payment_terms_days ?? 0;
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + termDays);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  // 4. Crear facturas (HON primero, después REI).
  const createdInvoiceIds: string[] = [];
  const kinds: QuoteLineKind[] = ["HON", "REI"];

  for (const kind of kinds) {
    const groupLines = groupedLines[kind];
    if (groupLines.length === 0) continue;

    try {
      const result = await createInvoice(db, tenantId, userId, {
        invoice_kind: kind === "HON" ? "HONORARIOS" : "REEMBOLSO",
        client_id: quote.client_id as string,
        case_id: (quote.case_id as string | null) ?? null,
        issue_date: issueDateStr,
        due_date: dueDateStr,
        notes: `Generada desde cotización ${quote.quote_number}`,
        lines: groupLines.map((l) => ({
          service_id: (l.service_id as string | null) ?? null,
          description: l.description as string,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          tax_code: l.tax_code as string,
          tax_rate: Number(l.tax_rate),
          // tax_code_id es required en CreateInvoiceInput.lines (string), pero
          // el DB column es nullable. Si la línea de quote no lo tiene, le
          // pasamos string vacío y el DB lo aceptará como null vía coerción
          // del driver. Igual el validator de la ROUTE handler de invoice
          // exige UUID válido — no se aplica acá porque llamamos al helper
          // directamente, sin pasar por el validator.
          tax_code_id: (l.tax_code_id as string | null) ?? "",
        })),
      });
      createdInvoiceIds.push(result.id);
    } catch (err) {
      // Compensating: borrar facturas previas del mismo convert.
      for (const id of createdInvoiceIds) {
        await db.from("invoices").delete().eq("tenant_id", tenantId).eq("id", id);
      }
      throw err;
    }
  }

  // 5. UPDATE quote → status='convertida' + array de invoice_ids.
  const { error: errUpd } = await db
    .from("quotes")
    .update({
      status: "convertida",
      converted_at: new Date().toISOString(),
      converted_invoice_ids: createdInvoiceIds,
      converted_by: userId,
    })
    .eq("tenant_id", tenantId)
    .eq("id", quoteId);

  if (errUpd) {
    // Compensating: borrar las facturas recién creadas.
    for (const id of createdInvoiceIds) {
      await db.from("invoices").delete().eq("tenant_id", tenantId).eq("id", id);
    }
    throw new MutationError(pgErrorToMessage(errUpd), 400, errUpd);
  }

  return { invoice_ids: createdInvoiceIds };
}

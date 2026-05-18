/**
 * Helpers server-side del portal público de cotizaciones (Sprint 2E.4).
 *
 * Patrón consistente con api/quotes.ts: admin client + filtros manuales.
 * Las funciones acceptQuoteFromPortal/rejectQuoteFromPortal son los puntos
 * de entrada que orquestan toda la cascada documentada en P5/P6.
 *
 * Política de errores:
 *   - El paso crítico (status='aceptada' + insert audit log) es atómico:
 *     si falla, la operación retorna error y el cliente reintenta.
 *   - Los pasos best-effort post-aceptación (PDF firmado, convertToInvoices,
 *     emails) NO bloquean la respuesta exitosa al cliente: si fallan se
 *     loggean y la abogada puede completarlos manualmente desde el CRM.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import {
  ACCEPTANCE_FULL_NAME_MAX,
  ACCEPTANCE_FULL_NAME_MIN,
  ACCEPTANCE_ID_DOCUMENT_MAX,
  ACCEPTANCE_ID_DOCUMENT_MIN,
  ACCEPTANCE_POSITION_MAX,
  ACCEPTANCE_POSITION_MIN,
  REJECTION_REASON_MAX,
  REJECTION_REASON_MIN,
  CONSENT_TEXT_VERSION,
  buildConsentText,
  type AcceptQuoteInput,
  type PortalRequestContext,
  type RejectQuoteInput,
} from "@/lib/finanzas/types/quote-acceptance";
import {
  getQuoteForPortal,
  isQuoteExpired,
  type PortalQuoteBundle,
} from "@/lib/finanzas/queries/quote-portal";

type DB = SupabaseClient;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export type PortalValidationErrors = Record<string, string>;

export type PortalValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: PortalValidationErrors };

export function validateAcceptInput(
  raw: Partial<AcceptQuoteInput>
): PortalValidationResult<AcceptQuoteInput> {
  const errors: PortalValidationErrors = {};
  const full_name = String(raw?.full_name ?? "").trim();
  const position = String(raw?.position ?? "").trim();
  const idDocRaw = raw?.id_document == null ? "" : String(raw.id_document).trim();
  const consent = !!raw?.consent_accepted;

  if (full_name.length < ACCEPTANCE_FULL_NAME_MIN) {
    errors.full_name = `Nombre completo requerido (mínimo ${ACCEPTANCE_FULL_NAME_MIN} caracteres)`;
  } else if (full_name.length > ACCEPTANCE_FULL_NAME_MAX) {
    errors.full_name = `Nombre completo máximo ${ACCEPTANCE_FULL_NAME_MAX} caracteres`;
  }

  if (position.length < ACCEPTANCE_POSITION_MIN) {
    errors.position = `Cargo requerido (mínimo ${ACCEPTANCE_POSITION_MIN} caracteres)`;
  } else if (position.length > ACCEPTANCE_POSITION_MAX) {
    errors.position = `Cargo máximo ${ACCEPTANCE_POSITION_MAX} caracteres`;
  }

  if (idDocRaw.length > 0) {
    if (idDocRaw.length < ACCEPTANCE_ID_DOCUMENT_MIN) {
      errors.id_document = `Documento mínimo ${ACCEPTANCE_ID_DOCUMENT_MIN} caracteres si lo agregas`;
    } else if (idDocRaw.length > ACCEPTANCE_ID_DOCUMENT_MAX) {
      errors.id_document = `Documento máximo ${ACCEPTANCE_ID_DOCUMENT_MAX} caracteres`;
    }
  }

  if (!consent) {
    errors.consent_accepted = "Necesitas confirmar los términos para aceptar";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      full_name,
      position,
      id_document: idDocRaw.length > 0 ? idDocRaw : null,
      consent_accepted: true,
    },
  };
}

export function validateRejectInput(
  raw: Partial<RejectQuoteInput>
): PortalValidationResult<RejectQuoteInput> {
  const reason = String(raw?.reason ?? "").trim();
  const errors: PortalValidationErrors = {};

  if (reason.length < REJECTION_REASON_MIN) {
    errors.reason = `Cuéntanos brevemente por qué no procedes (mínimo ${REJECTION_REASON_MIN} caracteres)`;
  } else if (reason.length > REJECTION_REASON_MAX) {
    errors.reason = `Máximo ${REJECTION_REASON_MAX} caracteres`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return { ok: true, errors: null, data: { reason } };
}

// ---------------------------------------------------------------------------
// Helpers internos: cargar quote y validar elegibilidad
// ---------------------------------------------------------------------------

/**
 * Carga la cotización por token y valida que sea elegible para una acción
 * pública (aceptar/rechazar):
 *   - existe
 *   - status='enviada' (no fue ya aceptada/rechazada)
 *   - no vencida (valid_until >= hoy en hora Panamá)
 *
 * Si no es elegible, lanza MutationError con mensaje cliente-friendly.
 */
async function loadEligibleQuote(
  db: DB,
  token: string
): Promise<PortalQuoteBundle> {
  const bundle = await getQuoteForPortal(db, token);
  if (!bundle) {
    throw new MutationError("No encontramos esta cotización", 404);
  }

  if (isQuoteExpired(bundle.valid_until)) {
    throw new MutationError(
      "Esta cotización venció. Contacta al bufete para una cotización actualizada.",
      400
    );
  }

  if (bundle.status === "aceptada") {
    throw new MutationError(
      "Esta cotización ya fue aceptada previamente.",
      400
    );
  }
  if (bundle.status === "rechazada") {
    throw new MutationError(
      "Esta cotización ya fue rechazada previamente. Si necesitas cambiar tu decisión, contacta al bufete.",
      400
    );
  }
  if (bundle.status === "convertida") {
    throw new MutationError(
      "Esta cotización ya fue convertida en facturas. Contacta al bufete para más información.",
      400
    );
  }
  if (bundle.status !== "enviada") {
    throw new MutationError(
      `Esta cotización no se puede aceptar ni rechazar (estado: ${bundle.status}).`,
      400
    );
  }

  return bundle;
}

// ---------------------------------------------------------------------------
// Acceptance — flujo crítico atómico
// ---------------------------------------------------------------------------

export interface AcceptResult {
  bundle: PortalQuoteBundle;
  acceptance_id: string;
  signature_text: string;
  accepted_at: string;
}

/**
 * Paso atómico de aceptación: INSERT en quote_acceptances + UPDATE de
 * quotes (status='aceptada' + columnas legacy denormalizadas, D3).
 *
 * NO ejecuta la cascada post-aceptación (PDF firmado, convertToInvoices,
 * emails) — esa es responsabilidad de runAcceptancePostHooks() y se
 * invoca después para que la falla de un paso best-effort no rollbackee
 * la aceptación legalmente vinculante.
 *
 * Si quote_acceptances.unique_per_quote dispara, MutationError 409
 * (race condition: el cliente clickeó dos veces).
 */
export async function commitAcceptance(
  db: DB,
  token: string,
  input: AcceptQuoteInput,
  ctx: PortalRequestContext
): Promise<AcceptResult> {
  const bundle = await loadEligibleQuote(db, token);

  const signature_text = buildConsentText({
    full_name: input.full_name,
    position: input.position,
    id_document: input.id_document,
    client_name: bundle.client.name,
    quote_number: bundle.quote_number,
  });

  const acceptedAtIso = new Date().toISOString();

  // 1. INSERT audit log (source of truth).
  const { data: acceptanceRow, error: errAcc } = await db
    .from("quote_acceptances")
    .insert({
      tenant_id: bundle.tenant_id,
      quote_id: bundle.id,
      accepted_at: acceptedAtIso,
      full_name: input.full_name,
      position: input.position,
      id_document: input.id_document,
      ip_address: ctx.ip_address,
      user_agent: ctx.user_agent,
      origin_url: ctx.origin_url,
      consent_text_version: CONSENT_TEXT_VERSION,
      signature_text,
    })
    .select("id")
    .single();

  if (errAcc || !acceptanceRow) {
    // 23505 = unique_violation (quote_acceptances_unique_per_quote).
    const code = (errAcc as { code?: string } | null)?.code;
    if (code === "23505") {
      throw new MutationError(
        "Esta cotización ya fue aceptada (doble clic). Recarga la página.",
        409,
        errAcc
      );
    }
    throw new MutationError(pgErrorToMessage(errAcc), 400, errAcc);
  }

  // 2. UPDATE quote: status + columnas legacy denormalizadas (D3).
  const { error: errUpd } = await db
    .from("quotes")
    .update({
      status: "aceptada",
      approved_at: acceptedAtIso,
      approved_by_ip: ctx.ip_address,
      approved_by_user_agent: ctx.user_agent,
    })
    .eq("tenant_id", bundle.tenant_id)
    .eq("id", bundle.id);

  if (errUpd) {
    // Compensating: deshacer la fila de aceptación para no dejar audit
    // log huérfano sin transición de estado. Idempotente.
    await db
      .from("quote_acceptances")
      .delete()
      .eq("id", acceptanceRow.id)
      .eq("tenant_id", bundle.tenant_id);
    throw new MutationError(pgErrorToMessage(errUpd), 400, errUpd);
  }

  return {
    bundle: {
      ...bundle,
      status: "aceptada",
      approved_at: acceptedAtIso,
    },
    acceptance_id: acceptanceRow.id as string,
    signature_text,
    accepted_at: acceptedAtIso,
  };
}

// ---------------------------------------------------------------------------
// Rejection — flujo crítico atómico
// ---------------------------------------------------------------------------

export interface RejectResult {
  bundle: PortalQuoteBundle;
  rejection_id: string;
  rejected_at: string;
  reason: string;
}

export async function commitRejection(
  db: DB,
  token: string,
  input: RejectQuoteInput,
  ctx: PortalRequestContext
): Promise<RejectResult> {
  const bundle = await loadEligibleQuote(db, token);
  const rejectedAtIso = new Date().toISOString();

  const { data: rejectionRow, error: errRej } = await db
    .from("quote_rejections")
    .insert({
      tenant_id: bundle.tenant_id,
      quote_id: bundle.id,
      rejected_at: rejectedAtIso,
      reason: input.reason,
      ip_address: ctx.ip_address,
      user_agent: ctx.user_agent,
      origin_url: ctx.origin_url,
    })
    .select("id")
    .single();

  if (errRej || !rejectionRow) {
    const code = (errRej as { code?: string } | null)?.code;
    if (code === "23505") {
      throw new MutationError(
        "Esta cotización ya fue rechazada (doble clic). Recarga la página.",
        409,
        errRej
      );
    }
    throw new MutationError(pgErrorToMessage(errRej), 400, errRej);
  }

  const { error: errUpd } = await db
    .from("quotes")
    .update({
      status: "rechazada",
      rejected_at: rejectedAtIso,
      rejected_by_ip: ctx.ip_address,
      rejected_by_user_agent: ctx.user_agent,
      rejection_reason: input.reason,
    })
    .eq("tenant_id", bundle.tenant_id)
    .eq("id", bundle.id);

  if (errUpd) {
    await db
      .from("quote_rejections")
      .delete()
      .eq("id", rejectionRow.id)
      .eq("tenant_id", bundle.tenant_id);
    throw new MutationError(pgErrorToMessage(errUpd), 400, errUpd);
  }

  return {
    bundle: {
      ...bundle,
      status: "rechazada",
      rejected_at: rejectedAtIso,
    },
    rejection_id: rejectionRow.id as string,
    rejected_at: rejectedAtIso,
    reason: input.reason,
  };
}

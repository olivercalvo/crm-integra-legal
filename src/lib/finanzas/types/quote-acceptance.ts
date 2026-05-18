/**
 * Tipos del módulo Cotizaciones — Portal público / FES (Sprint 2E.4).
 *
 * quote_acceptances y quote_rejections son tablas nuevas creadas en
 * sql/pending/015. La app las popula desde el portal /cotizacion/[token].
 *
 * Las columnas legacy en quotes (approved_at, approved_by_ip, etc.) se
 * mantienen y la app las actualiza en paralelo (D3) para queries rápidas
 * en el listado del CRM sin joins extra.
 */

// ---------- Versionado del consent FES ----------------------------------

/**
 * Versión del template del consent FES. Si se cambia el texto del consent,
 * incrementar acá y mantener el viejo en la BD (cada fila guarda su
 * `consent_text_version` + el `signature_text` exacto que vio el cliente).
 */
export const CONSENT_TEXT_VERSION = "v1-2026-05" as const;

/**
 * Plantilla del consent FES. Se rellena con los datos del cliente y la
 * cotización antes de mostrársela. NO modificar sin bumpar CONSENT_TEXT_VERSION.
 *
 * Referencia legal: Ley 51 de 2008 — República de Panamá — Documentos
 * Electrónicos y Firmas Electrónicas.
 */
export function buildConsentText(params: {
  full_name: string;
  position: string;
  id_document: string | null;
  client_name: string;
  quote_number: string;
}): string {
  const docPart =
    params.id_document && params.id_document.trim().length > 0
      ? `, con documento de identidad ${params.id_document.trim()}`
      : "";

  return (
    `Yo, ${params.full_name}, en mi calidad de ${params.position}${docPart}, ` +
    `acepto en nombre de ${params.client_name} los términos y condiciones de la ` +
    `cotización ${params.quote_number} emitida por Integra Legal (Panamá). ` +
    `Reconozco que esta aceptación constituye un acuerdo vinculante y tiene ` +
    `validez legal según la Ley 51 de 2008 de la República de Panamá ` +
    `(Ley de Documentos Electrónicos y Firmas Electrónicas).`
  );
}

// ---------- Límites de validación ----------------------------------------

export const ACCEPTANCE_FULL_NAME_MIN = 3;
export const ACCEPTANCE_FULL_NAME_MAX = 120;
export const ACCEPTANCE_POSITION_MIN = 2;
export const ACCEPTANCE_POSITION_MAX = 100;
export const ACCEPTANCE_ID_DOCUMENT_MIN = 3;
export const ACCEPTANCE_ID_DOCUMENT_MAX = 30;
export const REJECTION_REASON_MIN = 10;
export const REJECTION_REASON_MAX = 1000;

// ---------- Inputs desde el portal --------------------------------------

export interface AcceptQuoteInput {
  full_name: string;
  position: string;
  id_document: string | null;
  /** El cliente debe haber tildado el checkbox del consent. */
  consent_accepted: boolean;
}

export interface RejectQuoteInput {
  reason: string;
}

// ---------- Contexto técnico capturado server-side ---------------------

export interface PortalRequestContext {
  ip_address: string | null;
  user_agent: string | null;
  origin_url: string | null;
}

// ---------- Filas DB (lectura) ----------------------------------------

export interface QuoteAcceptanceRow {
  id: string;
  tenant_id: string;
  quote_id: string;
  accepted_at: string;
  full_name: string;
  position: string;
  id_document: string | null;
  ip_address: string | null;
  user_agent: string | null;
  origin_url: string | null;
  geolocation: unknown | null;
  consent_text_version: string;
  signature_text: string;
  created_at: string;
}

export interface QuoteRejectionRow {
  id: string;
  tenant_id: string;
  quote_id: string;
  rejected_at: string;
  reason: string;
  ip_address: string | null;
  user_agent: string | null;
  origin_url: string | null;
  created_at: string;
}

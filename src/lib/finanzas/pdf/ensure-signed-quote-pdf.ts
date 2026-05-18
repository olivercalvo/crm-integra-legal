/**
 * Generación + persistencia del PDF firmado de una cotización aceptada
 * (Sprint 2E.4).
 *
 * Diferencia con ensure-quote-pdf.ts:
 *   - Source: 'auto_signed_quote_pdf' (vs 'auto_quote_pdf').
 *   - Path: tenants/{tenant_id}/clientes/{client_id}/propuestas-aceptadas/
 *     COT-XXXXXX-firmada-{timestamp}.pdf (vs current.pdf en quote_pdf/).
 *   - Registra DOS rows en `documents` cuando la cotización tiene case_id:
 *     una con entity_type='client' (entity_id=client_id), otra con
 *     entity_type='case' (entity_id=case_id). Ambas apuntan al mismo
 *     storage_key (D4: un archivo, dos vistas).
 *   - El PDF incluye la página final EVIDENCIA DE ACEPTACIÓN ELECTRÓNICA
 *     (props.acceptance_evidence).
 *
 * NO cache por hash — cada aceptación genera un PDF único e inmutable
 * (timestamped en el path). Re-llamar a este helper sube otro archivo;
 * el flujo normal solo lo invoca una vez tras aceptación exitosa.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchQuotePdfBundle,
  buildQuoteDocumentProps,
} from "@/lib/finanzas/pdf/quote-pdf-data";
import { generateQuotePdfBuffer } from "@/lib/finanzas/pdf/generate-quote-pdf";
import type { QuoteAcceptanceEvidence } from "@/lib/finanzas/pdf/QuoteDocument";

type DB = SupabaseClient;

const BUCKET = "documents";

export interface EnsureSignedQuotePdfInput {
  tenantId: string;
  userId: string | null;          // null si la acción es del portal público
  quoteId: string;
  clientId: string;
  caseId: string | null;
  acceptanceRowId: string;
  full_name: string;
  position: string;
  id_document: string | null;
  accepted_at_iso: string;
  ip_address: string | null;
  user_agent: string | null;
  origin_url: string | null;
  consent_text_version: string;
  signature_text: string;
}

export interface EnsureSignedQuotePdfResult {
  storage_key: string;
  file_name: string;
  buffer: Buffer;
  evidence_hash: string;
  document_ids: string[];          // 1 o 2 ids
}

/**
 * Formatea un Date ISO UTC a "DD/MM/YYYY HH:mm:ss · UTC-5" hora Panamá.
 */
function formatPanamaTimestamp(isoUtc: string): string {
  const d = new Date(isoUtc);
  const fmt = new Intl.DateTimeFormat("es-PA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get(
    "minute"
  )}:${get("second")} · UTC-5`;
}

/**
 * Hash SHA-256 sobre los campos del audit log + identificadores de la
 * cotización. Permite verificar a futuro que la evidencia impresa en el
 * PDF no fue alterada. NO incluye campos cambiantes (consent_text_version
 * ya es estable per-evidence).
 */
function computeEvidenceHash(input: EnsureSignedQuotePdfInput): string {
  const payload = JSON.stringify({
    quote_id: input.quoteId,
    acceptance_id: input.acceptanceRowId,
    full_name: input.full_name,
    position: input.position,
    id_document: input.id_document ?? null,
    accepted_at_iso: input.accepted_at_iso,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    origin_url: input.origin_url ?? null,
    consent_text_version: input.consent_text_version,
    signature_text: input.signature_text,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Genera el PDF firmado y lo persiste:
 *   1. Carga el bundle del quote (lines + client + case + T&C…)
 *   2. Calcula el evidence_hash sobre el audit log
 *   3. Renderiza React-PDF con acceptance_evidence
 *   4. Sube a Storage (path único por timestamp — no se sobreescribe)
 *   5. INSERT 1 row en documents con entity_type='client'
 *   6. Si caseId presente: INSERT row extra con entity_type='case'
 *
 * Si CUALQUIER paso falla, lanza Error con mensaje en español. El caller
 * decide si abortar la cascada o continuar (best-effort).
 */
export async function ensureSignedQuotePdf(
  db: DB,
  input: EnsureSignedQuotePdfInput
): Promise<EnsureSignedQuotePdfResult> {
  // 1. Bundle base del PDF.
  const bundle = await fetchQuotePdfBundle(db, input.tenantId, input.quoteId);
  if (!bundle) {
    throw new Error(
      `No se pudo cargar la cotización ${input.quoteId} para el PDF firmado`
    );
  }

  // 2. Hash de la evidencia.
  const evidence_hash = computeEvidenceHash(input);

  // 3. Renderizar PDF con la página de evidencia.
  const docProps = buildQuoteDocumentProps(bundle, {
    generated_at: new Date(input.accepted_at_iso),
    generated_by_name: null,
  });

  const evidence: QuoteAcceptanceEvidence = {
    full_name: input.full_name,
    position: input.position,
    id_document: input.id_document,
    accepted_at_iso: input.accepted_at_iso,
    accepted_at_panama: formatPanamaTimestamp(input.accepted_at_iso),
    ip_address: input.ip_address,
    user_agent: input.user_agent,
    origin_url: input.origin_url,
    consent_text_version: input.consent_text_version,
    signature_text: input.signature_text,
    evidence_hash,
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateQuotePdfBuffer({
      ...docProps,
      acceptance_evidence: evidence,
    });
  } catch (err) {
    console.error("[finanzas/pdf] ensureSignedQuotePdf render failed", err);
    throw new Error("No se pudo generar el PDF firmado");
  }

  // 4. Subir a Storage. Path único timestampado para inmutabilidad.
  const timestamp = input.accepted_at_iso.replace(/[:.]/g, "-");
  const fileName = `${bundle.quote.quote_number}-firmada-${timestamp}.pdf`;
  const storagePath = `tenants/${input.tenantId}/clientes/${input.clientId}/propuestas-aceptadas/${fileName}`;

  const { error: errUpload } = await db.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,             // NO sobreescribir — cada aceptación es única
    });

  if (errUpload) {
    console.error("[finanzas/pdf] ensureSignedQuotePdf upload failed", errUpload);
    throw new Error("No se pudo subir el PDF firmado a Storage");
  }

  // 5/6. Registrar en documents.
  const documentIds: string[] = [];

  // uploaded_by es NOT NULL en el schema. Para acciones del portal público
  // no tenemos un user del CRM — usamos el created_by del quote como
  // fallback (la abogada que creó la cotización).
  let uploadedBy = input.userId;
  if (!uploadedBy) {
    const { data: q } = await db
      .from("quotes")
      .select("created_by")
      .eq("tenant_id", input.tenantId)
      .eq("id", input.quoteId)
      .maybeSingle();
    uploadedBy = (q?.created_by as string | null) ?? null;
  }
  if (!uploadedBy) {
    throw new Error(
      "No se pudo determinar uploaded_by para el PDF firmado (created_by NULL en quotes)"
    );
  }

  const baseDocPayload = {
    tenant_id: input.tenantId,
    file_name: fileName,
    file_path: storagePath,
    storage_key: storagePath,
    uploaded_by: uploadedBy,
    source: "auto_signed_quote_pdf",
    source_version: 1,
    source_generated_at: input.accepted_at_iso,
    source_content_hash: evidence_hash,
  };

  const { data: clientDoc, error: errInsClient } = await db
    .from("documents")
    .insert({
      ...baseDocPayload,
      entity_type: "client",
      entity_id: input.clientId,
    })
    .select("id")
    .single();

  if (errInsClient || !clientDoc) {
    console.error(
      "[finanzas/pdf] ensureSignedQuotePdf documents insert (client) failed",
      errInsClient
    );
    throw new Error("PDF firmado generado pero no se pudo registrar (cliente)");
  }
  documentIds.push(clientDoc.id as string);

  if (input.caseId) {
    const { data: caseDoc, error: errInsCase } = await db
      .from("documents")
      .insert({
        ...baseDocPayload,
        entity_type: "case",
        entity_id: input.caseId,
      })
      .select("id")
      .single();

    if (errInsCase || !caseDoc) {
      console.error(
        "[finanzas/pdf] ensureSignedQuotePdf documents insert (case) failed",
        errInsCase
      );
      // NO throw — ya quedó visible desde cliente; el row del caso queda
      // como TODO operativo manual.
      console.warn(
        "[finanzas/pdf] el PDF firmado quedó visible desde cliente pero NO desde el caso. Inserción manual pendiente."
      );
    } else {
      documentIds.push(caseDoc.id as string);
    }
  }

  return {
    storage_key: storagePath,
    file_name: fileName,
    buffer: pdfBuffer,
    evidence_hash,
    document_ids: documentIds,
  };
}

/**
 * Helper compartido por:
 *   - GET  /api/finanzas/quotes/[id]/pdf   (descarga manual desde UI)
 *   - POST /api/finanzas/quotes/[id]/send  (envío email con PDF adjunto)
 *
 * Responsabilidad: garantizar que el row `documents` con
 * `source='auto_quote_pdf'` para el quote esté al día con el contenido
 * actual del quote, y devolver el storage_key + versión. Si el contenido
 * cambió (hash difiere) o el row no existe, regenera el PDF, upsertea
 * el blob en Storage y actualiza/crea el row.
 *
 * No emite signed URLs — cada caller decide qué hacer con el storage_key.
 *
 * Sprint 2E.3, D3 + D4.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchQuotePdfBundle,
  buildQuotePdfPayload,
  buildQuoteDocumentProps,
  type QuotePdfBundle,
} from "@/lib/finanzas/pdf/quote-pdf-data";
import { computeQuoteContentHash } from "@/lib/finanzas/api/quote-pdf-hash";
import { generateQuotePdfBuffer } from "@/lib/finanzas/pdf/generate-quote-pdf";

type DB = SupabaseClient;

const BUCKET = "documents";
const STORAGE_PATH = (tenantId: string, quoteId: string) =>
  `${tenantId}/quote_pdf/${quoteId}/current.pdf`;

export interface EnsureQuotePdfResult {
  bundle: QuotePdfBundle;
  storage_key: string;
  /** Filename amigable para descargas (ej. COT-001234.pdf). */
  file_name: string;
  /** Versión final del row de documents tras esta llamada. */
  version: number;
  /** True si se regeneró el PDF (cache miss); false si fue cache hit. */
  regenerated: boolean;
  /**
   * Buffer del PDF — presente sólo cuando `regenerated=true` (acabamos de
   * generarlo en memoria). En cache hit es null para evitar descargar el
   * blob innecesariamente; los callers que lo necesiten deben llamar a
   * `downloadQuotePdfBuffer()` aparte.
   */
  buffer: Buffer | null;
}

export interface EnsureQuotePdfContext {
  tenantId: string;
  userId: string;
  userName: string | null;
}

/**
 * Garantiza que el documento PDF auto-generado del quote refleja el
 * contenido vigente. Devuelve el storage_key + metadata.
 *
 * Lanza Error con mensaje en español si algo falla irrecuperablemente.
 * Devuelve null si la cotización no existe o no pertenece al tenant.
 */
export async function ensureQuotePdfRow(
  db: DB,
  ctx: EnsureQuotePdfContext,
  quoteId: string
): Promise<EnsureQuotePdfResult | null> {
  const bundle = await fetchQuotePdfBundle(db, ctx.tenantId, quoteId);
  if (!bundle) return null;

  const payload = buildQuotePdfPayload(bundle);
  const currentHash = computeQuoteContentHash(payload);

  const { data: existingRow, error: errFetchRow } = await db
    .from("documents")
    .select("id, storage_key, source_version, source_content_hash, file_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("entity_type", "quote")
    .eq("entity_id", quoteId)
    .eq("source", "auto_quote_pdf")
    .maybeSingle();

  if (errFetchRow) {
    console.error("[finanzas/pdf] ensure: lookup existing failed", errFetchRow);
    throw new Error("Error consultando documento");
  }

  const fileName = `${bundle.quote.quote_number}.pdf`;
  const storagePath = STORAGE_PATH(ctx.tenantId, quoteId);

  // Cache hit: hash coincide y row tiene storage_key vigente.
  if (
    existingRow &&
    existingRow.source_content_hash === currentHash &&
    typeof existingRow.storage_key === "string"
  ) {
    // Verificación defensiva: el blob debe existir realmente. Hacemos un
    // probe ligero con createSignedUrl (sin descargar). Si falla, caemos
    // al flujo de regeneración limpiando el row residual.
    const probe = await db.storage
      .from(BUCKET)
      .createSignedUrl(existingRow.storage_key as string, 30);
    if (!probe.error && probe.data?.signedUrl) {
      return {
        bundle,
        storage_key: existingRow.storage_key as string,
        file_name: (existingRow.file_name as string) ?? fileName,
        version: (existingRow.source_version as number | null) ?? 1,
        regenerated: false,
        buffer: null,
      };
    }
    console.warn(
      "[finanzas/pdf] ensure: row con hash igual pero blob ausente, regenerando",
      existingRow.id
    );
  }

  // Cache miss: generar buffer.
  const docProps = buildQuoteDocumentProps(bundle, {
    generated_at: new Date(),
    generated_by_name: ctx.userName,
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateQuotePdfBuffer(docProps);
  } catch (err) {
    console.error("[finanzas/pdf] ensure: generate failed", err);
    throw new Error("No se pudo generar el PDF");
  }

  const { error: errUpload } = await db.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (errUpload) {
    console.error("[finanzas/pdf] ensure: upload failed", errUpload);
    throw new Error("No se pudo subir el PDF al almacenamiento");
  }

  const nowIso = new Date().toISOString();
  let finalVersion: number;

  if (existingRow) {
    finalVersion = ((existingRow.source_version as number | null) ?? 0) + 1;
    const { error: errUpd } = await db
      .from("documents")
      .update({
        storage_key: storagePath,
        file_path: storagePath,
        file_name: fileName,
        source_version: finalVersion,
        source_generated_at: nowIso,
        source_content_hash: currentHash,
      })
      .eq("id", existingRow.id);

    if (errUpd) {
      console.error("[finanzas/pdf] ensure: documents update failed", errUpd);
      throw new Error("PDF generado pero no se pudo actualizar el registro");
    }
  } else {
    finalVersion = 1;
    const { error: errIns } = await db.from("documents").insert({
      tenant_id: ctx.tenantId,
      entity_type: "quote",
      entity_id: quoteId,
      file_name: fileName,
      file_path: storagePath,
      storage_key: storagePath,
      uploaded_by: ctx.userId,
      source: "auto_quote_pdf",
      source_version: finalVersion,
      source_generated_at: nowIso,
      source_content_hash: currentHash,
    });

    if (errIns) {
      console.error("[finanzas/pdf] ensure: documents insert failed", errIns);
      throw new Error("PDF generado pero no se pudo registrar el documento");
    }
  }

  return {
    bundle,
    storage_key: storagePath,
    file_name: fileName,
    version: finalVersion,
    regenerated: true,
    buffer: pdfBuffer,
  };
}

/**
 * Descarga el blob del PDF actual desde Storage como Buffer. Utilizado por
 * /send cuando se obtuvo cache hit y necesita el buffer para adjuntar al
 * email.
 */
export async function downloadQuotePdfBuffer(
  db: DB,
  storageKey: string
): Promise<Buffer> {
  const { data, error } = await db.storage.from(BUCKET).download(storageKey);
  if (error || !data) {
    console.error("[finanzas/pdf] downloadQuotePdfBuffer failed", error);
    throw new Error("No se pudo descargar el PDF desde el almacenamiento");
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Devuelve el nombre del bucket para que callers generen signed URLs. */
export function quotePdfBucket(): string {
  return BUCKET;
}

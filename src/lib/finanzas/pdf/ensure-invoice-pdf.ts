/**
 * Helper compartido por:
 *   - GET /api/finanzas/invoices/[id]/pdf  (descarga manual desde UI)
 *
 * Responsabilidad: garantizar que el row `documents` con
 * `source='auto_invoice_pdf'` para la factura esté al día con el contenido
 * actual, y devolver el storage_key + versión. Si el contenido cambió
 * (hash difiere) o el row no existe, regenera el PDF, upsertea el blob en
 * Storage y actualiza/crea el row.
 *
 * No emite signed URLs — cada caller decide qué hacer con el storage_key.
 *
 * Sprint 2F — espejo de ensure-quote-pdf.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInvoicePdfBundle,
  buildInvoicePdfPayload,
  buildInvoiceDocumentProps,
  type InvoicePdfBundle,
} from "@/lib/finanzas/pdf/invoice-pdf-data";
import { computeInvoiceContentHash } from "@/lib/finanzas/api/invoice-pdf-hash";
import { generateInvoicePdfBuffer } from "@/lib/finanzas/pdf/generate-invoice-pdf";

type DB = SupabaseClient;

const BUCKET = "documents";
const STORAGE_PATH = (tenantId: string, invoiceId: string) =>
  `${tenantId}/invoice_pdf/${invoiceId}/current.pdf`;

export interface EnsureInvoicePdfResult {
  bundle: InvoicePdfBundle;
  storage_key: string;
  /** Filename amigable para descargas (ej. FAC-HON-001234.pdf). */
  file_name: string;
  /** Versión final del row de documents tras esta llamada. */
  version: number;
  /** True si se regeneró el PDF (cache miss); false si fue cache hit. */
  regenerated: boolean;
  /**
   * Buffer del PDF — presente sólo cuando `regenerated=true`. En cache hit
   * es null para evitar descargar el blob innecesariamente.
   */
  buffer: Buffer | null;
}

export interface EnsureInvoicePdfContext {
  tenantId: string;
  userId: string;
  userName: string | null;
}

/**
 * Garantiza que el documento PDF auto-generado de la factura refleja el
 * contenido vigente. Devuelve el storage_key + metadata.
 *
 * Lanza Error con mensaje en español si algo falla irrecuperablemente.
 * Devuelve null si la factura no existe o no pertenece al tenant.
 */
export async function ensureInvoicePdfRow(
  db: DB,
  ctx: EnsureInvoicePdfContext,
  invoiceId: string
): Promise<EnsureInvoicePdfResult | null> {
  const bundle = await fetchInvoicePdfBundle(db, ctx.tenantId, invoiceId);
  if (!bundle) return null;

  const payload = buildInvoicePdfPayload(bundle);
  const currentHash = computeInvoiceContentHash(payload);

  const { data: existingRow, error: errFetchRow } = await db
    .from("documents")
    .select("id, storage_key, source_version, source_content_hash, file_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("entity_type", "invoice")
    .eq("entity_id", invoiceId)
    .eq("source", "auto_invoice_pdf")
    .maybeSingle();

  if (errFetchRow) {
    console.error("[finanzas/pdf] ensureInvoice: lookup existing failed", errFetchRow);
    throw new Error("Error consultando documento");
  }

  const fileName = `${bundle.invoice.invoice_number}.pdf`;
  const storagePath = STORAGE_PATH(ctx.tenantId, invoiceId);

  // Cache hit: hash coincide y row tiene storage_key vigente.
  if (
    existingRow &&
    existingRow.source_content_hash === currentHash &&
    typeof existingRow.storage_key === "string"
  ) {
    // Verificación defensiva: el blob debe existir realmente. Mismo patrón
    // que ensure-quote-pdf.ts — si la fila apunta a un objeto borrado del
    // bucket, regeneramos en vez de servir un signed URL roto.
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
      "[finanzas/pdf] ensureInvoice: row con hash igual pero blob ausente, regenerando",
      existingRow.id
    );
  }

  // Cache miss: generar buffer.
  const docProps = buildInvoiceDocumentProps(bundle, {
    generated_at: new Date(),
    generated_by_name: ctx.userName,
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateInvoicePdfBuffer(docProps);
  } catch (err) {
    console.error("[finanzas/pdf] ensureInvoice: generate failed", err);
    throw new Error("No se pudo generar el PDF");
  }

  const { error: errUpload } = await db.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (errUpload) {
    console.error("[finanzas/pdf] ensureInvoice: upload failed", errUpload);
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
      console.error("[finanzas/pdf] ensureInvoice: documents update failed", errUpd);
      throw new Error("PDF generado pero no se pudo actualizar el registro");
    }
  } else {
    finalVersion = 1;
    const { error: errIns } = await db.from("documents").insert({
      tenant_id: ctx.tenantId,
      entity_type: "invoice",
      entity_id: invoiceId,
      file_name: fileName,
      file_path: storagePath,
      storage_key: storagePath,
      uploaded_by: ctx.userId,
      source: "auto_invoice_pdf",
      source_version: finalVersion,
      source_generated_at: nowIso,
      source_content_hash: currentHash,
    });

    if (errIns) {
      console.error("[finanzas/pdf] ensureInvoice: documents insert failed", errIns);
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

/** Devuelve el nombre del bucket para que callers generen signed URLs. */
export function invoicePdfBucket(): string {
  return BUCKET;
}

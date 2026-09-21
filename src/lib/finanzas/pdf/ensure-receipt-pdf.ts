/**
 * Helper compartido por:
 *   - GET /api/finanzas/payments/[id]/pdf  (descarga desde el listado de cobros
 *     y desde la fila del cobro en el detalle de la factura)
 *
 * Responsabilidad: garantizar que el row `documents` con
 * `entity_type='payment'` + `source='auto_receipt_pdf'` del cobro esté al día
 * con el contenido actual, y devolver el storage_key + versión. Si el
 * contenido cambió (hash difiere — por ejemplo, el cobro se reversó) o el row
 * no existe, regenera el PDF, upsertea el blob en Storage y actualiza/crea el
 * row.
 *
 * No emite signed URLs — cada caller decide qué hacer con el storage_key.
 *
 * Bloque 2 (21/09/2026) — espejo de ensure-invoice-pdf.ts. La ruta de Storage
 * arranca con el tenant, que es lo que comparan las políticas de
 * `storage.objects` (SOP-015).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchReceiptPdfBundle,
  buildReceiptPdfPayload,
  buildReceiptDocumentProps,
  type ReceiptPdfBundle,
} from "@/lib/finanzas/pdf/receipt-pdf-data";
import { computeReceiptContentHash } from "@/lib/finanzas/api/receipt-pdf-hash";
import { generateReceiptPdfBuffer } from "@/lib/finanzas/pdf/generate-receipt-pdf";

type DB = SupabaseClient;

const BUCKET = "documents";
const STORAGE_PATH = (tenantId: string, paymentId: string) =>
  `${tenantId}/receipt_pdf/${paymentId}/current.pdf`;

export interface EnsureReceiptPdfResult {
  bundle: ReceiptPdfBundle;
  storage_key: string;
  /** Filename amigable para descargas (ej. REC-000012.pdf). */
  file_name: string;
  version: number;
  regenerated: boolean;
  buffer: Buffer | null;
}

export interface EnsureReceiptPdfContext {
  tenantId: string;
  userId: string;
  userName: string | null;
}

/**
 * Devuelve null si el cobro no existe, no pertenece al tenant o no tiene
 * número de recibo (anterior a la 047 en una base sin backfill).
 */
export async function ensureReceiptPdfRow(
  db: DB,
  ctx: EnsureReceiptPdfContext,
  paymentId: string
): Promise<EnsureReceiptPdfResult | null> {
  const bundle = await fetchReceiptPdfBundle(db, ctx.tenantId, paymentId);
  if (!bundle) return null;

  const payload = buildReceiptPdfPayload(bundle);
  const currentHash = computeReceiptContentHash(payload);

  const { data: existingRow, error: errFetchRow } = await db
    .from("documents")
    .select("id, storage_key, source_version, source_content_hash, file_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("entity_type", "payment")
    .eq("entity_id", paymentId)
    .eq("source", "auto_receipt_pdf")
    .maybeSingle();

  if (errFetchRow) {
    console.error("[finanzas/pdf] ensureReceipt: lookup existing failed", errFetchRow);
    throw new Error("Error consultando documento");
  }

  const fileName = `${bundle.payment.payment_number}.pdf`;
  const storagePath = STORAGE_PATH(ctx.tenantId, paymentId);

  // Cache hit: hash coincide y el blob existe de verdad.
  if (
    existingRow &&
    existingRow.source_content_hash === currentHash &&
    typeof existingRow.storage_key === "string"
  ) {
    const probe = await db.storage.from(BUCKET).createSignedUrl(existingRow.storage_key as string, 30);
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
    console.warn("[finanzas/pdf] ensureReceipt: row con hash igual pero blob ausente, regenerando", existingRow.id);
  }

  // Cache miss: generar.
  const docProps = buildReceiptDocumentProps(bundle, {
    generated_at: new Date(),
    generated_by_name: ctx.userName,
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateReceiptPdfBuffer(docProps);
  } catch (err) {
    console.error("[finanzas/pdf] ensureReceipt: generate failed", err);
    throw new Error("No se pudo generar el PDF");
  }

  const { error: errUpload } = await db.storage.from(BUCKET).upload(storagePath, pdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (errUpload) {
    console.error("[finanzas/pdf] ensureReceipt: upload failed", errUpload);
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
      console.error("[finanzas/pdf] ensureReceipt: documents update failed", errUpd);
      throw new Error("PDF generado pero no se pudo actualizar el registro");
    }
  } else {
    finalVersion = 1;
    const { error: errIns } = await db.from("documents").insert({
      tenant_id: ctx.tenantId,
      entity_type: "payment",
      entity_id: paymentId,
      file_name: fileName,
      file_path: storagePath,
      storage_key: storagePath,
      uploaded_by: ctx.userId,
      source: "auto_receipt_pdf",
      source_version: finalVersion,
      source_generated_at: nowIso,
      source_content_hash: currentHash,
    });
    if (errIns) {
      console.error("[finanzas/pdf] ensureReceipt: documents insert failed", errIns);
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

export function receiptPdfBucket(): string {
  return BUCKET;
}

/**
 * Helper compartido por:
 *   - GET /api/finanzas/supplier-payments/[id]/pdf  (descarga desde la fila
 *     del pago en la sección "Pagos" del detalle de la compra)
 *
 * Responsabilidad: garantizar que el row `documents` con
 * `entity_type='supplier_payment'` + `source='auto_supplier_payment_pdf'` del
 * pago esté al día con el contenido actual, y devolver el storage_key +
 * versión. Si el contenido cambió (hash difiere — por ejemplo, el pago se
 * reversó) o el row no existe, regenera el PDF, upsertea el blob en Storage y
 * actualiza/crea el row. Los dos valores de `documents` los agregó la 048.
 *
 * Un SALDO HEREDADO no tiene comprobante: se devuelve `{ ok: false, motivo:
 * "saldo-heredado" }` sin tocar nada, y la ruta responde 409. Ver el
 * encabezado de `supplier-payment-pdf-data.ts`.
 *
 * No emite signed URLs — cada caller decide qué hacer con el storage_key.
 *
 * Bloque 3 (21/09/2026) — espejo de ensure-receipt-pdf.ts. La ruta de Storage
 * arranca con el tenant, que es lo que comparan las políticas de
 * `storage.objects` (SOP-015).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSupplierPaymentPdfBundle,
  buildSupplierPaymentPdfPayload,
  buildSupplierPaymentDocumentProps,
  type SupplierPaymentPdfBundle,
} from "@/lib/finanzas/pdf/supplier-payment-pdf-data";
import { computeSupplierPaymentContentHash } from "@/lib/finanzas/api/supplier-payment-pdf-hash";
import { generateSupplierPaymentPdfBuffer } from "@/lib/finanzas/pdf/generate-supplier-payment-pdf";

type DB = SupabaseClient;

const BUCKET = "documents";
const STORAGE_PATH = (tenantId: string, paymentId: string) =>
  `${tenantId}/supplier_payment_pdf/${paymentId}/current.pdf`;

export interface EnsureSupplierPaymentPdfOk {
  ok: true;
  bundle: SupplierPaymentPdfBundle;
  storage_key: string;
  /** Filename amigable para descargas (ej. CE-000012.pdf). */
  file_name: string;
  version: number;
  regenerated: boolean;
  buffer: Buffer | null;
}

export type EnsureSupplierPaymentPdfResult =
  | EnsureSupplierPaymentPdfOk
  | { ok: false; motivo: "no-existe" | "saldo-heredado" };

export interface EnsureSupplierPaymentPdfContext {
  tenantId: string;
  userId: string;
  userName: string | null;
}

export async function ensureSupplierPaymentPdfRow(
  db: DB,
  ctx: EnsureSupplierPaymentPdfContext,
  paymentId: string
): Promise<EnsureSupplierPaymentPdfResult> {
  const lookup = await fetchSupplierPaymentPdfBundle(db, ctx.tenantId, paymentId);
  if (!lookup.ok) return lookup;
  const bundle = lookup.bundle;

  const payload = buildSupplierPaymentPdfPayload(bundle);
  const currentHash = computeSupplierPaymentContentHash(payload);

  const { data: existingRow, error: errFetchRow } = await db
    .from("documents")
    .select("id, storage_key, source_version, source_content_hash, file_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("entity_type", "supplier_payment")
    .eq("entity_id", paymentId)
    .eq("source", "auto_supplier_payment_pdf")
    .maybeSingle();

  if (errFetchRow) {
    console.error("[finanzas/pdf] ensureSupplierPayment: lookup existing failed", errFetchRow);
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
        ok: true,
        bundle,
        storage_key: existingRow.storage_key as string,
        file_name: (existingRow.file_name as string) ?? fileName,
        version: (existingRow.source_version as number | null) ?? 1,
        regenerated: false,
        buffer: null,
      };
    }
    console.warn("[finanzas/pdf] ensureSupplierPayment: row con hash igual pero blob ausente, regenerando", existingRow.id);
  }

  // Cache miss: generar.
  const docProps = buildSupplierPaymentDocumentProps(bundle, {
    generated_at: new Date(),
    generated_by_name: ctx.userName,
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateSupplierPaymentPdfBuffer(docProps);
  } catch (err) {
    console.error("[finanzas/pdf] ensureSupplierPayment: generate failed", err);
    throw new Error("No se pudo generar el PDF");
  }

  const { error: errUpload } = await db.storage.from(BUCKET).upload(storagePath, pdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (errUpload) {
    console.error("[finanzas/pdf] ensureSupplierPayment: upload failed", errUpload);
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
      console.error("[finanzas/pdf] ensureSupplierPayment: documents update failed", errUpd);
      throw new Error("PDF generado pero no se pudo actualizar el registro");
    }
  } else {
    finalVersion = 1;
    const { error: errIns } = await db.from("documents").insert({
      tenant_id: ctx.tenantId,
      entity_type: "supplier_payment",
      entity_id: paymentId,
      file_name: fileName,
      file_path: storagePath,
      storage_key: storagePath,
      uploaded_by: ctx.userId,
      source: "auto_supplier_payment_pdf",
      source_version: finalVersion,
      source_generated_at: nowIso,
      source_content_hash: currentHash,
    });
    if (errIns) {
      console.error("[finanzas/pdf] ensureSupplierPayment: documents insert failed", errIns);
      throw new Error("PDF generado pero no se pudo registrar el documento");
    }
  }

  return {
    ok: true,
    bundle,
    storage_key: storagePath,
    file_name: fileName,
    version: finalVersion,
    regenerated: true,
    buffer: pdfBuffer,
  };
}

export function supplierPaymentPdfBucket(): string {
  return BUCKET;
}

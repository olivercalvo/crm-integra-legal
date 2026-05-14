/**
 * GET /api/finanzas/quotes/[id]/pdf
 *
 * Sprint 2E.3 (D3, D4, D7). Devuelve un signed URL de Storage al PDF actual
 * de la cotización. Si el contenido del quote cambió desde la última
 * generación (hash difiere) o si no existe el blob aún, regenera el PDF,
 * lo upsertea en Storage y actualiza/crea la row en documents.
 *
 * Auth: usuarios con rol admin/abogada/contador del tenant pueden generar y
 * descargar PDF de cualquier estado (D7 — incluso borrador para preview).
 *
 * Response body: { url, regenerated, version }
 *   - url: signed URL de Storage válido 5 min.
 *   - regenerated: true si se regeneró el PDF, false si fue cache hit.
 *   - version: source_version final del row de documents.
 *
 * Storage path: {tenant_id}/quote_pdf/{quote_id}/current.pdf (upsert=true).
 * Documents row: entity_type='quote', entity_id=quote_id, source='auto_quote_pdf'.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  fetchQuotePdfBundle,
  buildQuotePdfPayload,
  buildQuoteDocumentProps,
} from "@/lib/finanzas/pdf/quote-pdf-data";
import { computeQuoteContentHash } from "@/lib/finanzas/api/quote-pdf-hash";
import { generateQuotePdfBuffer } from "@/lib/finanzas/pdf/generate-quote-pdf";

interface RouteParams {
  params: { id: string };
}

// React-PDF necesita runtime nodejs (no edge).
export const runtime = "nodejs";
// La regeneración puede tardar varios segundos en PDFs grandes.
export const maxDuration = 30;

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;
const BUCKET = "documents";
const STORAGE_PATH = (tenantId: string, quoteId: string) =>
  `${tenantId}/quote_pdf/${quoteId}/current.pdf`;
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutos

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const quoteId = params.id;

  // 1) Cargar bundle (quote + cliente + caso + líneas).
  const bundle = await fetchQuotePdfBundle(ctx.db, ctx.tenantId, quoteId);
  if (!bundle) {
    return NextResponse.json(
      { error: "Cotización no encontrada" },
      { status: 404 }
    );
  }

  // 2) Calcular hash del contenido vigente.
  const payload = buildQuotePdfPayload(bundle);
  const currentHash = computeQuoteContentHash(payload);

  // 3) Buscar row existente con auto_quote_pdf para esta cotización.
  const { data: existingRow, error: errFetchRow } = await ctx.db
    .from("documents")
    .select(
      "id, storage_key, source_version, source_content_hash, file_name"
    )
    .eq("tenant_id", ctx.tenantId)
    .eq("entity_type", "quote")
    .eq("entity_id", quoteId)
    .eq("source", "auto_quote_pdf")
    .maybeSingle();

  if (errFetchRow) {
    console.error("[finanzas/pdf] lookup existing doc failed", errFetchRow);
    return NextResponse.json({ error: "Error consultando documento" }, { status: 500 });
  }

  // 4) Cache hit: hash coincide → devolver signed URL sin regenerar.
  if (existingRow && existingRow.source_content_hash === currentHash) {
    const signed = await signUrl(ctx.db, existingRow.storage_key as string);
    if (!signed) {
      // El row existe pero el blob ya no está en Storage. Caemos al
      // flujo de regeneración limpiando el row residual.
      console.warn(
        "[finanzas/pdf] cache row sin blob — forzando regeneración",
        existingRow.id
      );
    } else {
      return NextResponse.json({
        url: signed,
        regenerated: false,
        version: existingRow.source_version ?? 1,
      });
    }
  }

  // 5) Regenerar PDF.
  let pdfBuffer: Buffer;
  try {
    const docProps = buildQuoteDocumentProps(bundle, {
      generated_at: new Date(),
      generated_by_name: ctx.userName ?? null,
    });
    pdfBuffer = await generateQuotePdfBuffer(docProps);
  } catch (err) {
    console.error("[finanzas/pdf] generate buffer failed", err);
    return NextResponse.json(
      { error: "No se pudo generar el PDF" },
      { status: 500 }
    );
  }

  // 6) Upsert blob en Storage.
  const storagePath = STORAGE_PATH(ctx.tenantId, quoteId);
  const { error: errUpload } = await ctx.db.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (errUpload) {
    console.error("[finanzas/pdf] storage upload failed", errUpload);
    return NextResponse.json(
      { error: "No se pudo subir el PDF al almacenamiento" },
      { status: 500 }
    );
  }

  // 7) Persistir row en documents (insert nuevo o update del existente).
  const nowIso = new Date().toISOString();
  const fileName = `${bundle.quote.quote_number}.pdf`;
  let finalVersion: number;

  if (existingRow) {
    finalVersion = (existingRow.source_version ?? 0) + 1;
    const { error: errUpd } = await ctx.db
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
      console.error("[finanzas/pdf] documents update failed", errUpd);
      return NextResponse.json(
        { error: "PDF generado pero no se pudo actualizar el registro" },
        { status: 500 }
      );
    }
  } else {
    finalVersion = 1;
    const { error: errIns } = await ctx.db.from("documents").insert({
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
      console.error("[finanzas/pdf] documents insert failed", errIns);
      return NextResponse.json(
        { error: "PDF generado pero no se pudo registrar el documento" },
        { status: 500 }
      );
    }
  }

  // 8) Generar signed URL del PDF recién subido.
  const signed = await signUrl(ctx.db, storagePath);
  if (!signed) {
    return NextResponse.json(
      { error: "PDF generado pero no se pudo firmar el URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    url: signed,
    regenerated: true,
    version: finalVersion,
  });
}

async function signUrl(
  db: Awaited<ReturnType<typeof getAuthenticatedContext>>["db"],
  storageKey: string
): Promise<string | null> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("[finanzas/pdf] createSignedUrl failed", error);
    return null;
  }
  return data.signedUrl;
}

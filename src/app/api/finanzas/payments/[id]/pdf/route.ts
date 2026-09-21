/**
 * GET /api/finanzas/payments/[id]/pdf — el PDF del RECIBO DE CAJA.
 *
 * Bloque 2 (21/09/2026). Devuelve el ARCHIVO (no un enlace firmado, por lo del
 * 01/09: el dominio de Supabase no resolvía en la red de una licenciada).
 * Regenera si el contenido cambió (por ejemplo, el cobro se reversó) o si no
 * existe todavía. La lógica vive en `ensureReceiptPdfRow`.
 *
 * Permisos: los MISMOS que el PDF de la factura — admin, abogada y contador.
 * El contador ve el detalle de la factura en solo lectura y desde ahí baja el
 * recibo; el asistente no llega a Finanzas. Hay un test estructural que cruza
 * esta lista contra la de la factura (`recibo-pdf-roles.test.ts`).
 *
 * El `tenant_id` sale del contexto autenticado, nunca del request.
 */

import { NextRequest, NextResponse } from "next/server";
import { serveStorageFile } from "@/lib/storage/serve-file";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { ensureReceiptPdfRow, receiptPdfBucket } from "@/lib/finanzas/pdf/ensure-receipt-pdf";

interface RouteParams {
  params: { id: string };
}

// React-PDF requiere runtime nodejs.
export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await ensureReceiptPdfRow(
      ctx.db,
      { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName ?? null },
      params.id
    );

    if (!result) {
      return NextResponse.json({ error: "Recibo no encontrado" }, { status: 404 });
    }

    const respuesta = await serveStorageFile({
      admin: ctx.db,
      bucket: receiptPdfBucket(),
      storageKey: result.storage_key,
      fileName: result.file_name,
    });

    if (respuesta.ok) {
      respuesta.headers.set("X-Pdf-Regenerated", result.regenerated ? "1" : "0");
      respuesta.headers.set("X-Pdf-Version", String(result.version));
    }
    return respuesta;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error generando el PDF";
    console.error("[finanzas/pdf] receipt GET failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

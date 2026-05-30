/**
 * GET /api/finanzas/invoices/[id]/pdf
 *
 * Sprint 2F. Devuelve un signed URL al PDF actual de la factura. Si el
 * contenido cambió desde la última generación (hash difiere) o si no
 * existe blob aún, regenera, sube y actualiza el row `documents`.
 *
 * Auth: usuarios con rol admin/abogada/contador del tenant pueden generar
 * y descargar el PDF de la factura en cualquier estado (incluido borrador
 * — el PDF lleva la etiqueta "BORRADOR — documento no emitido").
 *
 * Response: { url, regenerated, version, file_name }
 *
 * La lógica core (hash + decisión + upload + persist) vive en
 * ensureInvoicePdfRow.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  ensureInvoicePdfRow,
  invoicePdfBucket,
} from "@/lib/finanzas/pdf/ensure-invoice-pdf";

interface RouteParams {
  params: { id: string };
}

// React-PDF requiere runtime nodejs.
export const runtime = "nodejs";
// La regeneración puede tardar varios segundos en facturas grandes.
export const maxDuration = 30;

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutos

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await ensureInvoicePdfRow(
      ctx.db,
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userName: ctx.userName ?? null,
      },
      params.id
    );

    if (!result) {
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      );
    }

    const { data, error } = await ctx.db.storage
      .from(invoicePdfBucket())
      .createSignedUrl(result.storage_key, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error("[finanzas/pdf] invoice createSignedUrl failed", error);
      return NextResponse.json(
        { error: "No se pudo firmar el URL del PDF" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: data.signedUrl,
      regenerated: result.regenerated,
      version: result.version,
      file_name: result.file_name,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error generando el PDF";
    console.error("[finanzas/pdf] invoice GET failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

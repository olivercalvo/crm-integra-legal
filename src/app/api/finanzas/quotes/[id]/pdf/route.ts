/**
 * GET /api/finanzas/quotes/[id]/pdf
 *
 * Sprint 2E.3 (D3, D4, D7). Devuelve un signed URL al PDF actual de la
 * cotización. Si el contenido del quote cambió desde la última generación
 * (hash difiere) o si no existe blob aún, regenera, sube y actualiza el
 * row `documents`.
 *
 * Auth: usuarios con rol admin/abogada/contador del tenant pueden generar
 * y descargar el PDF de cualquier estado (D7 — incluso borrador).
 *
 * Response: { url, regenerated, version, file_name }
 *
 * La lógica core (hash + decisión + upload + persist) vive en
 * ensureQuotePdfRow para reuso desde /send (Fase C).
 */

import { NextRequest, NextResponse } from "next/server";

import { serveStorageFile } from "@/lib/storage/serve-file";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  ensureQuotePdfRow,
  quotePdfBucket,
} from "@/lib/finanzas/pdf/ensure-quote-pdf";

interface RouteParams {
  params: { id: string };
}

// React-PDF requiere runtime nodejs.
export const runtime = "nodejs";
// La regeneración puede tardar varios segundos en cotizaciones grandes.
export const maxDuration = 30;

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await ensureQuotePdfRow(
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
        { error: "Cotización no encontrada" },
        { status: 404 }
      );
    }

    // Se DEVUELVE EL ARCHIVO, no un enlace firmado.
    //
    // Hasta el 01/09/2026 esta ruta respondía `{ url: signedUrl }` y el
    // navegador abría ese enlace, que apunta a `*.supabase.co`. Una de las
    // licenciadas no pudo descargar una factura porque ese dominio no resolvía
    // en su red: `DNS_PROBE_FINISHED_NXDOMAIN`. Ahora el navegador solo habla
    // con el dominio del CRM y el archivo lo trae el servidor.
    // Ver `src/lib/storage/serve-file.ts`.
    const respuesta = await serveStorageFile({
      admin: ctx.db,
      bucket: quotePdfBucket(),
      storageKey: result.storage_key,
      fileName: result.file_name,
    });

    // El cuerpo ahora es el PDF, así que `regenerated` —que la UI usa para
    // avisar "se regeneró"— viaja en una cabecera propia.
    if (respuesta.ok) {
      respuesta.headers.set("X-Pdf-Regenerated", result.regenerated ? "1" : "0");
      respuesta.headers.set("X-Pdf-Version", String(result.version));
    }
    return respuesta;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error generando el PDF";
    console.error("[finanzas/pdf] GET failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

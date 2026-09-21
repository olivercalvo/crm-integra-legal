/**
 * GET /api/finanzas/supplier-payments/[id]/pdf — el PDF del COMPROBANTE DE
 * EGRESO de un pago a proveedor.
 *
 * Bloque 3 (21/09/2026). Devuelve el ARCHIVO (no un enlace firmado, por lo del
 * 01/09: el dominio de Supabase no resolvía en la red de una licenciada).
 * Regenera si el contenido cambió (por ejemplo, el pago se reversó) o si no
 * existe todavía. La lógica vive en `ensureSupplierPaymentPdfRow`.
 *
 * Permisos: los MISMOS que las compras del bufete — admin, abogada y contador
 * (`business-expenses/[id]/receipt/download`, el otro archivo que se baja
 * desde el detalle de la compra). Hay un test estructural que cruza las dos
 * listas (`comprobante-egreso-pdf.test.ts`).
 *
 * Un SALDO HEREDADO (048) responde 409: no es un pago registrado y no tiene
 * comprobante. La pantalla no ofrece el botón; el 409 es el permiso real.
 *
 * El `tenant_id` sale del contexto autenticado, nunca del request.
 */

import { NextRequest, NextResponse } from "next/server";
import { serveStorageFile } from "@/lib/storage/serve-file";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  ensureSupplierPaymentPdfRow,
  supplierPaymentPdfBucket,
} from "@/lib/finanzas/pdf/ensure-supplier-payment-pdf";

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
    const result = await ensureSupplierPaymentPdfRow(
      ctx.db,
      { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName ?? null },
      params.id
    );

    if (!result.ok) {
      if (result.motivo === "saldo-heredado") {
        return NextResponse.json(
          {
            error:
              "Un saldo heredado de la migración no tiene comprobante: no es un pago registrado. " +
              "Si la compra sí se pagó, registre el pago real (con su banco) y elimine el saldo heredado.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    }

    const respuesta = await serveStorageFile({
      admin: ctx.db,
      bucket: supplierPaymentPdfBucket(),
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
    console.error("[finanzas/pdf] supplier payment GET failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

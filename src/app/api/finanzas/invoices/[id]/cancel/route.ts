import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { MutationError } from "@/lib/finanzas/api/errors";
import { anularFacturaAnteDgi } from "@/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/invoices/[id]/cancel
 *
 * Anula una factura. Desde el Bloque 9B **la anulación incluye la DGI** cuando
 * la factura tiene CUFE: el orquestador le pide la anulación al PAC y recién
 * después toca el libro (D3). Qué corresponde hacer con esta factura lo decide
 * `decidirAccionFiscal` DENTRO del orquestador, no esta ruta y no la pantalla.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 LOS CÓDIGOS HTTP DICEN QUÉ QUEDÓ ESCRITO, NO SI "SALIÓ BIEN"
 * ─────────────────────────────────────────────────────────────────────────────
 * Hay cuatro desenlaces y tres de ellos no son ni un éxito limpio ni un error
 * limpio. Devolver 200 para todo lo que no explota haría que la pantalla
 * mostrara "listo" sobre una factura que puede haber quedado a medio anular; y
 * devolver 500 haría creer que no pasó nada, cuando el documento ya está muerto
 * ante la DGI. Así que cada desenlace tiene su código:
 *
 *   200 `anulada`                        — anulada de los dos lados.
 *   409 `anulada_en_dgi_falta_el_libro`  — 🔴 estado intermedio (D4). El
 *       documento está anulado ante la DGI y vivo en el libro. La pantalla
 *       muestra la banda roja y ofrece «Completar anulación».
 *   422 `rechazada_por_la_dgi`           — la DGI dijo que no. NADA cambió.
 *   502 `no_sabemos`                     — no se pudo confirmar si llegó. NADA
 *       cambió. Es un problema del intermediario, de ahí el 502.
 *
 * El cuerpo SIEMPRE trae `estado`, para que la pantalla no tenga que deducirlo
 * del código, y `error` cuando corresponde, porque es lo que el resto del
 * módulo ya lee.
 *
 * Permisos: admin + abogada (Sprint 2C, D4 + D5). El contador NO anula.
 *
 * Body: `{ reason: string, observations?: string | null }`.
 * El motivo exige **15 caracteres** desde el Bloque 9B (D5): es el mínimo que
 * pide la DGI para `cancellationReason`. Lo valida el orquestador con el mismo
 * módulo que usa el diálogo, y el CHECK de la `058` lo sostiene en la base.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const observaciones =
    b.observations != null && String(b.observations).trim() !== ""
      ? String(b.observations).trim()
      : null;
  if (observaciones && observaciones.length > 2000) {
    return NextResponse.json(
      {
        error: "Validación fallida",
        fieldErrors: {
          observations: "Las observaciones no pueden tener más de 2000 caracteres.",
        },
      },
      { status: 400 }
    );
  }

  try {
    const r = await anularFacturaAnteDgi(
      ctx.db,
      // 🔑 SOP-014: la reversión del libro va con el cliente de SERVICIO.
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      params.id,
      b.reason,
      observaciones,
      new Date()
    );

    switch (r.estado) {
      case "anulada":
        return NextResponse.json({ id: params.id, ...r }, { status: 200 });

      case "anulada_en_dgi_falta_el_libro":
        console.error(
          "[finanzas] anulación a medias:",
          params.id,
          r.detalle
        );
        return NextResponse.json({ id: params.id, error: r.mensaje, ...r }, { status: 409 });

      case "rechazada_por_la_dgi":
        return NextResponse.json({ id: params.id, error: r.mensaje, ...r }, { status: 422 });

      case "no_sabemos":
        console.error("[finanzas] anulación sin confirmar:", params.id, `intento #${r.intento}`);
        return NextResponse.json({ id: params.id, error: r.mensaje, ...r }, { status: 502 });
    }
  } catch (err) {
    // `InvoiceMutationError` es un alias de `MutationError` (api/invoices.ts:129),
    // así que este `instanceof` cubre los dos nombres.
    if (err instanceof MutationError) {
      console.error("[finanzas] cancelInvoice failed:", err.message);
      const cuerpo: Record<string, unknown> = { error: err.message };
      // El 400 del motivo se devuelve con la forma que el diálogo ya lee.
      if (err.status === 400) cuerpo.fieldErrors = { reason: err.message };
      return NextResponse.json(cuerpo, { status: err.status });
    }
    console.error("[finanzas] cancelInvoice unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

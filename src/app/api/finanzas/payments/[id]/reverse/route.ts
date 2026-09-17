import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { reversePayment } from "@/lib/finanzas/api/payments";
import { MutationError } from "@/lib/finanzas/api/errors";
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/finanzas/contabilidad/reversion";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/payments/[id]/reverse
 *
 * Reversa un cobro contabilizado: asiento espejo con la fecha de hoy, borrado
 * de sus aplicaciones (T7a devuelve la factura a su estado) y cobro anulado —
 * los tres en UNA transacción, dentro del RPC `reverse_payment` (046).
 *
 * Permisos: admin + abogada + **contador**. Es el único botón de mutación que
 * el contador tiene en el detalle de una factura, y lo tiene por el mismo
 * criterio de la guía de RM que le da los asientos manuales y los períodos:
 * corregir el libro es trabajo del contador. Asistente → 403.
 *
 * ⚠️ Registrar y eliminar cobros siguen siendo admin + abogada (`canMutate`);
 * reversar es `canReverse`. Son dos banderas distintas a propósito: ampliar
 * una no amplía la otra. Si se cambia esta lista, se mueven juntos la tabla de
 * CLAUDE.md, este guard y `canReverse` en `facturas/[id]/page.tsx`.
 *
 * Body esperado: { reason }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const raw = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < MOTIVO_MIN || reason.length > MOTIVO_MAX) {
    return NextResponse.json(
      {
        error: "Validación fallida",
        fieldErrors: {
          reason: `El motivo de la reversión debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`,
        },
      },
      { status: 400 }
    );
  }

  try {
    const result = await reversePayment(
      ctx.db,
      // 🔑 SOP-014: el RPC va con el cliente de SERVICIO; el tenant sale del
      //    contexto autenticado, nunca del body.
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      params.id,
      reason
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] reversePayment failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] reversePayment unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

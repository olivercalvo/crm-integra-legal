import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { validateUpdateTaxCode } from "@/lib/finanzas/validators/tax-code";
import { updateTaxCode } from "@/lib/finanzas/api/tax-codes";
import { MutationError } from "@/lib/finanzas/api/errors";

// ESCRIBIR: admin y CONTADOR. La abogada no.
//
// Es el mismo criterio que ya rige la clasificación contable de una cuenta
// (`ROLES_CLASIFICACION` en `api/chart-of-accounts.ts`), y sale de la guía que
// entregó RM: quien modifica la clasificación contable debe ser el contador. Una
// tasa impositiva es materia contable por el mismo motivo — se cambia con una
// reforma fiscal de por medio, no en el día a día de facturar.
const ROLES_ESCRITURA = ["admin", "contador"] as const;

/**
 * PATCH /api/finanzas/configuracion/tax-codes/[id]
 * Cambia nombre, tasa y/o estado activo. El `code` NO se toca: es la clave con
 * la que las líneas de factura y cotización referencian el impuesto.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ESCRITURA);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateUpdateTaxCode(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const taxCode = await updateTaxCode(
      ctx.db,
      ctx.tenantId,
      params.id,
      ctx.userId,
      validation.data
    );
    return NextResponse.json({ taxCode }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] updateTaxCode failed:", err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateTaxCode unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

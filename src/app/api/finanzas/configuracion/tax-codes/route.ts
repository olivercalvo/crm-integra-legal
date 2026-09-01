import { NextResponse } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { listTaxCodes } from "@/lib/finanzas/api/tax-codes";
import { MutationError } from "@/lib/finanzas/api/errors";

// Leer el catálogo: mismo set que el resto de /finanzas. El contador tiene que
// poder verlo — es su materia.
const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * GET /api/finanzas/configuracion/tax-codes
 * Catálogo de impuestos del tenant, activos e inactivos.
 */
export async function GET() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;

  try {
    const taxCodes = await listTaxCodes(ctx.db, ctx.tenantId);
    return NextResponse.json({ taxCodes }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] GET tax-codes unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { createTaxCode, listTaxCodes } from "@/lib/finanzas/api/tax-codes";
import { validateCreateTaxCode } from "@/lib/finanzas/validators/tax-code";
import { MutationError } from "@/lib/finanzas/api/errors";

// Leer el catálogo: mismo set que el resto de /finanzas. El contador tiene que
// poder verlo — es su materia.
const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;

// 🔴 ESCRIBIR ES OTRO SET, Y ES EL MISMO QUE EL DEL PATCH.
// La abogada LEE el catálogo pero no lo modifica: es el criterio de la guía de
// RM, "quien modifica la clasificación contable de una cuenta debe ser el
// contador", y la tasa de un impuesto es de la misma familia. Si alguna vez se
// amplía, hay que mover esta lista, la de `[id]/route.ts` y la tabla de
// CLAUDE.md juntas.
const ROLES_ESCRITURA = ["admin", "contador"] as const;

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

/**
 * POST /api/finanzas/configuracion/tax-codes
 * Alta de una tasa (2.4). Admin y contador.
 *
 * La tasa llega en DECIMAL (0.07). La pantalla pide el PORCENTAJE y convierte
 * con `parseTaxRatePercent` antes de mandar, mostrando al lado el valor que se
 * va a guardar: quien carga piensa en "7%", la base guarda 0.0700, y los dos
 * tienen que verse para que nadie cargue 700%.
 */
export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ESCRITURA);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const validado = validateCreateTaxCode(body);
  if (!validado.ok) {
    return NextResponse.json({ errors: validado.errors }, { status: 400 });
  }

  try {
    const taxCode = await createTaxCode(ctx.db, ctx.tenantId, ctx.userId, validado.data);
    return NextResponse.json({ taxCode }, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] POST tax-codes unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

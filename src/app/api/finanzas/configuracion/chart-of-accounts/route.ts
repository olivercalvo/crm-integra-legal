import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { validateCreateChartAccount } from "@/lib/finanzas/validators/chart-of-account";
import { createChartAccount } from "@/lib/finanzas/api/chart-of-accounts";
import { listChartAccounts } from "@/lib/finanzas/queries/chart-of-accounts";
import { MutationError } from "@/lib/finanzas/api/errors";

// Mismo set de roles que el resto de /finanzas. El asistente ya queda fuera
// por middleware; igual lo rechazamos acá por defensa en profundidad.
const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * GET /api/finanzas/configuracion/chart-of-accounts
 * Lista todas las cuentas del tenant (activas + inactivas) para la pantalla de
 * gestión del Plan de Cuentas.
 */
export async function GET() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;

  const accounts = await listChartAccounts(ctx.db, ctx.tenantId);
  return NextResponse.json({ accounts }, { status: 200 });
}

/**
 * POST /api/finanzas/configuracion/chart-of-accounts
 * Crea una cuenta contable. Código único por tenant → 409 accionable si dup.
 */
export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateCreateChartAccount(
    body as Parameters<typeof validateCreateChartAccount>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const account = await createChartAccount(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      validation.data
    );
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createChartAccount failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createChartAccount unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

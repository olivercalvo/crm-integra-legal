import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { validateUpdateChartAccount } from "@/lib/finanzas/validators/chart-of-account";
import { updateChartAccount } from "@/lib/finanzas/api/chart-of-accounts";
import { MutationError } from "@/lib/finanzas/api/errors";

const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * PATCH /api/finanzas/configuracion/chart-of-accounts/[id]
 * Edita una cuenta (nombre, tipo, descripción, activa; código solo si NO es
 * is_system). Desactivar una cuenta is_system está bloqueado (409).
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateUpdateChartAccount(
    body as Parameters<typeof validateUpdateChartAccount>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const account = await updateChartAccount(
      ctx.db,
      ctx.tenantId,
      params.id,
      ctx.userId,
      validation.data
    );
    return NextResponse.json({ account }, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] updateChartAccount failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateChartAccount unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

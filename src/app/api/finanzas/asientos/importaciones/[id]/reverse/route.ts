import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { deshacerImportacion } from "@/lib/finanzas/api/importacion-asientos";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

/**
 * POST /api/finanzas/asientos/importaciones/[id]/reverse  { reason }
 * Deshace el lote COMPLETO: reversa cada asiento con fecha de hoy (067). Nada
 * se borra. Roles: admin y contador.
 */
const ROLES_ASIENTO_MANUAL = ["admin", "contador"] as const;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ASIENTO_MANUAL);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const reason = String((body as { reason?: unknown } | null)?.reason ?? "");
  try {
    const r = await deshacerImportacion(ctx.db, createAdminClient(), ctx.tenantId, ctx.userId, params.id, reason);
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[finanzas] deshacer importacion unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

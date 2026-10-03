import { NextRequest } from "next/server";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { exportarBitacora } from "@/lib/auditoria/rutas";

/**
 * GET /api/finanzas/auditoria/export: la bitácora contable en Excel, con los filtros de la pantalla (admin y contador).
 * Mismos roles que su pantalla; lo cruza `nav-guard.test.ts`. La base vuelve a
 * exigir el rol. El tenant sale del perfil, nunca del request.
 */
export const runtime = "nodejs";

const ROLES = ["admin", "contador"] as const;

export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  return exportarBitacora(request, "contable", { db: ctx.db, tenantId: ctx.tenantId, userId: ctx.userId });
}

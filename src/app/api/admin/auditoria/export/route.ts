import { NextRequest } from "next/server";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { exportarBitacora } from "@/lib/auditoria/rutas";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

/**
 * GET /api/admin/auditoria/export: la bitácora legal en Excel, con los filtros de la pantalla (sólo admin).
 * Mismos roles que su pantalla; lo cruza `nav-guard.test.ts`. La base vuelve a
 * exigir el rol. El tenant sale del perfil, nunca del request.
 */
export const runtime = "nodejs";

const ROLES = ["admin"] as const;

export const GET = conManejoDeAuditoria(async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  return exportarBitacora(request, "legal", { db: ctx.db, tenantId: ctx.tenantId, userId: ctx.userId });
});

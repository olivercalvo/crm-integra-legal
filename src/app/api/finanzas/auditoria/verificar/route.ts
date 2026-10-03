import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { verificarBitacoraRuta } from "@/lib/auditoria/rutas";

/**
 * POST /api/finanzas/auditoria/verificar: recalcula la cadena de la bitácora contable y la compara con sus anclas. Sólo lee. Admin y contador.
 */
const ROLES = ["admin", "contador"] as const;

export async function POST() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  return verificarBitacoraRuta("contable", { db: ctx.db, tenantId: ctx.tenantId, userId: ctx.userId });
}

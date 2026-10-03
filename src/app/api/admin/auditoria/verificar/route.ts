import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { verificarBitacoraRuta } from "@/lib/auditoria/rutas";

/**
 * POST /api/admin/auditoria/verificar: recalcula la cadena de la bitácora legal y la compara con sus anclas. Sólo lee. Sólo admin.
 */
const ROLES = ["admin"] as const;

export async function POST() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  return verificarBitacoraRuta("legal", { db: ctx.db, tenantId: ctx.tenantId, userId: ctx.userId });
}

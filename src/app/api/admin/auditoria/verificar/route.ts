import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { verificarBitacoraRuta } from "@/lib/auditoria/rutas";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

/**
 * POST /api/admin/auditoria/verificar: recalcula la cadena de la bitácora legal y la compara con sus anclas. Sólo lee. Sólo admin.
 */
const ROLES = ["admin"] as const;

export const POST = conManejoDeAuditoria(async function POST() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  return verificarBitacoraRuta("legal", { db: ctx.db, tenantId: ctx.tenantId, userId: ctx.userId });
});

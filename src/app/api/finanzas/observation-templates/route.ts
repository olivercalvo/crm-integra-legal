import { NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listObservationTemplatesActive } from "@/lib/finanzas/queries/observation-templates";

const READ_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * GET /api/finanzas/observation-templates
 *
 * Devuelve las plantillas activas del tenant ordenadas por sort_order para
 * popular el combobox "Insertar plantilla" del form de cotización
 * (Sprint QUOTES-POLISH).
 *
 * Permisos: admin + abogada + contador. El asistente queda fuera de
 * /finanzas por middleware; igual lo rechazamos acá por defensa en
 * profundidad.
 *
 * NOTA: el CRUD (POST/PUT/DELETE) queda para el Sprint ADMIN-CATALOGS
 * futuro. En este sprint solo exponemos lectura.
 */
export async function GET() {
  const ctx = await getAuthenticatedContext();
  if (!READ_ROLES.includes(ctx.userRole as (typeof READ_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const templates = await listObservationTemplatesActive(ctx.db, ctx.tenantId);
  return NextResponse.json({ templates }, { status: 200 });
}

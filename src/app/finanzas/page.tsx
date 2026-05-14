import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";

/**
 * Entrada al módulo Finanzas. Redirige según el rol:
 *   - contador → /finanzas/reportes (su única vista permitida)
 *   - admin, abogada → /finanzas/facturas (vista por defecto del MVP)
 *
 * Cuando exista un dashboard propio de Finanzas (cobros pendientes, aging,
 * etc.) admin/abogada apuntarán ahí. El contador siempre cae al hub de
 * reportes.
 */
export default async function FinanzasIndexPage() {
  const { userRole } = await getAuthenticatedContext();

  if (userRole === "contador") {
    redirect("/finanzas/reportes");
  }

  redirect("/finanzas/facturas");
}

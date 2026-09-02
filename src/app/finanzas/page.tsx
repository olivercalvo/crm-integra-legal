import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Finanzas",
};
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

import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { PaginaBitacora } from "@/components/auditoria/pagina-bitacora";

/**
 * Bitácora CONTABLE (03/10/2026): todo Finanzas, y de Legal sólo lo que cambia
 * una cifra o un permiso contable (datos fiscales del cliente, el gasto de
 * trámite que entra al asiento, accesos a Finanzas). Contador y admin, los dos
 * en solo lectura. El gate real es ADMIN_CONTADOR_ONLY_PREFIXES; este redirect
 * es defensa en profundidad.
 */
export default async function AuditoriaContablePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await getAuthenticatedContext();
  if (ctx.userRole !== "admin" && ctx.userRole !== "contador") redirect("/finanzas");
  return (
    <PaginaBitacora
      ctx={ctx}
      modulo="contable"
      titulo="Bitácora contable"
      descripcion="Quién cambió qué en Finanzas, con el antes y el después. Nadie la puede editar ni borrar."
      ruta="/finanzas/auditoria"
      rutaExport="/api/finanzas/auditoria/export"
      rutaVerificar="/api/finanzas/auditoria/verificar"
      searchParams={searchParams}
    />
  );
}

import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { PaginaBitacora } from "@/components/auditoria/pagina-bitacora";

/**
 * Bitácora LEGAL (03/10/2026): casos, documentos, tareas, comentarios, clientes,
 * gastos y cobros del caso, catálogos y usuarios. Sólo admin. La escribe la base
 * (087) y nadie la edita ni la borra (086). Reemplaza a la lectura de audit_log,
 * que queda en «Registro anterior» hasta que se copie el legado (088).
 */
export default async function AuditoriaLegalPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await getAuthenticatedContext();
  if (ctx.userRole !== "admin") redirect("/legal/admin");
  return (
    <PaginaBitacora
      ctx={ctx}
      modulo="legal"
      titulo="Bitácora legal"
      descripcion="Quién cambió qué en el módulo Legal, con el antes y el después. Nadie la puede editar ni borrar."
      ruta="/legal/admin/auditoria"
      rutaExport="/api/admin/auditoria/export"
      rutaVerificar="/api/admin/auditoria/verificar"
      enlaceAnterior="/legal/admin/auditoria/anterior"
      searchParams={searchParams}
    />
  );
}

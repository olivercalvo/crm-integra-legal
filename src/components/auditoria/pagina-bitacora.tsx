import type { SupabaseClient } from "@supabase/supabase-js";
import { VistaBitacora } from "@/components/auditoria/vista-bitacora";
import { filtrosDesdeParams, leerBitacora, type FilaBitacora, type ModuloBitacora } from "@/lib/auditoria/bitacoras";

const POR_PAGINA = 50;

interface Props {
  ctx: { db: SupabaseClient; tenantId: string; userId: string };
  modulo: ModuloBitacora;
  titulo: string;
  descripcion: string;
  ruta: string;
  rutaExport: string;
  rutaVerificar: string;
  enlaceAnterior?: string;
  searchParams: Record<string, string | undefined>;
}

/** Lee la bitácora (server) y la dibuja. El rol ya lo verificó la página; la base lo vuelve a exigir. */
export async function PaginaBitacora(p: Props) {
  const filtros = filtrosDesdeParams(p.modulo, p.searchParams);
  const pagina = Math.max(1, parseInt(p.searchParams.pagina ?? "1", 10) || 1);

  const { data: usuarios } = await p.ctx.db
    .from("users")
    .select("id, full_name, email")
    .eq("tenant_id", p.ctx.tenantId)
    .order("full_name");

  let filas: FilaBitacora[] = [];
  let total = 0;
  let error = "";
  try {
    ({ filas, total } = await leerBitacora(p.ctx.db, p.modulo, p.ctx.tenantId, p.ctx.userId, filtros, {
      limite: POR_PAGINA,
      offset: (pagina - 1) * POR_PAGINA,
    }));
  } catch (e) {
    console.error(`[auditoria] leer ${p.modulo}:`, e);
    error = "No se pudo leer la bitácora. Si es la primera vez, puede que la base todavía no la tenga.";
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <VistaBitacora
        modulo={p.modulo}
        titulo={p.titulo}
        descripcion={p.descripcion}
        filas={filas}
        total={total}
        pagina={pagina}
        porPagina={POR_PAGINA}
        filtros={filtros}
        usuarios={usuarios ?? []}
        ruta={p.ruta}
        rutaExport={p.rutaExport}
        rutaVerificar={p.rutaVerificar}
        enlaceAnterior={p.enlaceAnterior}
      />
    </div>
  );
}

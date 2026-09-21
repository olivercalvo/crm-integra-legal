import Link from "next/link";
import { Plus, HandCoins } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { PagePagination } from "@/components/ui/page-pagination";
import { EmptySearchResult } from "@/components/ui/empty-search-result";
import { listPayments } from "@/lib/finanzas/queries/payments";
import { listClientsActive } from "@/lib/finanzas/queries/catalogs";
import { CobrosFilters } from "./_components/cobros-filters";
import { CobrosList } from "./_components/cobros-list";
import { CobroSuccessToast } from "./_components/cobro-success-toast";

export const metadata = {
  title: "Cobros · Finanzas",
};

interface PageProps {
  searchParams: {
    q?: string;
    client?: string;
    from?: string;
    to?: string;
    estado?: string;
    page?: string;
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `/finanzas/cobros` — el listado de recibos de caja (Bloque 2, 21/09/2026).
 *
 * Roles: admin y abogada (mismo reparto que Facturas). El contador NO entra:
 * ve el número, baja el PDF y reversa desde el detalle de la factura. Queda
 * pendiente preguntarle a Josuarth si lo quiere ver (`task_plan.md`); si dice
 * que sí, es sumar "contador" al ítem de `nav-config.ts` Y el prefijo a
 * `CONTADOR_FINANZAS_PREFIXES`, los dos juntos.
 *
 * Los permisos por operación siguen en la API: registrar (admin/abogada) y
 * reversar (admin/abogada/contador) tienen su `requireRole` en cada ruta.
 */
export default async function CobrosListPage({ searchParams }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();

  const search = searchParams.q?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const clientId = searchParams.client?.trim() || null;
  const from = ISO_DATE.test(searchParams.from ?? "") ? searchParams.from! : null;
  const to = ISO_DATE.test(searchParams.to ?? "") ? searchParams.to! : null;
  const estado =
    searchParams.estado === "vigentes" || searchParams.estado === "reversados"
      ? searchParams.estado
      : null;

  const [result, clients] = await Promise.all([
    listPayments(db, tenantId, { search, client_id: clientId, from, to, estado, page }),
    listClientsActive(db, tenantId),
  ]);

  const hasFilters = !!(search || clientId || from || to || estado);
  // Misma regla que el detalle de la factura: admin y abogada registran; el
  // contador reversa. Acá el contador no llega (middleware), pero la bandera
  // se calcula igual para que la tabla no dependa de quién puede entrar.
  const canMutate = userRole === "admin" || userRole === "abogada";
  const canReverse = canMutate || userRole === "contador";

  return (
    <div className="space-y-5">
      <CobroSuccessToast />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <HandCoins size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-integra-navy">Cobros</h1>
            <p className="text-sm text-gray-500">
              {result.total === 0
                ? "Sin cobros"
                : `${result.total} recibo${result.total === 1 ? "" : "s"} de caja`}
            </p>
          </div>
        </div>
        {canMutate && (
          <Link href="/finanzas/cobros/nuevo">
            <Button className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]">
              <Plus size={18} className="mr-1" />
              Registrar cobro
            </Button>
          </Link>
        )}
      </div>

      <CobrosFilters
        clients={clients.map((c) => ({ id: c.id, name: c.name, client_number: c.client_number }))}
        initial={{ search, clientId: clientId ?? "", from: from ?? "", to: to ?? "", estado: estado ?? "" }}
      />

      {result.rows.length === 0 ? (
        <EmptySearchResult
          query={search}
          emptyMessage={
            hasFilters
              ? "No hay cobros que coincidan con los filtros aplicados."
              : "Aún no hay cobros. El primero se registra con el botón de arriba, o desde el detalle de una factura."
          }
        />
      ) : (
        <>
          <CobrosList payments={result.rows} canReverse={canReverse} />
          <PagePagination page={result.page} totalPages={result.totalPages} />
        </>
      )}
    </div>
  );
}

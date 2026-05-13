import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { PagePagination } from "@/components/ui/page-pagination";
import { EmptySearchResult } from "@/components/ui/empty-search-result";
import { DeleteSuccessToast } from "@/components/ui/delete-success-toast";
import { listQuotes } from "@/lib/finanzas/queries/quotes";
import { QuotesFilters } from "./_components/quotes-filters";
import { QuotesList } from "./_components/quotes-list";
import { DeniedToast } from "./_components/denied-toast";
import type { ClientOption, CaseOption } from "@/lib/finanzas/types/invoice";
import type { QuoteStatus } from "@/lib/finanzas/types/quote";

interface PageProps {
  searchParams: {
    q?: string;
    status?: string;
    client?: string;
    case?: string;
    page?: string;
  };
}

const ALLOWED_STATUS = new Set<QuoteStatus>([
  "borrador",
  "enviada",
  "aceptada",
  "rechazada",
  "expirada",
  "convertida",
  "cancelada_pre_envio",
]);

/**
 * Listado de cotizaciones. Server component que llama listQuotes() y arma
 * filtros + tabla + paginación. Refleja la misma arquitectura que el listado
 * de facturas pero con la columna "Vence" como `valid_until` y sin la
 * columna "Saldo" (no aplica a cotizaciones).
 *
 * Permisos: el middleware ya bloquea asistente fuera de /finanzas. Acá
 * verificamos una vez más por defensa en profundidad — abogada / admin /
 * contador pasan; cualquier otro rol redirige a /finanzas.
 */
export default async function CotizacionesListPage({ searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  const { db, tenantId } = ctx;

  const search = searchParams.q?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const status = ALLOWED_STATUS.has(searchParams.status as QuoteStatus)
    ? (searchParams.status as QuoteStatus)
    : null;
  const clientId = searchParams.client?.trim() || null;
  const caseId = searchParams.case?.trim() || null;

  // Para el filtro de cliente queremos TODOS los clientes (incluyendo prospects),
  // porque las cotizaciones pueden ser para prospects. Filtramos los inactivos
  // para no ofrecerlos como opción (las cotizaciones existentes seguirán
  // mostrándose en la tabla, pero el filtro no los oferta).
  const [quotesResult, clientsRes, casesRes] = await Promise.all([
    listQuotes(db, tenantId, {
      search,
      status: status ?? undefined,
      client_id: clientId ?? undefined,
      case_id: caseId ?? undefined,
      page,
    }),
    db
      .from("clients")
      .select("id, name, client_number, ruc")
      .eq("tenant_id", tenantId)
      .neq("client_status", "inactive")
      .order("name"),
    db
      .from("cases")
      .select("id, case_code, description")
      .eq("tenant_id", tenantId)
      .order("case_code"),
  ]);

  const clients = (clientsRes.data ?? []) as ClientOption[];
  const cases = (casesRes.data ?? []) as Pick<CaseOption, "id" | "case_code" | "description">[];
  const hasFilters = !!(search || status || clientId || caseId);

  return (
    <div className="space-y-5">
      <DeleteSuccessToast entityLabel="Cotización" />
      <DeniedToast />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-integra-navy">Cotizaciones</h1>
            <p className="text-sm text-gray-500">
              {quotesResult.total === 0
                ? "Sin cotizaciones"
                : `${quotesResult.total} cotización${quotesResult.total === 1 ? "" : "es"}`}
            </p>
          </div>
        </div>
        <Link href="/finanzas/cotizaciones/nueva">
          <Button className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]">
            <Plus size={18} className="mr-1" />
            Nueva cotización
          </Button>
        </Link>
      </div>

      {/* Filtros */}
      <QuotesFilters
        clients={clients}
        cases={cases}
        initial={{
          search,
          status: status ?? "",
          clientId: clientId ?? "",
          caseId: caseId ?? "",
        }}
      />

      {/* Lista o empty state */}
      {quotesResult.rows.length === 0 ? (
        <EmptySearchResult
          query={search}
          emptyMessage={
            hasFilters
              ? "No hay cotizaciones que coincidan con los filtros aplicados."
              : "Aún no hay cotizaciones. Crea la primera haciendo clic en «Nueva cotización»."
          }
        />
      ) : (
        <>
          <QuotesList quotes={quotesResult.rows} />
          <PagePagination
            page={quotesResult.page}
            totalPages={quotesResult.totalPages}
          />
        </>
      )}
    </div>
  );
}

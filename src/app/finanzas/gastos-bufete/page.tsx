import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShoppingBag } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { PagePagination } from "@/components/ui/page-pagination";
import { EmptySearchResult } from "@/components/ui/empty-search-result";
import { DeleteSuccessToast } from "@/components/ui/delete-success-toast";
import {
  listBusinessExpenses,
  listExpenseAccountOptions,
} from "@/lib/finanzas/queries/business-expenses";
import { BusinessExpenseList } from "./_components/business-expense-list";
import { BusinessExpenseFilters } from "./_components/business-expense-filters";
import type { BusinessExpenseStatus } from "@/lib/finanzas/types/business-expense";

interface PageProps {
  searchParams: {
    q?: string;
    status?: string;
    account?: string;
    from?: string;
    to?: string;
    has_itbms?: string;
    page?: string;
  };
}

const ALLOWED_STATUSES = new Set<BusinessExpenseStatus>([
  "pendiente_pago",
  "pagado",
]);
const ALLOWED_HAS_ITBMS = new Set(["true", "false"]);
const READING_ROLES = ["admin", "abogada", "contador"];
const MUTATING_ROLES = ["admin", "abogada", "contador"];

export default async function GastosBufeteListPage({ searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!READING_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }
  const { db, tenantId, userRole } = ctx;

  const search = searchParams.q?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const status = ALLOWED_STATUSES.has(searchParams.status as BusinessExpenseStatus)
    ? (searchParams.status as BusinessExpenseStatus)
    : null;
  const accountCode = searchParams.account?.trim() || null;
  const fromDate = searchParams.from?.trim() || null;
  const toDate = searchParams.to?.trim() || null;
  const hasItbmsRaw = searchParams.has_itbms;
  const hasItbms =
    hasItbmsRaw === "true" ? true
      : hasItbmsRaw === "false" ? false
      : null;

  const [result, accounts] = await Promise.all([
    listBusinessExpenses(db, tenantId, {
      status, accountCode, fromDate, toDate, hasItbms, search, page,
    }),
    listExpenseAccountOptions(db, tenantId),
  ]);

  const hasFilters = !!(search || status || accountCode || fromDate || toDate || hasItbms !== null);
  const canMutate = MUTATING_ROLES.includes(userRole);

  return (
    <div className="space-y-5">
      <DeleteSuccessToast entityLabel="Gasto" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <ShoppingBag size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-integra-navy">Gastos del Bufete</h1>
            <p className="text-sm text-gray-500">
              {result.total === 0
                ? "Sin gastos registrados"
                : `${result.total} gasto${result.total === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        {canMutate && (
          <Link href="/finanzas/gastos-bufete/nuevo">
            <Button className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]">
              <Plus size={18} className="mr-1" />
              Nuevo gasto
            </Button>
          </Link>
        )}
      </div>

      {/* Filtros */}
      <BusinessExpenseFilters
        accounts={accounts}
        initial={{
          search,
          status: status ?? "",
          accountCode: accountCode ?? "",
          fromDate: fromDate ?? "",
          toDate: toDate ?? "",
          hasItbms: (hasItbmsRaw && ALLOWED_HAS_ITBMS.has(hasItbmsRaw)
            ? hasItbmsRaw
            : "") as "true" | "false" | "",
        }}
      />

      {/* Lista o empty state */}
      {result.rows.length === 0 ? (
        <EmptySearchResult
          query={search}
          emptyMessage={
            hasFilters
              ? "No hay gastos que coincidan con los filtros aplicados."
              : canMutate
                ? "Aún no hay gastos del bufete. Registra el primero con el botón de arriba."
                : "Aún no hay gastos del bufete cargados."
          }
        />
      ) : (
        <>
          <BusinessExpenseList expenses={result.rows} />
          <PagePagination page={result.page} totalPages={result.totalPages} />
        </>
      )}
    </div>
  );
}

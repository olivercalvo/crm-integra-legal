import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { PagePagination } from "@/components/ui/page-pagination";
import { EmptySearchResult } from "@/components/ui/empty-search-result";
import { DeleteSuccessToast } from "@/components/ui/delete-success-toast";
import { listInvoices } from "@/lib/finanzas/queries/invoices";
import { listClientsActive } from "@/lib/finanzas/queries/catalogs";
import { InvoicesFilters } from "./_components/invoices-filters";
import { InvoicesList } from "./_components/invoices-list";
import type { InvoiceKind, InvoiceStatus } from "@/lib/finanzas/types/invoice";

interface PageProps {
  searchParams: {
    q?: string;
    status?: string;
    kind?: string;
    client?: string;
    page?: string;
  };
}

const ALLOWED_STATUS = new Set<InvoiceStatus>([
  "borrador",
  "emitida",
  "parcialmente_pagada",
  "pagada",
  "anulada",
  "cancelada_pre_emision",
]);
const ALLOWED_KINDS = new Set<InvoiceKind>(["HONORARIOS", "REEMBOLSO"]);

export default async function FacturasListPage({ searchParams }: PageProps) {
  const { db, tenantId } = await getAuthenticatedContext();

  const search = searchParams.q?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const status = ALLOWED_STATUS.has(searchParams.status as InvoiceStatus)
    ? (searchParams.status as InvoiceStatus)
    : null;
  const kind = ALLOWED_KINDS.has(searchParams.kind as InvoiceKind)
    ? (searchParams.kind as InvoiceKind)
    : null;
  const clientId = searchParams.client?.trim() || null;

  const [invoicesResult, clients] = await Promise.all([
    listInvoices(db, tenantId, { search, status, kind, client_id: clientId, page }),
    listClientsActive(db, tenantId),
  ]);

  const hasFilters = !!(search || status || kind || clientId);

  return (
    <div className="space-y-5">
      <DeleteSuccessToast entityLabel="Factura" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <Receipt size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-integra-navy">Facturas</h1>
            <p className="text-sm text-gray-500">
              {invoicesResult.total === 0
                ? "Sin facturas"
                : `${invoicesResult.total} factura${invoicesResult.total === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        <Link href="/finanzas/facturas/nueva">
          <Button className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]">
            <Plus size={18} className="mr-1" />
            Nueva factura
          </Button>
        </Link>
      </div>

      {/* Filtros */}
      <InvoicesFilters
        clients={clients.map((c) => ({
          id: c.id,
          name: c.name,
          client_number: c.client_number,
        }))}
        initial={{
          search,
          status: status ?? "",
          kind: kind ?? "",
          clientId: clientId ?? "",
        }}
      />

      {/* Lista o empty state */}
      {invoicesResult.rows.length === 0 ? (
        <EmptySearchResult
          query={search}
          emptyMessage={
            hasFilters
              ? "No hay facturas que coincidan con los filtros aplicados."
              : "Aún no hay facturas. Crea la primera con el botón de arriba."
          }
        />
      ) : (
        <>
          <InvoicesList invoices={invoicesResult.rows} />
          <PagePagination
            page={invoicesResult.page}
            totalPages={invoicesResult.totalPages}
          />
        </>
      )}
    </div>
  );
}

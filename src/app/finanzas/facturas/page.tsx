import { cargarInicioContable } from "@/lib/finanzas/contabilidad/inicio-contable";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { PagePagination } from "@/components/ui/page-pagination";
import { EmptySearchResult } from "@/components/ui/empty-search-result";
import { DeleteSuccessToast } from "@/components/ui/delete-success-toast";
import { listInvoices } from "@/lib/finanzas/queries/invoices";
import { contarPendientesDgi } from "@/lib/finanzas/queries/pendientes-dgi";
import { AvisoPendientesDgi } from "@/components/finanzas/aviso-pendientes-dgi";
import { listClientsActive } from "@/lib/finanzas/queries/catalogs";
import { InvoicesFilters } from "./_components/invoices-filters";
import { InvoicesList } from "./_components/invoices-list";
import type { InvoiceKind, InvoiceStatus } from "@/lib/finanzas/types/invoice";


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Facturas · Finanzas",
};
interface PageProps {
  searchParams: {
    q?: string;
    status?: string;
    kind?: string;
    client?: string;
    page?: string;
    /** `error` = sólo las que la DGI rechazó o dejó sin confirmar. */
    fe?: string;
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
const ALLOWED_KINDS = new Set<InvoiceKind>(["HONORARIOS", "REEMBOLSO", "NOTA_DEBITO"]);

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
  const soloConErrorDgi = searchParams.fe === "error";

  const [invoicesResult, clients, pendientesDgi, inicio] = await Promise.all([
    listInvoices(db, tenantId, {
      search,
      status,
      kind,
      client_id: clientId,
      fe_estado: soloConErrorDgi ? "error" : null,
      page,
    }),
    listClientsActive(db, tenantId),
    // 🔴 El contador se cuenta SIEMPRE, con o sin filtros puestos: es una
    //    alarma, no una columna del resultado. Si dependiera de los filtros,
    //    desaparecería justo cuando alguien está mirando otra cosa — que es
    //    cuando hace falta que se vea.
    contarPendientesDgi(db, tenantId),
    // 096: para la etiqueta «Contabilizado fuera».
    cargarInicioContable(db, tenantId),
  ]);

  const hasFilters = !!(search || status || kind || clientId || soloConErrorDgi);

  return (
    <div className="space-y-5">
      <DeleteSuccessToast entityLabel="Factura" />

      {/* 🔴 SIN AUTORIZACIÓN DE LA DGI (03/10/2026): cuenta también las que nunca
          se enviaron (no_emitida), no sólo las rechazadas. Así quedaron 4
          facturas de producción sin que nadie se enterara. Se cuenta SIEMPRE,
          con o sin filtros: es una alarma, no una columna. */}
      <AvisoPendientesDgi cantidad={pendientesDgi} />

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
              : "Aún no hay facturas. La primera se crea con el botón de arriba."
          }
        />
      ) : (
        <>
          <InvoicesList invoices={invoicesResult.rows} inicio={inicio} />
          <PagePagination
            page={invoicesResult.page}
            totalPages={invoicesResult.totalPages}
          />
        </>
      )}
    </div>
  );
}

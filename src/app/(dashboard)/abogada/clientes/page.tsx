import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ClientListSearch } from "@/components/clients/client-list";
import { PagePagination } from "@/components/ui/page-pagination";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Plus, User, FolderOpen } from "lucide-react";
import type { Client } from "@/types/database";

const PAGE_SIZE = 10;

const SORTABLE_COLUMNS: Record<string, string> = {
  client_number: "client_number",
  name: "name",
  ruc: "ruc",
  type: "type",
};

interface PageProps {
  searchParams: { q?: string; page?: string; sort?: string; dir?: string };
}

export default async function ClientesPage({ searchParams }: PageProps) {
  const { db, tenantId } = await getAuthenticatedContext();

  const search = searchParams.q?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sortColumn = SORTABLE_COLUMNS[searchParams.sort ?? ""] ?? "client_number";
  const sortDir = searchParams.dir === "desc" ? false : true;

  let query = db
    .from("clients")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order(sortColumn, { ascending: sortDir })
    .range(from, to);

  if (search) {
    query = query.or(
      `name.ilike.%${search}%,ruc.ilike.%${search}%,client_number.ilike.%${search}%`
    );
  }

  const { data: clients, count, error } = await query;

  if (error) {
    console.error("Error fetching clients:", error);
  }

  // Fetch active case counts per client
  const list: Client[] = clients ?? [];
  const clientIds = list.map((c) => c.id);

  let caseCounts: Record<string, { total: number; enTramite: number; cerrados: number }> = {};
  if (clientIds.length > 0) {
    const { data: caseData } = await db
      .from("cases")
      .select("client_id, cat_statuses(name)")
      .eq("tenant_id", tenantId)
      .in("client_id", clientIds);

    if (caseData) {
      for (const row of caseData as unknown as { client_id: string; cat_statuses: { name: string } | null }[]) {
        if (!caseCounts[row.client_id]) {
          caseCounts[row.client_id] = { total: 0, enTramite: 0, cerrados: 0 };
        }
        caseCounts[row.client_id].total++;
        const statusName = row.cat_statuses?.name?.toLowerCase() ?? "";
        if (statusName.includes("cerrado") || statusName.includes("cerrada")) {
          caseCounts[row.client_id].cerrados++;
        } else {
          caseCounts[row.client_id].enTramite++;
        }
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const currentSort = searchParams.sort ?? "";
  const currentDir = searchParams.dir ?? "asc";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-integra-navy">Clientes</h2>
          <p className="text-sm text-gray-500">
            {count ?? 0} cliente{(count ?? 0) !== 1 ? "s" : ""} activo{(count ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          asChild
          className="min-h-[48px] bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold"
        >
          <Link href="/abogada/clientes/nuevo">
            <Plus size={18} />
            Nuevo Cliente
          </Link>
        </Button>
      </div>

      {/* Search */}
      <ClientListSearch defaultSearch={search} />

      {/* Empty state */}
      {list.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <User size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">
            {search ? "No se encontraron clientes" : "Aún no hay clientes"}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {search
              ? "Intenta con otro término de búsqueda"
              : "Crea el primero haciendo clic en «Nuevo Cliente»"}
          </p>
        </div>
      )}

      {/* Mobile: card list */}
      {list.length > 0 && (
        <>
          <div className="flex flex-col gap-3 sm:hidden">
            {list.map((client) => (
              <Link
                key={client.id}
                href={`/abogada/clientes/${client.id}`}
                className="block"
              >
                <Card className="hover:shadow-md transition-shadow active:scale-[0.99]">
                  <CardContent className="p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-integra-navy leading-tight">
                          {client.name}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">{client.client_number}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {client.type && (
                          <Badge className={`border-0 text-xs ${client.type === "Retainer" ? "bg-integra-gold/20 text-integra-gold" : "bg-integra-navy/10 text-integra-navy"}`}>
                            {client.type}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                      {client.ruc && <span>RUC: {client.ruc}</span>}
                    </div>
                    {/* Case folder badges */}
                    {caseCounts[client.id] && caseCounts[client.id].total > 0 && (
                      <div className="mt-1.5 flex gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          <FolderOpen size={10} /> {caseCounts[client.id].total}
                        </span>
                        {caseCounts[client.id].enTramite > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                            <FolderOpen size={10} /> {caseCounts[client.id].enTramite} trámite
                          </span>
                        )}
                        {caseCounts[client.id].cerrados > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            <FolderOpen size={10} /> {caseCounts[client.id].cerrados} cerr.
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-hidden rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">
                    <SortableHeader column="client_number" label="N° Cliente" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader column="name" label="Nombre" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader column="ruc" label="RUC" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader column="type" label="Tipo de Cliente" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3 text-center">Casos</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/abogada/clientes/${client.id}`}
                        className="block font-mono text-xs text-gray-500 hover:text-integra-navy"
                      >
                        {client.client_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/abogada/clientes/${client.id}`}
                        className="block font-medium text-integra-navy hover:underline"
                      >
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{client.ruc ?? "—"}</td>
                    <td className="px-4 py-3">
                      {client.type ? (
                        <Badge className={`border-0 text-xs ${client.type === "Retainer" ? "bg-integra-gold/20 text-integra-gold font-semibold" : "bg-integra-navy/10 text-integra-navy"}`}>
                          {client.type}
                        </Badge>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {caseCounts[client.id] ? (
                          <>
                            <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700" title="Total">
                              <FolderOpen size={10} /> {caseCounts[client.id].total}
                            </span>
                            {caseCounts[client.id].enTramite > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700" title="En trámite">
                                <FolderOpen size={10} /> {caseCounts[client.id].enTramite}
                              </span>
                            )}
                            {caseCounts[client.id].cerrados > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600" title="Cerrados">
                                <FolderOpen size={10} /> {caseCounts[client.id].cerrados}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <PagePagination page={page} totalPages={totalPages} />
        </>
      )}
    </div>
  );
}

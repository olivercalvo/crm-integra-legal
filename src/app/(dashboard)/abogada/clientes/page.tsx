import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ClientListSearch, ClientListPagination } from "@/components/clients/client-list";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Plus, User, Phone, FolderOpen } from "lucide-react";
import type { Client } from "@/types/database";

const PAGE_SIZE = 10;

const SORTABLE_COLUMNS: Record<string, string> = {
  client_number: "client_number",
  name: "name",
  ruc: "ruc",
  phone: "phone",
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

  let caseCounts: Record<string, number> = {};
  if (clientIds.length > 0) {
    const { data: caseData } = await db
      .from("cases")
      .select("client_id")
      .eq("tenant_id", tenantId)
      .in("client_id", clientIds);

    if (caseData) {
      caseCounts = caseData.reduce((acc: Record<string, number>, row: { client_id: string }) => {
        acc[row.client_id] = (acc[row.client_id] || 0) + 1;
        return acc;
      }, {});
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
                        {(caseCounts[client.id] ?? 0) > 0 && (
                          <Badge className="bg-green-100 text-green-700 border-0 text-xs gap-1">
                            <FolderOpen size={11} />
                            {caseCounts[client.id]}
                          </Badge>
                        )}
                        {client.type && (
                          <Badge className="bg-integra-navy/10 text-integra-navy border-0 text-xs">
                            {client.type}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                      {client.ruc && <span>RUC: {client.ruc}</span>}
                      {client.phone && (
                        <span className="flex items-center gap-1">
                          <Phone size={13} /> {client.phone}
                        </span>
                      )}
                    </div>
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
                    <SortableHeader column="phone" label="Teléfono" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3">
                    <SortableHeader column="type" label="Clasificación" currentSort={currentSort} currentDir={currentDir} />
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
                    <td className="px-4 py-3 text-gray-500">{client.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {client.type ? (
                        <Badge className="bg-integra-navy/10 text-integra-navy border-0 text-xs">
                          {client.type}
                        </Badge>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(caseCounts[client.id] ?? 0) > 0 ? (
                        <Badge className="bg-green-100 text-green-700 border-0 text-xs gap-1">
                          <FolderOpen size={11} />
                          {caseCounts[client.id]}
                        </Badge>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <ClientListPagination page={page} totalPages={totalPages} />
        </>
      )}
    </div>
  );
}

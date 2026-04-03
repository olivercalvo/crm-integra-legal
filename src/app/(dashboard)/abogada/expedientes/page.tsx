import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { Plus, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CaseFilters } from "@/components/cases/case-filters";
import { SortableHeader } from "@/components/ui/sortable-header";
import { PagePagination } from "@/components/ui/page-pagination";

const PAGE_SIZE = 10;

function getStatusStyle(statusName: string): string {
  const name = statusName.toLowerCase();
  if (name.includes("activo") || name.includes("activa")) {
    return "border-transparent bg-green-100 text-green-800";
  }
  if (name.includes("trámite") || name.includes("tramite") || name.includes("proceso")) {
    return "border-transparent bg-amber-100 text-amber-800";
  }
  if (name.includes("cerrado") || name.includes("cerrada") || name.includes("archivado")) {
    return "border-transparent bg-gray-100 text-gray-600";
  }
  return "border-transparent bg-blue-100 text-blue-800";
}

const SORTABLE_COLUMNS: Record<string, string> = {
  case_code: "case_code",
  description: "description",
  opened_at: "opened_at",
  updated_at: "updated_at",
  status: "status_id",
  responsible: "responsible_id",
  classification: "classification_id",
};

interface PageProps {
  searchParams: {
    q?: string;
    status?: string;
    classification?: string;
    responsible?: string;
    institution?: string;
    page?: string;
    sort?: string;
    dir?: string;
  };
}

export default async function ExpedientesPage({ searchParams }: PageProps) {
  const { db, tenantId } = await getAuthenticatedContext();

  const currentPage = Number(searchParams.page ?? "1");
  const offset = (currentPage - 1) * PAGE_SIZE;

  const sortColumn = SORTABLE_COLUMNS[searchParams.sort ?? ""] ?? "updated_at";
  const sortDir = searchParams.sort
    ? searchParams.dir === "desc"
      ? false
      : true
    : false; // default desc for updated_at

  // Load catalogs for filters in parallel
  const [statusesRes, classificationsRes, teamRes, institutionsRes] =
    await Promise.all([
      db
        .from("cat_statuses")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("cat_classifications")
        .select("id, name, prefix")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("cat_team")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("cat_institutions")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
    ]);

  // Build cases query with filters
  let query = db
    .from("cases")
    .select(
      `
      id, case_code, description, opened_at, updated_at, assistant_id,
      clients!inner(id, name, client_number),
      cat_statuses(id, name),
      cat_classifications(id, name, prefix),
      cat_team(id, name)
    `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order(sortColumn, { ascending: sortDir })
    .range(offset, offset + PAGE_SIZE - 1);

  // Apply filters
  if (searchParams.status) query = query.eq("status_id", searchParams.status);
  if (searchParams.classification) query = query.eq("classification_id", searchParams.classification);
  if (searchParams.responsible) query = query.eq("responsible_id", searchParams.responsible);
  if (searchParams.institution) query = query.eq("institution_id", searchParams.institution);

  if (searchParams.q) {
    const q = `%${searchParams.q}%`;
    query = query.or(`case_code.ilike.${q},description.ilike.${q}`);
  }

  const { data: cases, count } = await query;

  // Fetch assistant names from users table
  const assistantIds = (cases ?? [])
    .map((c) => (c as Record<string, unknown>).assistant_id as string | null)
    .filter(Boolean) as string[];

  let assistantMap: Record<string, string> = {};
  if (assistantIds.length > 0) {
    const { data: assistants } = await db
      .from("users")
      .select("id, full_name")
      .in("id", [...new Set(assistantIds)]);
    if (assistants) {
      assistantMap = Object.fromEntries(
        assistants.map((a: { id: string; full_name: string }) => [a.id, a.full_name])
      );
    }
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);
  const statuses = statusesRes.data ?? [];
  const classifications = classificationsRes.data ?? [];
  const teamList = teamRes.data ?? [];
  const institutions = institutionsRes.data ?? [];
  const currentSort = searchParams.sort ?? "";
  const currentDir = searchParams.dir ?? "desc";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Casos</h1>
          <p className="text-sm text-gray-500">{count ?? 0} casos encontrados</p>
        </div>
        <Button asChild className="min-h-[48px] bg-integra-navy px-4 hover:bg-integra-navy/90">
          <Link href="/abogada/expedientes/nuevo">
            <Plus size={18} className="mr-1" />
            Nuevo Caso
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <CaseFilters
        statuses={statuses}
        classifications={classifications}
        team={teamList}
        institutions={institutions}
      />

      {/* Desktop table */}
      <div className="hidden lg:block">
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <SortableHeader column="case_code" label="Código" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Cliente</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <SortableHeader column="description" label="Descripción" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <SortableHeader column="status" label="Estado" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <SortableHeader column="responsible" label="Abogada" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Asistente</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <SortableHeader column="classification" label="Clasificación" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <SortableHeader column="opened_at" label="Apertura" currentSort={currentSort} currentDir={currentDir} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cases && cases.length > 0 ? (
                  cases.map((c) => {
                    const status = c.cat_statuses as unknown as { id: string; name: string } | null;
                    const client = c.clients as unknown as { id: string; name: string; client_number: string } | null;
                    const classification = c.cat_classifications as unknown as { id: string; name: string; prefix: string } | null;
                    const responsible = c.cat_team as unknown as { id: string; name: string } | null;
                    const assistantName = (c as Record<string, unknown>).assistant_id
                      ? assistantMap[(c as Record<string, unknown>).assistant_id as string] ?? "—"
                      : "—";

                    return (
                      <tr key={c.id} className="cursor-pointer transition-colors hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link href={`/abogada/expedientes/${c.id}`} className="block font-mono font-semibold text-integra-navy">
                            {c.case_code}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/abogada/expedientes/${c.id}`} className="block">
                            <span className="font-medium">{client?.name ?? "—"}</span>
                            <span className="block text-xs text-gray-400">{client?.client_number}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <Link href={`/abogada/expedientes/${c.id}`} className="block">
                            <span className="line-clamp-2 text-gray-600">{c.description || "—"}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {status ? (
                            <Badge className={getStatusStyle(status.name)}>{status.name}</Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{responsible?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-700">{assistantName}</td>
                        <td className="px-4 py-3 text-gray-700">{classification?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {c.opened_at ? new Date(c.opened_at).toLocaleDateString("es-PA") : "—"}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                      <FolderOpen size={40} className="mx-auto mb-2 opacity-40" />
                      <p>No se encontraron casos</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 lg:hidden">
        {cases && cases.length > 0 ? (
          cases.map((c) => {
            const status = c.cat_statuses as unknown as { id: string; name: string } | null;
            const client = c.clients as unknown as { id: string; name: string; client_number: string } | null;
            const classification = c.cat_classifications as unknown as { id: string; name: string } | null;
            const responsible = c.cat_team as unknown as { id: string; name: string } | null;
            const assistantName = (c as Record<string, unknown>).assistant_id
              ? assistantMap[(c as Record<string, unknown>).assistant_id as string] ?? null
              : null;

            return (
              <Link key={c.id} href={`/abogada/expedientes/${c.id}`}>
                <Card className="transition-colors hover:bg-gray-50 active:bg-gray-100">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono font-bold text-integra-navy">{c.case_code}</p>
                        <p className="font-medium text-gray-900 truncate">{client?.name ?? "—"}</p>
                        {c.description && (
                          <p className="mt-1 text-sm text-gray-500 line-clamp-2">{c.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                          {responsible && <span>Abogada: {responsible.name}</span>}
                          {assistantName && <span>Asistente: {assistantName}</span>}
                          {classification && <span>{classification.name}</span>}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {status && <Badge className={getStatusStyle(status.name)}>{status.name}</Badge>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        ) : (
          <div className="py-12 text-center text-gray-400">
            <FolderOpen size={40} className="mx-auto mb-2 opacity-40" />
            <p>No se encontraron casos</p>
          </div>
        )}
      </div>

      {/* Pagination with page numbers */}
      <PagePagination page={currentPage} totalPages={totalPages} />
    </div>
  );
}

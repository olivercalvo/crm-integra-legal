import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus, FolderOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CaseFilters } from "@/components/cases/case-filters";

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

interface PageProps {
  searchParams: {
    q?: string;
    status?: string;
    classification?: string;
    responsible?: string;
    institution?: string;
    page?: string;
  };
}

export default async function ExpedientesPage({ searchParams }: PageProps) {
  const supabase = createClient();

  const currentPage = Number(searchParams.page ?? "1");
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Load catalogs for filters in parallel
  const [statusesRes, classificationsRes, teamRes, institutionsRes] =
    await Promise.all([
      supabase
        .from("cat_statuses")
        .select("id, name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("cat_classifications")
        .select("id, name, prefix")
        .eq("active", true)
        .order("name"),
      supabase
        .from("cat_team")
        .select("id, name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("cat_institutions")
        .select("id, name")
        .eq("active", true)
        .order("name"),
    ]);

  // Build cases query with filters
  let query = supabase
    .from("cases")
    .select(
      `
      id, case_code, description, opened_at, updated_at,
      clients!inner(id, name, client_number),
      cat_statuses(id, name),
      cat_classifications(id, name, prefix),
      cat_team(id, name)
    `,
      { count: "exact" }
    )
    .order("updated_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // Apply filters
  if (searchParams.status) {
    query = query.eq("status_id", searchParams.status);
  }
  if (searchParams.classification) {
    query = query.eq("classification_id", searchParams.classification);
  }
  if (searchParams.responsible) {
    query = query.eq("responsible_id", searchParams.responsible);
  }
  if (searchParams.institution) {
    query = query.eq("institution_id", searchParams.institution);
  }

  // Text search across case_code, description, and client name (via ilike on text fields)
  if (searchParams.q) {
    const q = `%${searchParams.q}%`;
    query = query.or(
      `case_code.ilike.${q},description.ilike.${q}`
    );
  }

  const { data: cases, count } = await query;

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  const statuses = statusesRes.data ?? [];
  const classifications = classificationsRes.data ?? [];
  const teamList = teamRes.data ?? [];
  const institutions = institutionsRes.data ?? [];

  // Build pagination URL helper
  const buildPageUrl = (page: number) => {
    const params = new URLSearchParams();
    if (searchParams.q) params.set("q", searchParams.q);
    if (searchParams.status) params.set("status", searchParams.status);
    if (searchParams.classification) params.set("classification", searchParams.classification);
    if (searchParams.responsible) params.set("responsible", searchParams.responsible);
    if (searchParams.institution) params.set("institution", searchParams.institution);
    params.set("page", String(page));
    return `/abogada/expedientes?${params.toString()}`;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-integra-navy">
            Expedientes
          </h1>
          <p className="text-sm text-gray-500">
            {count ?? 0} expedientes encontrados
          </p>
        </div>
        <Button
          asChild
          className="min-h-[48px] bg-integra-navy px-4 hover:bg-integra-navy/90"
        >
          <Link href="/abogada/expedientes/nuevo">
            <Plus size={18} className="mr-1" />
            Nuevo Expediente
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
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Código
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Cliente
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Descripción
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Estado
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Responsable
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Clasificación
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

                  return (
                    <tr
                      key={c.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/abogada/expedientes/${c.id}`}
                          className="block w-full"
                        >
                          <span className="font-mono font-semibold text-integra-navy">
                            {c.case_code}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/abogada/expedientes/${c.id}`} className="block w-full">
                          <span className="font-medium">{client?.name ?? "—"}</span>
                          <span className="block text-xs text-gray-400">
                            {client?.client_number}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <Link href={`/abogada/expedientes/${c.id}`} className="block w-full">
                          <span className="line-clamp-2 text-gray-600">
                            {c.description || "—"}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/abogada/expedientes/${c.id}`} className="block w-full">
                          {status ? (
                            <Badge className={getStatusStyle(status.name)}>
                              {status.name}
                            </Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/abogada/expedientes/${c.id}`} className="block w-full">
                          <span className="text-gray-700">{responsible?.name ?? "—"}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/abogada/expedientes/${c.id}`} className="block w-full">
                          <span className="text-gray-700">{classification?.name ?? "—"}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-gray-400"
                  >
                    <FolderOpen size={40} className="mx-auto mb-2 opacity-40" />
                    <p>No se encontraron expedientes</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 lg:hidden">
        {cases && cases.length > 0 ? (
          cases.map((c) => {
            const status = c.cat_statuses as unknown as { id: string; name: string } | null;
            const client = c.clients as unknown as { id: string; name: string; client_number: string } | null;
            const classification = c.cat_classifications as unknown as { id: string; name: string; prefix: string } | null;
            const responsible = c.cat_team as unknown as { id: string; name: string } | null;

            return (
              <Link key={c.id} href={`/abogada/expedientes/${c.id}`}>
                <Card className="transition-colors hover:bg-gray-50 active:bg-gray-100">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono font-bold text-integra-navy">
                          {c.case_code}
                        </p>
                        <p className="font-medium text-gray-900 truncate">
                          {client?.name ?? "—"}
                        </p>
                        {c.description && (
                          <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                            {c.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                          {responsible && <span>👤 {responsible.name}</span>}
                          {classification && <span>📁 {classification.name}</span>}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {status ? (
                          <Badge className={getStatusStyle(status.name)}>
                            {status.name}
                          </Badge>
                        ) : null}
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
            <p>No se encontraron expedientes</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-gray-500">
            Página {currentPage} de {totalPages}
          </p>
          <div className="flex gap-2">
            {currentPage > 1 && (
              <Button asChild variant="outline" size="sm" className="min-h-[40px]">
                <Link href={buildPageUrl(currentPage - 1)}>
                  <ChevronLeft size={16} className="mr-1" />
                  Anterior
                </Link>
              </Button>
            )}
            {currentPage < totalPages && (
              <Button asChild variant="outline" size="sm" className="min-h-[40px]">
                <Link href={buildPageUrl(currentPage + 1)}>
                  Siguiente
                  <ChevronRight size={16} className="ml-1" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

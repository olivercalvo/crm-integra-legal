import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { FolderOpen, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format-date";

function getStatusStyle(statusName: string): string {
  const name = statusName.toLowerCase();
  if (name.includes("activo") || name.includes("activa")) {
    return "border-transparent bg-green-100 text-green-800";
  }
  if (
    name.includes("trámite") ||
    name.includes("tramite") ||
    name.includes("proceso")
  ) {
    return "border-transparent bg-amber-100 text-amber-800";
  }
  if (
    name.includes("cerrado") ||
    name.includes("cerrada") ||
    name.includes("archivado")
  ) {
    return "border-transparent bg-gray-100 text-gray-600";
  }
  return "border-transparent bg-blue-100 text-blue-800";
}

interface PageProps {
  searchParams: { q?: string };
}

export default async function AsistenteCasosPage({ searchParams }: PageProps) {
  const { db, user } = await getAuthenticatedContext();

  const q = searchParams.q?.trim() ?? "";

  // 1. Find cases where the asistente is in cat_team via responsible_id
  const { data: teamEntries } = await db
    .from("cat_team")
    .select("id")
    .eq("user_id", user.id);

  const teamIds = (teamEntries ?? []).map((t) => t.id);

  // 2. Find cases where the asistente has an assigned task
  const { data: taskCases } = await db
    .from("tasks")
    .select("case_id")
    .eq("assigned_to", user.id);

  const taskCaseIdsRaw = (taskCases ?? []).map((t) => t.case_id as string);
  const taskCaseIds = taskCaseIdsRaw.filter(
    (id, idx) => taskCaseIdsRaw.indexOf(id) === idx
  );

  // Fetch cases matching teamIds (responsible_id) and taskCaseIds (id)
  let query = db
    .from("cases")
    .select(
      `
      id, case_code, description, updated_at,
      clients!inner(id, name),
      cat_statuses(id, name)
    `
    )
    .order("updated_at", { ascending: false });

  // Build filter: responsible_id in teamIds OR id in taskCaseIds
  const orParts: string[] = [];
  if (teamIds.length > 0) {
    orParts.push(`responsible_id.in.(${teamIds.join(",")})`);
  }
  if (taskCaseIds.length > 0) {
    orParts.push(`id.in.(${taskCaseIds.join(",")})`);
  }

  if (orParts.length === 0) {
    // No assignments at all — return empty
    return (
      <EmptyState q={q} noAssignments />
    );
  }

  query = query.or(orParts.join(","));

  // Text search
  if (q) {
    query = query.or(`case_code.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data: cases } = await query;

  // Also client-name search: filter in JS since client name is nested
  const filtered = q
    ? (cases ?? []).filter((c) => {
        const client = c.clients as unknown as { name: string } | null;
        const matchesClient = client?.name
          ?.toLowerCase()
          .includes(q.toLowerCase());
        const matchesCode = c.case_code
          ?.toLowerCase()
          .includes(q.toLowerCase());
        const matchesDesc = c.description
          ?.toLowerCase()
          .includes(q.toLowerCase());
        return matchesClient || matchesCode || matchesDesc;
      })
    : (cases ?? []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">
          Mis Casos
        </h1>
        <p className="text-sm text-gray-500">
          {filtered.length} caso{filtered.length !== 1 ? "s" : ""} asignado
          {filtered.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Search */}
      <form method="GET" className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          name="q"
          type="text"
          defaultValue={q}
          placeholder="Buscar por código o cliente..."
          className="h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 text-sm placeholder:text-gray-400 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
        />
      </form>

      {/* Cases list */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((c) => {
            const client = c.clients as unknown as { id: string; name: string } | null;
            const status = c.cat_statuses as unknown as {
              id: string;
              name: string;
            } | null;

            return (
              <Link key={c.id} href={`/asistente/casos/${c.id}`}>
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
                        <p className="mt-2 text-xs text-gray-400">
                          Actualizado: {formatDate(c.updated_at)}
                        </p>
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
          })}
        </div>
      ) : (
        <EmptyState q={q} />
      )}
    </div>
  );
}

function EmptyState({
  q,
  noAssignments,
}: {
  q?: string;
  noAssignments?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <FolderOpen size={48} className="mb-3 opacity-40" />
      {noAssignments ? (
        <>
          <p className="text-base font-medium text-gray-500">
            No tienes casos asignados
          </p>
          <p className="text-sm">
            Contacta a tu abogada para que te asigne casos o tareas.
          </p>
        </>
      ) : q ? (
        <>
          <p className="text-base font-medium text-gray-500">
            Sin resultados para "{q}"
          </p>
          <p className="text-sm">Intenta con otro término de búsqueda.</p>
        </>
      ) : (
        <>
          <p className="text-base font-medium text-gray-500">
            No hay casos disponibles
          </p>
        </>
      )}
    </div>
  );
}

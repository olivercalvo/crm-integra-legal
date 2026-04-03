import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AuditFilters } from "@/components/admin/audit-filters";
import { ENTITY_OPTIONS } from "@/lib/constants/audit";
import { AuditExport } from "@/components/admin/audit-export";
import { FileText, ChevronLeft, ChevronRight } from "lucide-react";
import type { AuditLog } from "@/types/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by Supabase when joining users */
interface AuditRow extends AuditLog {
  users: {
    full_name: string | null;
    email: string | null;
  } | null;
}

interface PageProps {
  searchParams: {
    entity?: string;
    user_id?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    page?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// Map entity keys to Spanish labels
const ENTITY_LABELS: Record<string, string> = Object.fromEntries(
  ENTITY_OPTIONS.map((o) => [o.value, o.label])
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ActionBadge({ action }: { action: AuditRow["action"] }) {
  const map: Record<AuditRow["action"], { label: string; className: string }> = {
    create: {
      label: "Creación",
      className: "bg-green-100 text-green-800 border-green-200",
    },
    update: {
      label: "Actualización",
      className: "bg-amber-100 text-amber-800 border-amber-200",
    },
    delete: {
      label: "Eliminación",
      className: "bg-red-100 text-red-800 border-red-200",
    },
  };
  const { label, className } = map[action] ?? {
    label: action,
    className: "bg-gray-100 text-gray-700",
  };
  return (
    <Badge variant="outline" className={`text-xs font-medium ${className}`}>
      {label}
    </Badge>
  );
}

function formatValue(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  // Truncate very long values to keep the table readable
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function getUserName(row: AuditRow): string {
  return row.users?.full_name || row.users?.email || row.user_id || "Sistema";
}

function getEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

// ---------------------------------------------------------------------------
// Page Component (Server Component)
// ---------------------------------------------------------------------------

export default async function AuditoriaPage({ searchParams }: PageProps) {
  const { db, userRole, tenantId } = await getAuthenticatedContext();

  if (userRole !== "admin") {
    redirect("/admin");
  }

  // Parse filters from URL
  const entity   = searchParams.entity   ?? "";
  const userId   = searchParams.user_id  ?? "";
  const action   = searchParams.action   ?? "";
  const dateFrom = searchParams.date_from ?? "";
  const dateTo   = searchParams.date_to   ?? "";
  const page     = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const from     = (page - 1) * PAGE_SIZE;
  const to       = from + PAGE_SIZE - 1;

  // Fetch users for filter dropdown (same tenant)
  const { data: tenantUsers } = await db
    .from("users")
    .select("id, full_name, email")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("full_name");

  // Build main query
  let query = db
    .from("audit_log")
    .select(
      `
      id, tenant_id, user_id, entity, entity_id, action,
      field, old_value, new_value, created_at,
      users:user_id ( full_name, email )
    `,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (entity)   query = query.eq("entity", entity);
  if (userId)   query = query.eq("user_id", userId);
  if (action && ["create", "update", "delete"].includes(action)) {
    query = query.eq("action", action as "create" | "update" | "delete");
  }
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo)   query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const { data: rows, count, error } = await query;

  if (error) {
    console.error("Error fetching audit log:", error);
  }

  const auditRows: AuditRow[] = (rows ?? []) as unknown as AuditRow[];
  const total      = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build pagination URL helper
  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (entity)   params.set("entity",    entity);
    if (userId)   params.set("user_id",   userId);
    if (action)   params.set("action",    action);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo)   params.set("date_to",   dateTo);
    if (p > 1)    params.set("page",      String(p));
    const qs = params.toString();
    return `/admin/auditoria${qs ? `?${qs}` : ""}`;
  }

  // Filename for export
  const today = new Date().toISOString().slice(0, 10);
  const exportFilename = `auditoria-${today}`;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-integra-navy">
            Auditoría del Sistema
          </h2>
          <p className="text-sm text-gray-500">
            {total.toLocaleString("es-PA")} registro
            {total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}
          </p>
        </div>
        <AuditExport data={auditRows} filename={exportFilename} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filters                                                              */}
      {/* ------------------------------------------------------------------ */}
      <AuditFilters
        users={tenantUsers ?? []}
        currentFilters={{ entity, user_id: userId, action, date_from: dateFrom, date_to: dateTo }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Empty state                                                          */}
      {/* ------------------------------------------------------------------ */}
      {auditRows.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <FileText size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">No se encontraron registros</p>
          <p className="mt-1 text-sm text-gray-400">
            Ajusta los filtros para ver resultados
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Mobile: card layout                                                  */}
      {/* ------------------------------------------------------------------ */}
      {auditRows.length > 0 && (
        <>
          <div className="flex flex-col gap-3 sm:hidden">
            {auditRows.map((row) => (
              <Card key={row.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-2">
                  {/* Top row: timestamp + action badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-gray-400">
                      {formatTimestamp(row.created_at)}
                    </span>
                    <ActionBadge action={row.action} />
                  </div>

                  {/* User + entity */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium text-integra-navy">
                      {getUserName(row)}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600">
                      {getEntityLabel(row.entity)}
                    </span>
                    {row.field && (
                      <>
                        <span className="text-gray-400">·</span>
                        <span className="font-mono text-xs text-gray-500">
                          {row.field}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Old → New values */}
                  {(row.old_value || row.new_value) && (
                    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs space-y-1">
                      {row.old_value && (
                        <div className="flex gap-2">
                          <span className="shrink-0 text-gray-400">Antes:</span>
                          <span className="text-gray-600 break-all">
                            {formatValue(row.old_value)}
                          </span>
                        </div>
                      )}
                      {row.new_value && (
                        <div className="flex gap-2">
                          <span className="shrink-0 text-gray-400">Ahora:</span>
                          <span className="font-medium text-integra-navy break-all">
                            {formatValue(row.new_value)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Desktop: table layout                                            */}
          {/* -------------------------------------------------------------- */}
          <div className="hidden overflow-hidden rounded-xl border bg-white sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 whitespace-nowrap">Fecha y hora</th>
                    <th className="px-4 py-3">Usuario</th>
                    <th className="px-4 py-3">Acción</th>
                    <th className="px-4 py-3">Entidad</th>
                    <th className="px-4 py-3">Campo</th>
                    <th className="px-4 py-3">Antes</th>
                    <th className="px-4 py-3">Ahora</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {auditRows.map((row) => (
                    <tr
                      key={row.id}
                      className="transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                        {formatTimestamp(row.created_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-integra-navy whitespace-nowrap">
                        {getUserName(row)}
                      </td>
                      <td className="px-4 py-3">
                        <ActionBadge action={row.action} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {getEntityLabel(row.entity)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {row.field ?? "—"}
                      </td>
                      <td className="max-w-[160px] px-4 py-3 text-xs text-gray-500 break-words">
                        {formatValue(row.old_value)}
                      </td>
                      <td className="max-w-[160px] px-4 py-3 text-xs font-medium text-integra-navy break-words">
                        {formatValue(row.new_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Pagination                                                       */}
          {/* -------------------------------------------------------------- */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-gray-500">
                Página {page} de {totalPages} &nbsp;·&nbsp;{" "}
                {total.toLocaleString("es-PA")} registros en total
              </p>
              <div className="flex gap-2">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-[40px] gap-1"
                  disabled={page <= 1}
                >
                  <Link href={pageUrl(page - 1)}>
                    <ChevronLeft size={15} />
                    Anterior
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-[40px] gap-1"
                  disabled={page >= totalPages}
                >
                  <Link href={pageUrl(page + 1)}>
                    Siguiente
                    <ChevronRight size={15} />
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

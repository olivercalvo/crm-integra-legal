import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import {
  ListTodo,
  MessageSquare,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format-date";

function isOverdue(deadline: string | null, status: string) {
  if (!deadline || status === "cumplida") return false;
  const today = new Date().toISOString().split("T")[0];
  return deadline < today;
}

interface TaskRow {
  id: string;
  description: string;
  deadline: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
  case_id: string;
  caseCode: string;
  clientName: string;
  assignedTo: string | null;
}

interface CommentRow {
  id: string;
  text: string;
  created_at: string;
  follow_up_date: string | null;
  case_id: string;
  caseCode: string;
  clientName: string;
  userName: string;
}

export default async function SeguimientoPage() {
  const { db, tenantId } = await getAuthenticatedContext();

  // Fetch tasks with case + client + assigned user info
  const { data: tasksRaw } = await db
    .from("tasks")
    .select(`
      id, description, deadline, status, completed_at, created_at, case_id, assigned_to,
      cases!inner(case_code, clients!inner(name)),
      assigned:users!tasks_assigned_to_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  // Fetch recent comments with case + client info
  const { data: commentsRaw } = await db
    .from("comments")
    .select(`
      id, text, created_at, follow_up_date, case_id,
      cases!inner(case_code, clients!inner(name)),
      users(full_name)
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  const tasks: TaskRow[] = (tasksRaw ?? []).map((t: Record<string, unknown>) => {
    const c = t.cases as { case_code: string; clients: { name: string } };
    const assigned = t.assigned as { full_name: string } | null;
    return {
      id: t.id as string,
      description: t.description as string,
      deadline: t.deadline as string | null,
      status: t.status as string,
      completed_at: t.completed_at as string | null,
      created_at: t.created_at as string,
      case_id: t.case_id as string,
      caseCode: c.case_code,
      clientName: c.clients.name,
      assignedTo: assigned?.full_name ?? null,
    };
  });

  const comments: CommentRow[] = (commentsRaw ?? []).map((c: Record<string, unknown>) => {
    const cs = c.cases as { case_code: string; clients: { name: string } };
    const u = c.users as { full_name: string } | null;
    return {
      id: c.id as string,
      text: c.text as string,
      created_at: c.created_at as string,
      follow_up_date: c.follow_up_date as string | null,
      case_id: c.case_id as string,
      caseCode: cs.case_code,
      clientName: cs.clients.name,
      userName: u?.full_name ?? "Sistema",
    };
  });

  const pendientes = tasks.filter((t) => t.status === "pendiente");
  const cumplidas = tasks.filter((t) => t.status === "cumplida");
  const overdueCount = pendientes.filter((t) => isOverdue(t.deadline, t.status)).length;

  // Build unified timeline (tasks + comments) sorted by date
  type TimelineEntry =
    | { type: "task"; data: TaskRow; date: string }
    | { type: "comment"; data: CommentRow; date: string };

  const timeline: TimelineEntry[] = [
    ...tasks.map((t) => ({
      type: "task" as const,
      data: t,
      date: t.created_at,
    })),
    ...comments.map((c) => ({
      type: "comment" as const,
      data: c,
      date: c.created_at,
    })),
  ].sort((a, b) => (a.date > b.date ? -1 : 1));

  // Group by case for the grouped view
  const caseMap = new Map<string, { code: string; client: string; entries: TimelineEntry[] }>();
  for (const entry of timeline) {
    const caseId = entry.type === "task" ? entry.data.case_id : entry.data.case_id;
    const code = entry.type === "task" ? entry.data.caseCode : entry.data.caseCode;
    const client = entry.type === "task" ? entry.data.clientName : entry.data.clientName;
    if (!caseMap.has(caseId)) {
      caseMap.set(caseId, { code, client, entries: [] });
    }
    caseMap.get(caseId)!.entries.push(entry);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">Seguimiento</h1>
        <p className="text-sm text-gray-500">
          Tareas y comentarios de todos los casos
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-amber-50 p-2.5">
              <ListTodo size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-xl font-bold">{pendientes.length}</p>
              <p className="text-xs text-gray-500">Pendientes</p>
            </div>
          </CardContent>
        </Card>
        {overdueCount > 0 && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-red-50 p-2.5">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <p className="text-xl font-bold text-red-600">{overdueCount}</p>
                <p className="text-xs text-gray-500">Vencidas</p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-green-50 p-2.5">
              <CheckCircle2 size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-xl font-bold">{cumplidas.length}</p>
              <p className="text-xs text-gray-500">Cumplidas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-blue-50 p-2.5">
              <MessageSquare size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xl font-bold">{comments.length}</p>
              <p className="text-xs text-gray-500">Comentarios</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grouped by case */}
      {caseMap.size > 0 ? (
        <div className="space-y-4">
          {Array.from(caseMap.entries()).map(([caseId, group]) => {
            const casePendientes = group.entries.filter(
              (e) => e.type === "task" && e.data.status === "pendiente"
            ).length;

            return (
              <Card key={caseId}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Link
                      href={`/abogada/casos/${caseId}?tab=seguimiento`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <FolderOpen size={16} className="text-integra-gold" />
                      <CardTitle className="text-sm font-bold text-integra-navy">
                        {group.code}
                      </CardTitle>
                      <span className="text-sm text-gray-500">{group.client}</span>
                    </Link>
                    {casePendientes > 0 && (
                      <Badge className="border-transparent bg-amber-100 text-amber-800 text-xs">
                        {casePendientes} pendiente{casePendientes !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {group.entries.slice(0, 5).map((entry) => {
                    if (entry.type === "task") {
                      const t = entry.data;
                      const overdue = isOverdue(t.deadline, t.status);
                      return (
                        <div
                          key={`t-${t.id}`}
                          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                            overdue ? "border-red-200 bg-red-50/50" : ""
                          }`}
                        >
                          {t.status === "cumplida" ? (
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-500" />
                          ) : overdue ? (
                            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
                          ) : (
                            <ListTodo size={16} className="mt-0.5 shrink-0 text-amber-500" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={t.status === "cumplida" ? "text-gray-400 line-through" : "text-gray-800"}>
                              {t.description}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-400">
                              {t.assignedTo && <span>Asignada a: {t.assignedTo}</span>}
                              {t.deadline && (
                                <span className={overdue ? "text-red-600 font-medium" : ""}>
                                  <Calendar size={11} className="inline mr-0.5" />
                                  {overdue ? "Vencida: " : "Límite: "}
                                  {formatDate(t.deadline)}
                                </span>
                              )}
                              <span>{formatDate(t.created_at)}</span>
                            </div>
                          </div>
                          <Badge
                            className={`shrink-0 text-xs border-transparent ${
                              t.status === "cumplida"
                                ? "bg-green-100 text-green-700"
                                : overdue
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {t.status === "cumplida" ? "Cumplida" : overdue ? "Vencida" : "Pendiente"}
                          </Badge>
                        </div>
                      );
                    } else {
                      const c = entry.data;
                      return (
                        <div
                          key={`c-${c.id}`}
                          className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/30 p-3 text-sm"
                        >
                          <MessageSquare size={16} className="mt-0.5 shrink-0 text-blue-500" />
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-800 line-clamp-2">{c.text}</p>
                            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-400">
                              <span className="font-medium text-integra-navy">{c.userName}</span>
                              {c.follow_up_date && (
                                <span>
                                  <Clock size={11} className="inline mr-0.5" />
                                  Seguimiento: {formatDate(c.follow_up_date)}
                                </span>
                              )}
                              <span>{formatDate(c.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  })}
                  {group.entries.length > 5 && (
                    <Link
                      href={`/abogada/casos/${caseId}?tab=seguimiento`}
                      className="block text-center text-xs text-integra-navy hover:underline py-1"
                    >
                      Ver {group.entries.length - 5} entradas más
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <ListTodo size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">No hay seguimiento registrado</p>
          <p className="mt-1 text-sm text-gray-400">
            Las tareas y comentarios de los casos aparecerán aquí.
          </p>
        </div>
      )}
    </div>
  );
}

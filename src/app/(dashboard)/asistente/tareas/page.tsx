import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { ListTodo, Calendar, AlertTriangle, CheckCircle2, MessageSquare, Paperclip, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkTaskButton } from "@/components/asistente/mark-task-button";
import { formatDate } from "@/lib/utils/format-date";

function isOverdue(deadline: string | null, status: "pendiente" | "cumplida") {
  if (!deadline || status === "cumplida") return false;
  const today = new Date().toISOString().split("T")[0];
  return deadline < today;
}

interface ParsedTask {
  id: string;
  description: string;
  deadline: string | null;
  status: "pendiente" | "cumplida";
  completed_at: string | null;
  caseId: string;
  caseCode: string;
  clientName: string;
}

interface CaseGroup {
  caseId: string;
  caseCode: string;
  clientName: string;
  pendientes: ParsedTask[];
  cumplidas: ParsedTask[];
}

export default async function AsistenteTareasPage() {
  const { db, user } = await getAuthenticatedContext();

  const { data: tasksRaw } = await db
    .from("tasks")
    .select(
      `
      id, description, deadline, status, completed_at, created_at, case_id, tenant_id, assigned_to, created_by,
      cases!inner(
        id, case_code,
        clients!inner(id, name)
      )
    `
    )
    .eq("assigned_to", user.id)
    .order("created_at", { ascending: false });

  const tasks: ParsedTask[] = (tasksRaw ?? []).map((t) => {
    const caseInfo = t.cases as unknown as {
      id: string;
      case_code: string;
      clients: { id: string; name: string };
    } | null;

    return {
      id: t.id as string,
      description: t.description as string,
      deadline: t.deadline as string | null,
      status: t.status as "pendiente" | "cumplida",
      completed_at: t.completed_at as string | null,
      caseId: caseInfo?.id ?? "",
      caseCode: caseInfo?.case_code ?? "—",
      clientName: caseInfo?.clients?.name ?? "—",
    };
  });

  // Group by case
  const caseMap = new Map<string, CaseGroup>();
  for (const task of tasks) {
    let group = caseMap.get(task.caseId);
    if (!group) {
      group = {
        caseId: task.caseId,
        caseCode: task.caseCode,
        clientName: task.clientName,
        pendientes: [],
        cumplidas: [],
      };
      caseMap.set(task.caseId, group);
    }
    if (task.status === "pendiente") {
      group.pendientes.push(task);
    } else {
      group.cumplidas.push(task);
    }
  }

  // Sort pendientes by deadline asc (nulls last) within each group
  for (const group of caseMap.values()) {
    group.pendientes.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
  }

  // Sort case groups: cases with pending tasks first, then by case code
  const caseGroups = Array.from(caseMap.values()).sort((a, b) => {
    if (a.pendientes.length > 0 && b.pendientes.length === 0) return -1;
    if (a.pendientes.length === 0 && b.pendientes.length > 0) return 1;
    return a.caseCode.localeCompare(b.caseCode);
  });

  const totalPendientes = tasks.filter((t) => t.status === "pendiente").length;
  const totalCumplidas = tasks.filter((t) => t.status === "cumplida").length;
  const overdueCount = tasks.filter((t) => isOverdue(t.deadline, t.status)).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">Mis Tareas</h1>
        <p className="text-sm text-gray-500">
          {totalPendientes} pendiente{totalPendientes !== 1 ? "s" : ""}
          {overdueCount > 0 && (
            <span className="ml-2 font-medium text-red-600">
              · {overdueCount} vencida{overdueCount !== 1 ? "s" : ""}
            </span>
          )}
          {" · "}
          {totalCumplidas} cumplida{totalCumplidas !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Tasks grouped by case */}
      {caseGroups.length > 0 ? (
        caseGroups.map((group) => (
          <section key={group.caseId} className="space-y-2">
            {/* Case header */}
            <div className="flex items-center gap-2 rounded-lg bg-integra-navy/5 px-4 py-3">
              <FolderOpen size={16} className="shrink-0 text-integra-navy" />
              <Link
                href={`/asistente/casos/${group.caseId}`}
                className="font-mono text-sm font-bold text-integra-navy hover:underline"
              >
                {group.caseCode}
              </Link>
              <span className="text-sm text-gray-600">— {group.clientName}</span>
              {group.pendientes.length > 0 && (
                <Badge className="ml-auto border-transparent bg-amber-100 text-amber-700 text-xs">
                  {group.pendientes.length} pendiente{group.pendientes.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {/* Pending tasks */}
            {group.pendientes.map((task) => {
              const overdue = isOverdue(task.deadline, task.status);
              return (
                <Card
                  key={task.id}
                  className={`border ${overdue ? "border-red-300 bg-red-50/40" : "border-gray-100"}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {overdue ? (
                          <AlertTriangle size={18} className="text-red-500" />
                        ) : (
                          <ListTodo size={18} className="text-amber-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 leading-snug">
                          {task.description}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                          {task.deadline && (
                            <span
                              className={`flex items-center gap-1 ${overdue ? "font-medium text-red-600" : ""}`}
                            >
                              <Calendar size={11} />
                              {overdue ? "Vencida: " : "Límite: "}
                              {formatDate(task.deadline)}
                            </span>
                          )}
                        </div>
                        {/* Action buttons */}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <MarkTaskButton taskId={task.id} />
                          <Link
                            href={`/asistente/casos/${task.caseId}?tab=comentarios`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 min-h-[48px] text-xs font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                          >
                            <MessageSquare size={14} />
                            Comentar
                          </Link>
                          <Link
                            href={`/asistente/casos/${task.caseId}?tab=documentos`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 min-h-[48px] text-xs font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                          >
                            <Paperclip size={14} />
                            Adjuntar
                          </Link>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Completed tasks */}
            {group.cumplidas.map((task) => (
              <Card key={task.id} className="border border-gray-100 opacity-70">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-500 line-through leading-snug">
                        {task.description}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                        {task.completed_at && (
                          <span className="flex items-center gap-1 text-green-600">
                            <Calendar size={11} />
                            Cumplida: {formatDate(task.completed_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge className="shrink-0 border-transparent bg-green-100 text-green-700 text-xs">
                      Cumplida
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        ))
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <ListTodo size={48} className="mb-3 opacity-40" />
          <p className="text-base font-medium text-gray-500">
            No tienes tareas asignadas
          </p>
          <p className="text-sm">Las tareas que te asignen aparecerán aquí.</p>
        </div>
      )}
    </div>
  );
}

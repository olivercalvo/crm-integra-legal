import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ListTodo, Calendar, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkTaskButton } from "@/components/asistente/mark-task-button";
import { formatDate } from "@/lib/utils/format-date";

function isOverdue(deadline: string | null, status: "pendiente" | "cumplida") {
  if (!deadline || status === "cumplida") return false;
  const today = new Date().toISOString().split("T")[0];
  return deadline < today;
}

export default async function AsistenteTareasPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch all tasks assigned to this user with case + client info
  const { data: tasksRaw } = await supabase
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

  const tasks = (tasksRaw ?? []).map((t) => {
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

  // Sort: pendientes first (sorted by deadline asc, nulls last), then cumplidas
  const pendientes = tasks
    .filter((t) => t.status === "pendiente")
    .sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });

  const cumplidas = tasks.filter((t) => t.status === "cumplida");

  const overdueCount = pendientes.filter((t) =>
    isOverdue(t.deadline, t.status)
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">
          Mis Tareas
        </h1>
        <p className="text-sm text-gray-500">
          {pendientes.length} pendiente{pendientes.length !== 1 ? "s" : ""}
          {overdueCount > 0 && (
            <span className="ml-2 font-medium text-red-600">
              · {overdueCount} vencida{overdueCount !== 1 ? "s" : ""}
            </span>
          )}
          {" · "}
          {cumplidas.length} cumplida{cumplidas.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ── Pendientes ── */}
      {pendientes.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Pendientes
          </h2>
          {pendientes.map((task) => {
            const overdue = isOverdue(task.deadline, task.status);
            return (
              <Card
                key={task.id}
                className={`border ${
                  overdue ? "border-red-300 bg-red-50/40" : "border-gray-100"
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="mt-0.5 shrink-0">
                      {overdue ? (
                        <AlertTriangle size={18} className="text-red-500" />
                      ) : (
                        <ListTodo size={18} className="text-amber-500" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 leading-snug">
                        {task.description}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        <Link
                          href={`/asistente/casos/${task.caseId}`}
                          className="font-mono font-semibold text-integra-navy hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {task.caseCode}
                        </Link>
                        <span>{task.clientName}</span>
                        {task.deadline && (
                          <span
                            className={`flex items-center gap-1 ${
                              overdue ? "font-medium text-red-600" : ""
                            }`}
                          >
                            <Calendar size={11} />
                            {overdue ? "Vencida: " : "Límite: "}
                            {formatDate(task.deadline)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action */}
                    <div className="shrink-0">
                      <MarkTaskButton taskId={task.id} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-gray-400">
          <ListTodo size={36} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium text-gray-500">
            No tienes tareas pendientes
          </p>
        </div>
      )}

      {/* ── Cumplidas ── */}
      {cumplidas.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Cumplidas
          </h2>
          {cumplidas.map((task) => (
            <Card
              key={task.id}
              className="border border-gray-100 opacity-70"
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    size={18}
                    className="mt-0.5 shrink-0 text-green-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-500 line-through leading-snug">
                      {task.description}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                      <Link
                        href={`/asistente/casos/${task.caseId}`}
                        className="font-mono font-semibold text-integra-navy/60 hover:underline"
                      >
                        {task.caseCode}
                      </Link>
                      <span>{task.clientName}</span>
                      {task.completed_at && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Calendar size={11} />
                          Cumplida:{" "}
                          {formatDate(task.completed_at)}
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
      )}

      {tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <ListTodo size={48} className="mb-3 opacity-40" />
          <p className="text-base font-medium text-gray-500">
            No tienes tareas asignadas
          </p>
          <p className="text-sm">
            Las tareas que te asignen aparecerán aquí.
          </p>
        </div>
      )}
    </div>
  );
}

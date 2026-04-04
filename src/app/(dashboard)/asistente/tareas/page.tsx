import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { ListTodo } from "lucide-react";
import { CaseTaskGroup } from "@/components/asistente/case-task-group";

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

      {/* Tasks grouped by case — collapsible */}
      {caseGroups.length > 0 ? (
        caseGroups.map((group, index) => (
          <CaseTaskGroup
            key={group.caseId}
            caseId={group.caseId}
            caseCode={group.caseCode}
            clientName={group.clientName}
            pendientes={group.pendientes}
            cumplidas={group.cumplidas}
            defaultOpen={false}
          />
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

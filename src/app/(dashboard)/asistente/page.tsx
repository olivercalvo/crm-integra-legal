import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderOpen, ListTodo, Clock, CheckCircle } from "lucide-react";

export default async function AsistenteDashboard() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch tasks assigned to this user
  const { data: pendingTasks, count: pendingCount } = await supabase
    .from("tasks")
    .select(`
      id, description, deadline, status,
      cases!inner(case_code, description,
        clients!inner(name)
      )
    `, { count: "exact" })
    .eq("assigned_to", user?.id)
    .eq("status", "pendiente")
    .order("deadline", { ascending: true, nullsFirst: false });

  // Fetch completed tasks count
  const { count: completedCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("assigned_to", user?.id)
    .eq("status", "cumplida");

  // Fetch assigned cases
  const { data: assignedCases, count: casesCount } = await supabase
    .from("cat_team")
    .select(`id`, { count: "exact", head: true })
    .eq("user_id", user?.id);

  const stats = [
    {
      label: "Casos Asignados",
      value: casesCount ?? 0,
      icon: <FolderOpen size={24} />,
      color: "text-integra-navy bg-integra-navy/10",
    },
    {
      label: "Tareas Pendientes",
      value: pendingCount ?? 0,
      icon: <ListTodo size={24} />,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "Tareas Cumplidas",
      value: completedCount ?? 0,
      icon: <CheckCircle size={24} />,
      color: "text-green-600 bg-green-50",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl font-bold text-integra-navy">
          Mi Panel
        </h2>
        <p className="text-sm text-gray-500">
          Tus casos y tareas asignadas
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
              <div className={`rounded-lg p-2.5 ${stat.color}`}>
                {stat.icon}
              </div>
              <p className="text-xl font-bold">{stat.value}</p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tareas Pendientes</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingTasks && pendingTasks.length > 0 ? (
            <div className="space-y-3">
              {pendingTasks.map((task: Record<string, unknown>) => {
                const caseInfo = task.cases as Record<string, unknown>;
                const clientInfo = caseInfo?.clients as Record<string, string>;
                const deadline = task.deadline as string | null;
                return (
                  <div
                    key={task.id as string}
                    className="rounded-lg border p-3"
                  >
                    <p className="font-medium">{task.description as string}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      <span>{caseInfo?.case_code as string}</span>
                      <span>•</span>
                      <span>{clientInfo?.name}</span>
                    </div>
                    {deadline ? (
                      <div className="mt-2 flex items-center gap-1 text-xs text-amber-600">
                        <Clock size={14} />
                        <span>Vence: {new Date(deadline).toLocaleDateString("es-PA")}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No tienes tareas pendientes</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

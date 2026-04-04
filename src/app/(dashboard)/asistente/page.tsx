import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderOpen, ListTodo, Clock, CheckCircle, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import Link from "next/link";

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
      cases!inner(id, case_code, description,
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

  // Fetch assigned cases (where assistant_id = user)
  const { count: casesCount } = await supabase
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("assistant_id", user?.id);

  const stats = [
    {
      label: "Casos Asignados",
      value: casesCount ?? 0,
      icon: <FolderOpen size={24} />,
      color: "text-integra-navy bg-integra-navy/10",
      href: "/asistente/casos",
    },
    {
      label: "Tareas Pendientes",
      value: pendingCount ?? 0,
      icon: <ListTodo size={24} />,
      color: "text-amber-600 bg-amber-50",
      href: "/asistente/tareas",
    },
    {
      label: "Tareas Cumplidas",
      value: completedCount ?? 0,
      icon: <CheckCircle size={24} />,
      color: "text-green-600 bg-green-50",
      href: "/asistente/tareas",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-integra-navy">
          Mi Panel
        </h2>
        <p className="text-sm text-gray-500">
          Tus casos y tareas asignadas
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="cursor-pointer transition-shadow hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                <div className={`rounded-lg p-2.5 ${stat.color}`}>
                  {stat.icon}
                </div>
                <p className="text-xl font-bold">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </CardContent>
            </Card>
          </Link>
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
                  <Link
                    key={task.id as string}
                    href={`/asistente/casos/${caseInfo?.id as string}?tab=seguimiento`}
                    className="block rounded-lg border p-3 hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium">{task.description as string}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-mono font-semibold text-integra-navy">{caseInfo?.case_code as string}</span>
                      <span>•</span>
                      <span>{clientInfo?.name}</span>
                    </div>
                    {deadline ? (
                      <div className="mt-2 flex items-center gap-1 text-xs text-amber-600">
                        <Clock size={14} />
                        <span>Vence: {formatDate(deadline)}</span>
                      </div>
                    ) : null}
                  </Link>
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

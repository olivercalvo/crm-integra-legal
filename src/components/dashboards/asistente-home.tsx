import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Card, CardContent } from "@/components/ui/card";
import { FolderOpen, ListTodo, CheckCircle } from "lucide-react";
import Link from "next/link";

export async function AsistenteHome() {
  const { db, tenantId, userId } = await getAuthenticatedContext();

  const [pendingRes, completedRes, allCasesRes] = await Promise.all([
    db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("assigned_to", userId)
      .eq("status", "pendiente"),
    db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("assigned_to", userId)
      .eq("status", "cumplida"),
    // El asistente ve TODOS los casos del bufete (mismo alcance de lectura que
    // la abogada), así que la tarjeta principal cuenta el tenant completo.
    db
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
  ]);

  const stats = [
    {
      label: "Casos del Bufete",
      value: allCasesRes.count ?? 0,
      hint: "Todos los casos",
      icon: <FolderOpen size={24} />,
      color: "text-integra-navy bg-integra-navy/10",
      href: "/legal/casos",
    },
    {
      label: "Tareas Pendientes",
      value: pendingRes.count ?? 0,
      hint: "Asignadas a mí",
      icon: <ListTodo size={24} />,
      color: "text-amber-600 bg-amber-50",
      href: "/legal/pendientes",
    },
    {
      label: "Tareas Cumplidas",
      value: completedRes.count ?? 0,
      hint: "Asignadas a mí",
      icon: <CheckCircle size={24} />,
      color: "text-green-600 bg-green-50",
      href: "/legal/pendientes",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-integra-navy">Mi Panel</h2>
        <p className="text-sm text-gray-500">Casos del bufete y tus tareas</p>
      </div>

      <div className="grid gap-4 grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="block h-full">
            <Card className="h-full min-h-[48px] cursor-pointer transition-shadow hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex h-full flex-col items-center gap-2 p-4 text-center">
                <div className={`rounded-lg p-2.5 ${stat.color}`}>
                  {stat.icon}
                </div>
                <p className="text-xl font-bold">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
                <p className="mt-auto text-[11px] leading-tight text-gray-400">
                  {stat.hint}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { FolderOpen, ListTodo, CheckCircle } from "lucide-react";
import Link from "next/link";

export async function AsistenteHome() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { count: pendingCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("assigned_to", user?.id)
    .eq("status", "pendiente");

  const { count: completedCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("assigned_to", user?.id)
    .eq("status", "cumplida");

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
      href: "/legal/casos",
    },
    {
      label: "Tareas Pendientes",
      value: pendingCount ?? 0,
      icon: <ListTodo size={24} />,
      color: "text-amber-600 bg-amber-50",
      href: "/legal/pendientes",
    },
    {
      label: "Tareas Cumplidas",
      value: completedCount ?? 0,
      icon: <CheckCircle size={24} />,
      color: "text-green-600 bg-green-50",
      href: "/legal/pendientes",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-integra-navy">Mi Panel</h2>
        <p className="text-sm text-gray-500">Tus casos y tareas asignadas</p>
      </div>

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
    </div>
  );
}

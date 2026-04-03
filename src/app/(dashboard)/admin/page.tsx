import Link from "next/link";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FolderOpen, ListTodo, DollarSign, Settings, FileText, ChevronRight } from "lucide-react";

export default async function AdminDashboard() {
  const { db, tenantId } = await getAuthenticatedContext();

  // Fetch counts
  const [clientsRes, casesRes, tasksRes] = await Promise.all([
    db.from("clients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true),
    db.from("cases").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pendiente"),
  ]);

  const stats = [
    {
      label: "Clientes Activos",
      value: clientsRes.count ?? 0,
      icon: <Users size={24} />,
      color: "text-blue-600 bg-blue-50",
      href: "/abogada/clientes",
    },
    {
      label: "Casos",
      value: casesRes.count ?? 0,
      icon: <FolderOpen size={24} />,
      color: "text-integra-navy bg-integra-navy/10",
      href: "/abogada/casos",
    },
    {
      label: "Tareas Pendientes",
      value: tasksRes.count ?? 0,
      icon: <ListTodo size={24} />,
      color: "text-amber-600 bg-amber-50",
      href: "/abogada/tareas",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-integra-navy">
          Panel de Administración
        </h2>
        <p className="text-sm text-gray-500">
          Vista general del sistema
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="cursor-pointer transition-shadow hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`rounded-lg p-3 ${stat.color}`}>
                  {stat.icon}
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick access */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/configuracion">
          <Card className="cursor-pointer transition-shadow hover:shadow-md h-full">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <Settings size={20} className="text-integra-gold" />
              <CardTitle className="text-base">Configuración</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Catálogos, estados, instituciones y equipo</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/usuarios">
          <Card className="cursor-pointer transition-shadow hover:shadow-md h-full">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <Users size={20} className="text-integra-gold" />
              <CardTitle className="text-base">Usuarios</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Gestión de accesos y roles del sistema</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/auditoria">
          <Card className="cursor-pointer transition-shadow hover:shadow-md h-full">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <FileText size={20} className="text-integra-gold" />
              <CardTitle className="text-base">Auditoría</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Registro de todas las operaciones del sistema</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

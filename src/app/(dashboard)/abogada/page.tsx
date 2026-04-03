import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FolderOpen, ListTodo, DollarSign, AlertTriangle, Plus, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function AbogadaDashboard() {
  const { db, tenantId } = await getAuthenticatedContext();

  // Fetch stats
  const [clientsRes, activeCasesRes, pendingTasksRes] = await Promise.all([
    db.from("clients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true),
    db.from("cases").select("id, status_id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pendiente"),
  ]);

  // Fetch recent cases
  const { data: recentCases } = await db
    .from("cases")
    .select(`
      id, case_code, description, updated_at,
      clients!inner(name),
      cat_statuses(name)
    `)
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(5);

  // Fetch cases with negative balance (gastos > pagos)
  const { data: casesWithExpenses } = await db
    .from("cases")
    .select(`
      id, case_code,
      clients!inner(name),
      expenses(amount),
      client_payments(amount)
    `)
    .eq("tenant_id", tenantId);

  const casesInRed = (casesWithExpenses || []).filter((c) => {
    const totalExpenses = (c.expenses || []).reduce((sum: number, e: { amount: number }) => sum + Number(e.amount), 0);
    const totalPayments = (c.client_payments || []).reduce((sum: number, p: { amount: number }) => sum + Number(p.amount), 0);
    return totalExpenses > totalPayments && totalExpenses > 0;
  });

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
      value: activeCasesRes.count ?? 0,
      icon: <FolderOpen size={24} />,
      color: "text-integra-navy bg-integra-navy/10",
      href: "/abogada/expedientes",
    },
    {
      label: "Tareas Pendientes",
      value: pendingTasksRes.count ?? 0,
      icon: <ListTodo size={24} />,
      color: "text-amber-600 bg-amber-50",
      href: "/abogada/tareas",
    },
    {
      label: "Saldo en Contra",
      value: casesInRed.length,
      icon: <AlertTriangle size={24} />,
      color: casesInRed.length > 0 ? "text-red-600 bg-red-50" : "text-green-600 bg-green-50",
      href: "/abogada/gastos",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-integra-navy">
            Dashboard
          </h2>
          <p className="text-sm text-gray-500">
            Resumen de casos y actividad
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px] px-4">
            <Link href="/abogada/clientes/nuevo">
              <Plus size={18} className="mr-1" />
              Cliente
            </Link>
          </Button>
          <Button asChild size="sm" className="bg-integra-navy hover:bg-integra-navy/90 min-h-[48px] px-4">
            <Link href="/abogada/expedientes/nuevo">
              <Plus size={18} className="mr-1" />
              Caso
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="cursor-pointer transition-shadow hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4 lg:p-6">
                <div className={`rounded-lg p-2.5 ${stat.color}`}>
                  {stat.icon}
                </div>
                <div className="flex-1">
                  <p className="text-xl font-bold lg:text-2xl">{stat.value}</p>
                  <p className="text-xs text-gray-500 lg:text-sm">{stat.label}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Recent cases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Casos Recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentCases && recentCases.length > 0 ? (
            <div className="space-y-3">
              {recentCases.map((c: Record<string, unknown>) => (
                <div
                  key={c.id as string}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{c.case_code as string}</p>
                    <p className="text-sm text-gray-500">{c.description as string}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium">
                    {(c.cat_statuses as Record<string, string>)?.name || "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No hay casos aún</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

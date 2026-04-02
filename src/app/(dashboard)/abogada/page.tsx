import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FolderOpen, ListTodo, DollarSign, AlertTriangle, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function AbogadaDashboard() {
  const supabase = createClient();

  // Fetch stats
  const [clientsRes, activeCasesRes, pendingTasksRes] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("cases").select("id, status_id", { count: "exact", head: true }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "pendiente"),
  ]);

  // Fetch recent cases
  const { data: recentCases } = await supabase
    .from("cases")
    .select(`
      id, case_code, description, updated_at,
      clients!inner(name),
      cat_statuses(name)
    `)
    .order("updated_at", { ascending: false })
    .limit(5);

  // Fetch cases with negative balance (gastos > pagos)
  const { data: casesWithExpenses } = await supabase
    .from("cases")
    .select(`
      id, case_code,
      clients!inner(name),
      expenses(amount),
      client_payments(amount)
    `);

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
    },
    {
      label: "Expedientes",
      value: activeCasesRes.count ?? 0,
      icon: <FolderOpen size={24} />,
      color: "text-integra-navy bg-integra-navy/10",
    },
    {
      label: "Tareas Pendientes",
      value: pendingTasksRes.count ?? 0,
      icon: <ListTodo size={24} />,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "Saldo en Contra",
      value: casesInRed.length,
      icon: <AlertTriangle size={24} />,
      color: casesInRed.length > 0 ? "text-red-600 bg-red-50" : "text-green-600 bg-green-50",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold text-integra-navy">
            Dashboard
          </h2>
          <p className="text-sm text-gray-500">
            Resumen de expedientes y actividad
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
              Expediente
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3 p-4 lg:p-6">
              <div className={`rounded-lg p-2.5 ${stat.color}`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-xl font-bold lg:text-2xl">{stat.value}</p>
                <p className="text-xs text-gray-500 lg:text-sm">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent cases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expedientes Recientes</CardTitle>
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
            <p className="text-sm text-gray-400">No hay expedientes aún</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

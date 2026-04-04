import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  FolderOpen,
  ListTodo,
  AlertTriangle,
  Plus,
  Clock,
  CheckCircle,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/format-date";
import { getClassificationColor, DEFAULT_CLASSIFICATION_COLORS } from "@/lib/utils/classification-colors";
import { formatCurrency } from "@/lib/utils/status-styles";

export default async function AbogadaDashboard() {
  const { db, tenantId } = await getAuthenticatedContext();

  // Fetch stats in parallel
  const [clientsRes, pendingTasksRes, casesRes, prospectsRes] = await Promise.all([
    db.from("clients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true),
    db.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pendiente"),
    db.from("cases").select(`
      id, case_code, deadline, description,
      clients!inner(name),
      cat_statuses(name),
      cat_classifications(name, color),
      expenses(amount),
      client_payments(amount)
    `).eq("tenant_id", tenantId),
    db.from("prospects").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", ["contacto_inicial", "propuesta_enviada", "en_negociacion"]),
  ]);

  const cases = casesRes.data ?? [];
  const today = new Date().toISOString().split("T")[0];
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  // Calculate derived stats
  const casesEnTramite = cases.filter((c) => {
    const status = (c.cat_statuses as { name: string } | null)?.name?.toLowerCase() ?? "";
    return !status.includes("cerrado") && !status.includes("cerrada");
  });
  const casesCerrados = cases.filter((c) => {
    const status = (c.cat_statuses as { name: string } | null)?.name?.toLowerCase() ?? "";
    return status.includes("cerrado") || status.includes("cerrada");
  });

  // Cases with deadline this week
  const urgentCases = casesEnTramite.filter((c) => {
    const deadline = c.deadline as string | null;
    return deadline && deadline >= today && deadline <= weekFromNow;
  });
  const overdueCases = casesEnTramite.filter((c) => {
    const deadline = c.deadline as string | null;
    return deadline && deadline < today;
  });

  // Cases with negative balance
  const casesInRed = cases.filter((c) => {
    const totalExpenses = ((c.expenses as { amount: number }[]) || []).reduce((s, e) => s + Number(e.amount), 0);
    const totalPayments = ((c.client_payments as { amount: number }[]) || []).reduce((s, p) => s + Number(p.amount), 0);
    return totalExpenses > totalPayments && totalExpenses > 0;
  });

  // Cases by classification for donut
  const classificationCounts: Record<string, { count: number; color: string }> = {};
  for (const c of cases) {
    const classification = c.cat_classifications as { name: string; color: string | null } | null;
    const name = classification?.name ?? "Sin clasificar";
    const color = classification ? getClassificationColor(classification.name, classification.color) : "#9CA3AF";
    if (!classificationCounts[name]) classificationCounts[name] = { count: 0, color };
    classificationCounts[name].count++;
  }
  const classEntries = Object.entries(classificationCounts).sort((a, b) => b[1].count - a[1].count);
  const totalCases = cases.length || 1;

  // Overdue tasks count
  const { count: overdueTaskCount } = await db
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pendiente")
    .lt("deadline", today);

  const stats = [
    {
      label: "Clientes Activos",
      value: clientsRes.count ?? 0,
      icon: <Users size={28} />,
      color: "text-blue-600 bg-blue-50",
      href: "/abogada/clientes",
    },
    {
      label: "En Trámite",
      value: casesEnTramite.length,
      icon: <FolderOpen size={28} />,
      color: "text-amber-600 bg-amber-50",
      href: "/abogada/casos?status=en-tramite",
    },
    {
      label: "Cerrados",
      value: casesCerrados.length,
      icon: <CheckCircle size={28} />,
      color: "text-gray-600 bg-gray-100",
      href: "/abogada/casos?status=cerrado",
    },
    {
      label: "Tareas Pendientes",
      value: pendingTasksRes.count ?? 0,
      icon: <ListTodo size={28} />,
      color: "text-purple-600 bg-purple-50",
      href: "/abogada/seguimiento",
    },
    {
      label: "Prospectos",
      value: prospectsRes.count ?? 0,
      icon: <UserPlus size={28} />,
      color: "text-cyan-600 bg-cyan-50",
      href: "/abogada/prospectos",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-integra-navy">Dashboard</h2>
          <p className="text-sm text-gray-500">Resumen de actividad</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px] px-4">
            <Link href="/abogada/clientes/nuevo">
              <Plus size={18} className="mr-1" />
              Cliente
            </Link>
          </Button>
          <Button asChild size="sm" className="bg-integra-navy hover:bg-integra-navy/90 min-h-[48px] px-4">
            <Link href="/abogada/casos/nuevo">
              <Plus size={18} className="mr-1" />
              Caso
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="cursor-pointer transition-all hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                <div className={`rounded-xl p-3 ${stat.color}`}>
                  {stat.icon}
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Alerts row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Deadline alerts */}
        {(overdueCases.length > 0 || urgentCases.length > 0) && (
          <Card className="border-red-200 bg-red-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-red-700 flex items-center gap-2">
                <AlertTriangle size={16} />
                Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {overdueCases.slice(0, 3).map((c) => (
                <Link key={c.id} href={`/abogada/casos/${c.id}`} className="block">
                  <div className="flex items-center justify-between rounded-md bg-red-100/50 px-3 py-2 text-sm hover:bg-red-100">
                    <span className="font-mono font-bold text-red-800">{c.case_code}</span>
                    <Badge className="border-0 bg-red-200 text-red-800 text-xs">
                      Vencido: {formatDate(c.deadline)}
                    </Badge>
                  </div>
                </Link>
              ))}
              {urgentCases.slice(0, 3).map((c) => (
                <Link key={c.id} href={`/abogada/casos/${c.id}`} className="block">
                  <div className="flex items-center justify-between rounded-md bg-amber-100/50 px-3 py-2 text-sm hover:bg-amber-100">
                    <span className="font-mono font-bold text-amber-800">{c.case_code}</span>
                    <Badge className="border-0 bg-amber-200 text-amber-800 text-xs">
                      Vence: {formatDate(c.deadline)}
                    </Badge>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Saldo en contra */}
        {casesInRed.length > 0 && (
          <Card className="border-red-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-red-700 flex items-center gap-2">
                <AlertTriangle size={16} />
                Saldos en Contra ({casesInRed.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {casesInRed.slice(0, 4).map((c) => {
                const exp = ((c.expenses as { amount: number }[]) || []).reduce((s, e) => s + Number(e.amount), 0);
                const pay = ((c.client_payments as { amount: number }[]) || []).reduce((s, p) => s + Number(p.amount), 0);
                return (
                  <Link key={c.id} href={`/abogada/casos/${c.id}?tab=gastos`} className="block">
                    <div className="flex items-center justify-between rounded-md bg-red-50 px-3 py-2 text-sm hover:bg-red-100">
                      <span className="font-mono font-bold text-integra-navy">{c.case_code}</span>
                      <span className="font-bold text-red-600 text-xs">{formatCurrency(pay - exp)}</span>
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Overdue tasks */}
        {(overdueTaskCount ?? 0) > 0 && (
          <Card className="border-amber-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-700 flex items-center gap-2">
                <Clock size={16} />
                Tareas Vencidas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Link href="/abogada/seguimiento" className="block">
                <div className="flex items-center gap-3 rounded-md bg-amber-50 px-4 py-3 hover:bg-amber-100">
                  <span className="text-3xl font-bold text-amber-700">{overdueTaskCount}</span>
                  <span className="text-sm text-amber-600">tareas vencidas sin completar</span>
                </div>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Classification donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Casos por Clasificación</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              {/* Simple CSS donut */}
              <div
                className="h-32 w-32 shrink-0 rounded-full"
                style={{
                  background: `conic-gradient(${classEntries
                    .map(([, v], i) => {
                      const start = classEntries.slice(0, i).reduce((s, [, x]) => s + (x.count / totalCases) * 100, 0);
                      const end = start + (v.count / totalCases) * 100;
                      return `${v.color} ${start}% ${end}%`;
                    })
                    .join(", ")})`,
                }}
              >
                <div className="flex h-full items-center justify-center">
                  <div className="h-20 w-20 rounded-full bg-white flex items-center justify-center">
                    <span className="text-2xl font-bold text-integra-navy">{cases.length}</span>
                  </div>
                </div>
              </div>
              {/* Legend */}
              <div className="flex-1 space-y-1.5">
                {classEntries.map(([name, v]) => (
                  <div key={name} className="flex items-center gap-2 text-sm">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                    <span className="text-gray-600 truncate">{name}</span>
                    <span className="ml-auto font-bold text-integra-navy">{v.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cases status bar: En trámite vs Cerrados */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Estado de Casos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-amber-700 font-medium">En trámite</span>
                <span className="font-bold">{casesEnTramite.length}</span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${(casesEnTramite.length / totalCases) * 100}%` }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 font-medium">Cerrados</span>
                <span className="font-bold">{casesCerrados.length}</span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-gray-400 transition-all"
                  style={{ width: `${(casesCerrados.length / totalCases) * 100}%` }}
                />
              </div>
            </div>
            <div className="pt-2 text-center text-xs text-gray-400">
              Total: {cases.length} casos
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

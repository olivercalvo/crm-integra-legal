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
  ClipboardList,
  Inbox,
  Activity,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils/format-date";
import { getClassificationColor, DEFAULT_CLASSIFICATION_COLORS } from "@/lib/utils/classification-colors";
import { formatCurrency } from "@/lib/utils/status-styles";

export default async function AbogadaDashboard() {
  const { db, tenantId, userId, userRole } = await getAuthenticatedContext();
  const isAdmin = userRole === "admin";

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
    const status = (c.cat_statuses as unknown as { name: string } | null)?.name?.toLowerCase() ?? "";
    return !status.includes("cerrado") && !status.includes("cerrada");
  });
  const casesCerrados = cases.filter((c) => {
    const status = (c.cat_statuses as unknown as { name: string } | null)?.name?.toLowerCase() ?? "";
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
    const totalExpenses = ((c.expenses as unknown as { amount: number }[]) || []).reduce((s, e) => s + Number(e.amount), 0);
    const totalPayments = ((c.client_payments as unknown as { amount: number }[]) || []).reduce((s, p) => s + Number(p.amount), 0);
    return totalExpenses > totalPayments && totalExpenses > 0;
  });

  // Cases by classification for donut
  const classificationCounts: Record<string, { count: number; color: string }> = {};
  for (const c of cases) {
    const classification = c.cat_classifications as unknown as { name: string; color: string | null } | null;
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

  // ── Sección 1: "Mis Pendientes" — personal_todos que el usuario creó (user_id = userId)
  // Misma lógica que /abogada/pendientes (ownedRaw): cargar TODOS y filtrar status en JS
  // para garantizar que los conteos coincidan entre dashboard y página de pendientes.
  const myPendingQuery = db
    .from("personal_todos")
    .select(`
      id, description, deadline, status, user_id, assigned_to,
      assignee:users!personal_todos_assigned_to_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .order("deadline", { ascending: true, nullsFirst: false });

  const myPendingRes = isAdmin ? await myPendingQuery : await myPendingQuery.eq("user_id", userId);

  type MyTodoRow = {
    id: string;
    description: string;
    deadline: string | null;
    status: string;
    user_id: string;
    assigned_to: string | null;
    assignee: { full_name: string } | null;
  };
  const myPendingTodos = ((myPendingRes.data ?? []) as unknown as MyTodoRow[])
    .filter((t) => t.status === "pendiente")
    .slice(0, 15);

  // ── Sección 2: "Pendientes Asignados por Otros" — assigned_to = userId AND user_id != userId
  // Misma lógica que /abogada/pendientes (assignedRaw): cargar TODOS y filtrar status en JS.
  const assignedQuery = db
    .from("personal_todos")
    .select(`
      id, description, deadline, status, user_id,
      creator:users!personal_todos_user_id_fkey(full_name)
    `)
    .eq("tenant_id", tenantId)
    .order("deadline", { ascending: true, nullsFirst: false });

  const assignedRes = isAdmin
    ? await assignedQuery
    : await assignedQuery.eq("assigned_to", userId).neq("user_id", userId);

  type AssignedTodoRow = {
    id: string;
    description: string;
    deadline: string | null;
    status: string;
    user_id: string;
    creator: { full_name: string } | null;
  };
  const assignedByOthers = ((assignedRes.data ?? []) as unknown as AssignedTodoRow[])
    .filter((t) => t.status === "pendiente")
    .slice(0, 15);

  // ── Sección 3: "Seguimientos Recientes" — tareas + comentarios mergeados
  const [recentTasksRes, recentCommentsRes] = await Promise.all([
    db
      .from("tasks")
      .select(`
        id, description, created_at, case_id,
        cases!inner(case_code, clients!inner(name)),
        creator:users!tasks_created_by_fkey(full_name)
      `)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(25),
    db
      .from("comments")
      .select(`
        id, text, created_at, case_id,
        cases!inner(case_code, clients!inner(name)),
        users(full_name)
      `)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  type RecentEntry = {
    id: string;
    type: "tarea" | "comentario";
    description: string;
    created_at: string;
    case_id: string;
    caseCode: string;
    clientName: string;
    userName: string;
  };

  const recentTasks: RecentEntry[] = ((recentTasksRes.data ?? []) as unknown as Array<{
    id: string;
    description: string;
    created_at: string;
    case_id: string;
    cases: { case_code: string; clients: { name: string } };
    creator: { full_name: string } | null;
  }>).map((t) => ({
    id: `t-${t.id}`,
    type: "tarea",
    description: t.description,
    created_at: t.created_at,
    case_id: t.case_id,
    caseCode: t.cases.case_code,
    clientName: t.cases.clients.name,
    userName: t.creator?.full_name ?? "Sistema",
  }));

  const recentComments: RecentEntry[] = ((recentCommentsRes.data ?? []) as unknown as Array<{
    id: string;
    text: string;
    created_at: string;
    case_id: string;
    cases: { case_code: string; clients: { name: string } };
    users: { full_name: string } | null;
  }>).map((c) => ({
    id: `c-${c.id}`,
    type: "comentario",
    description: c.text,
    created_at: c.created_at,
    case_id: c.case_id,
    caseCode: c.cases.case_code,
    clientName: c.cases.clients.name,
    userName: c.users?.full_name ?? "Sistema",
  }));

  const recentSeguimientos = [...recentTasks, ...recentComments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);

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
                const exp = ((c.expenses as unknown as { amount: number }[]) || []).reduce((s, e) => s + Number(e.amount), 0);
                const pay = ((c.client_payments as unknown as { amount: number }[]) || []).reduce((s, p) => s + Number(p.amount), 0);
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

      {/* Sección: Mis Pendientes */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2 text-integra-navy">
              <ClipboardList size={18} className="text-integra-gold" />
              {isAdmin ? "Todos los Pendientes" : "Mis Pendientes"}
              <span className="ml-2 text-xs font-normal text-gray-500">{myPendingTodos.length}</span>
            </CardTitle>
            <Link href="/abogada/pendientes" className="text-xs font-medium text-integra-navy hover:underline">
              Ver todos →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {myPendingTodos.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">No tienes pendientes. ¡Buen trabajo!</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {myPendingTodos.map((t) => {
                const overdue = t.deadline && t.deadline < today;
                const urgent = t.deadline && t.deadline >= today && t.deadline <= weekFromNow;
                const assignedToSomeone = t.assigned_to && t.assigned_to !== userId && t.assignee?.full_name;
                return (
                  <Link
                    key={t.id}
                    href="/abogada/pendientes"
                    className="flex items-center gap-3 py-2.5 hover:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{t.description}</p>
                      {assignedToSomeone && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Asignado a: <span className="font-medium">{t.assignee?.full_name}</span>
                        </p>
                      )}
                    </div>
                    {t.deadline && (
                      <Badge
                        className={`border-0 text-xs shrink-0 ${
                          overdue
                            ? "bg-red-100 text-red-800"
                            : urgent
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {overdue ? "Vencido" : "Vence"}: {formatDate(t.deadline)}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sección: Pendientes Asignados por Otros */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2 text-integra-navy">
              <Inbox size={18} className="text-integra-gold" />
              Pendientes Asignados por Otros
              <span className="ml-2 text-xs font-normal text-gray-500">{assignedByOthers.length}</span>
            </CardTitle>
            <Link href="/abogada/pendientes" className="text-xs font-medium text-integra-navy hover:underline">
              Ver todos →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {assignedByOthers.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">No tienes pendientes asignados por otros.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {assignedByOthers.map((t) => {
                const overdue = t.deadline && t.deadline < today;
                const urgent = t.deadline && t.deadline >= today && t.deadline <= weekFromNow;
                return (
                  <Link
                    key={t.id}
                    href="/abogada/pendientes"
                    className="flex items-center gap-3 py-2.5 hover:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{t.description}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Asignado por: <span className="font-medium">{t.creator?.full_name ?? "—"}</span>
                      </p>
                    </div>
                    {t.deadline && (
                      <Badge
                        className={`border-0 text-xs shrink-0 ${
                          overdue
                            ? "bg-red-100 text-red-800"
                            : urgent
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {overdue ? "Vencido" : "Vence"}: {formatDate(t.deadline)}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sección: Seguimientos Recientes */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2 text-integra-navy">
              <Activity size={18} className="text-integra-gold" />
              Seguimientos Recientes
            </CardTitle>
            <Link href="/abogada/seguimiento" className="text-xs font-medium text-integra-navy hover:underline">
              Ver todos →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recentSeguimientos.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">No hay actividad reciente.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentSeguimientos.map((e) => (
                <Link
                  key={e.id}
                  href={`/abogada/casos/${e.case_id}`}
                  className="flex items-start gap-3 py-2.5 hover:bg-gray-50"
                >
                  <div
                    className={`mt-0.5 rounded-md p-1.5 shrink-0 ${
                      e.type === "tarea" ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"
                    }`}
                  >
                    {e.type === "tarea" ? <ListTodo size={14} /> : <MessageSquare size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-integra-navy">{e.caseCode}</span>
                      <span className="text-gray-500 truncate">{e.clientName}</span>
                      <span className="ml-auto shrink-0 text-gray-400">{formatDate(e.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-800 truncate mt-0.5">{e.description}</p>
                    <p className="text-xs text-gray-500 mt-0.5">por {e.userName}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

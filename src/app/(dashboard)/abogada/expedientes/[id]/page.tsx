import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AddCommentForm } from "@/components/cases/add-comment-form";
import { CaseStatusChanger } from "@/components/cases/case-status-changer";
import {
  ArrowLeft,
  Pencil,
  FolderOpen,
  DollarSign,
  ListTodo,
  MessageSquare,
  FileText,
  AlertTriangle,
  CheckCircle,
  User,
  Building2,
  MapPin,
  Calendar,
  Tag,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function getStatusStyle(statusName: string): string {
  const name = statusName.toLowerCase();
  if (name.includes("activo") || name.includes("activa")) {
    return "border-transparent bg-green-100 text-green-800";
  }
  if (name.includes("trámite") || name.includes("tramite") || name.includes("proceso")) {
    return "border-transparent bg-amber-100 text-amber-800";
  }
  if (name.includes("cerrado") || name.includes("cerrada") || name.includes("archivado")) {
    return "border-transparent bg-gray-100 text-gray-600";
  }
  return "border-transparent bg-blue-100 text-blue-800";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-PA", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-PA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface PageProps {
  params: { id: string };
  searchParams: { tab?: string };
}

export default async function ExpedienteDetailPage({
  params,
  searchParams,
}: PageProps) {
  const supabase = createClient();
  const activeTab = searchParams.tab ?? "info";

  // Fetch case with all related data
  const { data: caseData, error } = await supabase
    .from("cases")
    .select(
      `
      *,
      clients(id, name, client_number, ruc, type, phone, email),
      cat_statuses(id, name),
      cat_classifications(id, name, prefix),
      cat_institutions(id, name),
      cat_team(id, name)
    `
    )
    .eq("id", params.id)
    .single();

  if (!caseData || error) {
    notFound();
  }

  const client = caseData.clients as unknown as {
    id: string; name: string; client_number: string;
    ruc: string | null; type: string | null; phone: string | null; email: string | null;
  } | null;
  const status = caseData.cat_statuses as unknown as { id: string; name: string } | null;
  const classification = caseData.cat_classifications as unknown as { id: string; name: string; prefix: string } | null;
  const institution = caseData.cat_institutions as unknown as { id: string; name: string } | null;
  const responsible = caseData.cat_team as unknown as { id: string; name: string } | null;

  // Fetch tab-specific data
  const [expensesRes, paymentsRes, tasksRes, commentsRes, statusesRes] =
    await Promise.all([
      supabase
        .from("expenses")
        .select("id, amount, concept, date, registered_by")
        .eq("case_id", params.id)
        .order("date", { ascending: false }),
      supabase
        .from("client_payments")
        .select("id, amount, payment_date, registered_by")
        .eq("case_id", params.id)
        .order("payment_date", { ascending: false }),
      supabase
        .from("tasks")
        .select(`
          id, description, deadline, status, created_at, completed_at,
          assigned:users!tasks_assigned_to_fkey(full_name)
        `)
        .eq("case_id", params.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("comments")
        .select(`
          id, text, created_at,
          users(full_name)
        `)
        .eq("case_id", params.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("cat_statuses")
        .select("id, name")
        .eq("active", true)
        .order("created_at", { ascending: true }),
    ]);

  const expenses = expensesRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const comments = commentsRes.data ?? [];
  const allStatuses = statusesRes.data ?? [];

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = totalPayments - totalExpenses;
  const isInRed = totalExpenses > totalPayments && totalExpenses > 0;

  const tabs = [
    { key: "info", label: "Información", icon: FolderOpen },
    { key: "gastos", label: "Gastos", icon: DollarSign },
    { key: "tareas", label: "Tareas", icon: ListTodo },
    { key: "comentarios", label: "Comentarios", icon: MessageSquare },
    { key: "documentos", label: "Documentos", icon: FileText },
  ];

  const buildTabUrl = (tab: string) =>
    `/abogada/expedientes/${params.id}?tab=${tab}`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="mt-0.5 min-h-[48px] min-w-[48px]"
          >
            <Link href="/abogada/expedientes">
              <ArrowLeft size={20} />
              <span className="sr-only">Volver</span>
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold text-integra-navy">
                {caseData.case_code}
              </h1>
              {status && (
                <Badge className={getStatusStyle(status.name)}>
                  {status.name}
                </Badge>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {client?.name ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex gap-2 pl-12 sm:pl-0">
          <CaseStatusChanger
            caseId={params.id}
            currentStatusId={caseData.status_id}
            currentStatusName={status?.name ?? ""}
            statuses={allStatuses}
          />
          <Button
            asChild
            className="min-h-[48px] bg-integra-navy px-4 hover:bg-integra-navy/90"
          >
            <Link href={`/abogada/expedientes/${params.id}/editar`}>
              <Pencil size={16} className="mr-1" />
              Editar
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex overflow-x-auto border-b">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={buildTabUrl(tab.key)}
              className={`flex min-w-max items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "border-integra-navy text-integra-navy"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* TAB: Información */}
      {activeTab === "info" && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Case info card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-integra-navy">
                Datos del Expediente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <Tag size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Clasificación</p>
                  <p className="font-medium">{classification?.name ?? "—"}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <Building2 size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Institución</p>
                  <p className="font-medium">{institution?.name ?? "—"}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <User size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Responsable</p>
                  <p className="font-medium">{responsible?.name ?? "—"}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <Calendar size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Fecha de apertura</p>
                  <p className="font-medium">{formatDate(caseData.opened_at)}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <MapPin size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Ubicación física</p>
                  <p className="font-medium">{caseData.physical_location ?? "—"}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <HardDrive size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Expediente digital</p>
                  <p className="font-medium">
                    {caseData.has_digital_file ? "Sí, disponible" : "No disponible"}
                  </p>
                </div>
              </div>
              {caseData.description && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-gray-500">Descripción</p>
                    <p className="mt-1 text-gray-700">{caseData.description}</p>
                  </div>
                </>
              )}
              {caseData.observations && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-gray-500">Observaciones</p>
                    <p className="mt-1 text-gray-700">{caseData.observations}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Client info card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-integra-navy">
                Datos del Cliente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {client ? (
                <>
                  <div>
                    <p className="text-xs text-gray-500">Nombre</p>
                    <Link
                      href={`/abogada/clientes/${client.id}`}
                      className="font-medium text-integra-navy hover:underline"
                    >
                      {client.name}
                    </Link>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-xs text-gray-500">N° de Cliente</p>
                    <p className="font-mono font-medium">{client.client_number}</p>
                  </div>
                  {client.ruc && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-gray-500">RUC / Cédula</p>
                        <p className="font-medium">{client.ruc}</p>
                      </div>
                    </>
                  )}
                  {client.type && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-gray-500">Tipo</p>
                        <p className="font-medium">{client.type}</p>
                      </div>
                    </>
                  )}
                  {client.phone && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-gray-500">Teléfono</p>
                        <p className="font-medium">{client.phone}</p>
                      </div>
                    </>
                  )}
                  {client.email && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-gray-500">Email</p>
                        <a
                          href={`mailto:${client.email}`}
                          className="font-medium text-integra-navy hover:underline"
                        >
                          {client.email}
                        </a>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-gray-400">Cliente no encontrado</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB: Gastos */}
      {activeTab === "gastos" && (
        <div className="space-y-4">
          {/* Balance summary */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Gastos</p>
                <p className="text-xl font-bold text-red-600">
                  {formatCurrency(totalExpenses)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Pagos</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(totalPayments)}
                </p>
              </CardContent>
            </Card>
            <Card
              className={
                isInRed ? "border-red-300 bg-red-50" : "border-green-200 bg-green-50"
              }
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5">
                  {isInRed ? (
                    <AlertTriangle size={16} className="text-red-500" />
                  ) : (
                    <CheckCircle size={16} className="text-green-600" />
                  )}
                  <p className="text-xs text-gray-500">Balance</p>
                </div>
                <p
                  className={`text-xl font-bold ${
                    isInRed ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {formatCurrency(balance)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Expenses list */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Gastos Ejecutados</CardTitle>
              </CardHeader>
              <CardContent>
                {expenses.length > 0 ? (
                  <div className="divide-y">
                    {expenses.map((e) => (
                      <div key={e.id} className="flex items-start justify-between py-3">
                        <div>
                          <p className="font-medium text-sm">{e.concept}</p>
                          <p className="text-xs text-gray-500">
                            {formatDate(e.date)}
                          </p>
                        </div>
                        <span className="font-semibold text-red-600">
                          {formatCurrency(Number(e.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">
                    No hay gastos registrados
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Payments list */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pagos Recibidos</CardTitle>
              </CardHeader>
              <CardContent>
                {payments.length > 0 ? (
                  <div className="divide-y">
                    {payments.map((p) => (
                      <div key={p.id} className="flex items-start justify-between py-3">
                        <div>
                          <p className="font-medium text-sm">Pago del cliente</p>
                          <p className="text-xs text-gray-500">
                            {formatDate(p.payment_date)}
                          </p>
                        </div>
                        <span className="font-semibold text-green-600">
                          {formatCurrency(Number(p.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">
                    No hay pagos registrados
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB: Tareas */}
      {activeTab === "tareas" && (
        <div className="space-y-3">
          {tasks.length > 0 ? (
            tasks.map((t) => {
              const isPending = t.status === "pendiente";
              const assignedUser = t.assigned as unknown as { full_name: string } | null;
              const isOverdue =
                isPending &&
                t.deadline &&
                new Date(t.deadline) < new Date();

              return (
                <Card
                  key={t.id}
                  className={isOverdue ? "border-red-200 bg-red-50/50" : ""}
                >
                  <CardContent className="flex items-start gap-3 p-4">
                    <div
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        isPending
                          ? isOverdue
                            ? "border-red-400 bg-white"
                            : "border-amber-400 bg-white"
                          : "border-green-500 bg-green-500"
                      }`}
                    >
                      {!isPending && (
                        <CheckCircle size={12} className="text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`font-medium text-sm ${
                          !isPending ? "text-gray-400 line-through" : ""
                        }`}
                      >
                        {t.description}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                        {assignedUser && (
                          <span className="flex items-center gap-1">
                            <User size={11} />
                            {assignedUser.full_name}
                          </span>
                        )}
                        {t.deadline && (
                          <span
                            className={`flex items-center gap-1 ${
                              isOverdue ? "text-red-500 font-medium" : ""
                            }`}
                          >
                            <Calendar size={11} />
                            Vence: {formatDate(t.deadline)}
                            {isOverdue && " (vencida)"}
                          </span>
                        )}
                        {t.completed_at && (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle size={11} />
                            Cumplida: {formatDate(t.completed_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      className={
                        isPending
                          ? isOverdue
                            ? "border-transparent bg-red-100 text-red-700"
                            : "border-transparent bg-amber-100 text-amber-700"
                          : "border-transparent bg-green-100 text-green-700"
                      }
                    >
                      {isPending ? (isOverdue ? "Vencida" : "Pendiente") : "Cumplida"}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <div className="py-12 text-center text-gray-400">
              <ListTodo size={40} className="mx-auto mb-2 opacity-40" />
              <p>No hay tareas para este expediente</p>
            </div>
          )}
        </div>
      )}

      {/* TAB: Comentarios */}
      {activeTab === "comentarios" && (
        <div className="space-y-4">
          {/* Comments thread */}
          <div className="space-y-3">
            {comments.length > 0 ? (
              comments.map((c) => {
                const commentUser = c.users as unknown as { full_name: string } | null;
                return (
                  <div key={c.id} className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-integra-navy/10 text-xs font-bold text-integra-navy">
                      {commentUser?.full_name?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 rounded-lg border bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900">
                          {commentUser?.full_name ?? "Usuario"}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(c.created_at).toLocaleString("es-PA", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <p className="mt-1 text-sm text-gray-700 whitespace-pre-line">
                        {c.text}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-8 text-center text-gray-400">
                <MessageSquare size={36} className="mx-auto mb-2 opacity-40" />
                <p>No hay comentarios aún</p>
              </div>
            )}
          </div>

          {/* Add comment form */}
          <AddCommentForm caseId={params.id} />
        </div>
      )}

      {/* TAB: Documentos */}
      {activeTab === "documentos" && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <FileText size={48} className="mb-3 opacity-40" />
          <p className="text-base font-medium text-gray-500">Gestión de documentos</p>
          <p className="text-sm">Próximamente disponible</p>
        </div>
      )}
    </div>
  );
}

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import {
  FolderOpen,
  DollarSign,
  ListTodo,
  MessageSquare,
  FileText,
  Calendar,
  Building2,
  MapPin,
  Tag,
  User,
  HardDrive,
  Hash,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CaseStatusChanger } from "@/components/cases/case-status-changer";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { TaskList } from "@/components/tasks/task-list";
import { CommentList } from "@/components/comments/comment-list";
import { formatDate, daysSince } from "@/lib/utils/format-date";

function getStatusStyle(statusName: string): string {
  const name = statusName.toLowerCase();
  if (name.includes("activo") || name.includes("activa")) {
    return "border-transparent bg-green-100 text-green-800";
  }
  if (
    name.includes("trámite") ||
    name.includes("tramite") ||
    name.includes("proceso")
  ) {
    return "border-transparent bg-amber-100 text-amber-800";
  }
  if (
    name.includes("cerrado") ||
    name.includes("cerrada") ||
    name.includes("archivado")
  ) {
    return "border-transparent bg-gray-100 text-gray-600";
  }
  return "border-transparent bg-blue-100 text-blue-800";
}

function formatCurrency(amount: number): string {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface PageProps {
  params: { id: string };
}

export default async function AsistenteCasoDetailPage({ params }: PageProps) {
  const { db, user } = await getAuthenticatedContext();

  // Fetch case with related data
  const { data: caseData, error } = await db
    .from("cases")
    .select(
      `
      *,
      clients(id, name, client_number, ruc, type, phone, email),
      cat_statuses(id, name),
      cat_classifications(id, name, prefix),
      cat_institutions(id, name)
    `
    )
    .eq("id", params.id)
    .single();

  if (!caseData || error) {
    notFound();
  }

  const client = caseData.clients as unknown as {
    id: string;
    name: string;
    client_number: string;
    ruc: string | null;
    type: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  const status = caseData.cat_statuses as unknown as {
    id: string;
    name: string;
  } | null;
  const classification = caseData.cat_classifications as unknown as {
    id: string;
    name: string;
    prefix: string;
  } | null;
  const institution = caseData.cat_institutions as unknown as {
    id: string;
    name: string;
  } | null;
  // Fetch responsible name from users
  let responsible: { id: string; name: string } | null = null;
  if (caseData.responsible_id) {
    const { data: respUser } = await db.from("users").select("id, full_name").eq("id", caseData.responsible_id).single();
    if (respUser) responsible = { id: respUser.id, name: respUser.full_name };
  }

  // Verify asistente has access: assistant_id matches OR has an assigned task
  const isAssistant = caseData.assistant_id === user.id;

  const { data: assignedTask } = await db
    .from("tasks")
    .select("id")
    .eq("case_id", params.id)
    .eq("assigned_to", user.id)
    .limit(1)
    .maybeSingle();

  if (!isAssistant && !assignedTask) {
    notFound();
  }

  // Fetch all related data in parallel
  const [expensesRes, tasksRes, commentsRes, statusesRes] = await Promise.all([
    db
      .from("expenses")
      .select("id, amount, concept, date, registered_by, case_id, tenant_id, created_at")
      .eq("case_id", params.id)
      .order("date", { ascending: false }),
    db
      .from("tasks")
      .select(
        `
        id, description, deadline, status, created_at, completed_at, case_id, tenant_id, assigned_to, created_by,
        assignee:users!tasks_assigned_to_fkey(id, full_name)
      `
      )
      .eq("case_id", params.id)
      .order("created_at", { ascending: false }),
    db
      .from("comments")
      .select(
        `
        id, text, created_at, follow_up_date, case_id, tenant_id, user_id,
        author:users!comments_user_id_fkey(id, full_name, role)
      `
      )
      .eq("case_id", params.id)
      .order("created_at", { ascending: false }),
    db
      .from("cat_statuses")
      .select("id, name")
      .eq("active", true)
      .order("created_at", { ascending: true }),
  ]);

  const expenses = expensesRes.data ?? [];
  const tasksRaw = tasksRes.data ?? [];
  const commentsRaw = commentsRes.data ?? [];
  const allStatuses = statusesRes.data ?? [];

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  // Shape tasks to match TaskList's expected type
  const tasks = tasksRaw.map((t) => {
    const assignee = t.assignee as unknown as {
      id: string;
      full_name: string;
    } | null;
    return {
      id: t.id,
      tenant_id: t.tenant_id,
      case_id: t.case_id,
      description: t.description,
      deadline: t.deadline,
      assigned_to: t.assigned_to,
      status: t.status as "pendiente" | "cumplida",
      created_by: t.created_by,
      completed_at: t.completed_at,
      created_at: t.created_at,
      assignee: assignee ? { id: assignee.id, full_name: assignee.full_name } : null,
    };
  });

  // Shape comments to match CommentList's expected type
  const comments = commentsRaw.map((c) => {
    const author = c.author as unknown as {
      id: string;
      full_name: string;
      role: string;
    } | null;
    return {
      id: c.id,
      tenant_id: c.tenant_id,
      case_id: c.case_id,
      text: c.text,
      user_id: c.user_id,
      created_at: c.created_at,
      follow_up_date: ((c as Record<string, unknown>).follow_up_date as string | null) ?? null,
      author: author
        ? {
            id: author.id,
            full_name: author.full_name,
            role: author.role as "admin" | "abogada" | "asistente",
          }
        : null,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <BackButton fallbackHref="/asistente/casos" />
          </div>
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
            <p className="text-sm text-gray-500">{client?.name ?? "—"}</p>
          </div>
        </div>
      </div>

      {/* ── SECTION: Estado ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FolderOpen size={18} className="text-integra-navy" />
          <h2 className="text-lg font-semibold text-integra-navy">
            Estado del Caso
          </h2>
        </div>
        <Card className="border border-gray-100">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs text-gray-500">Estado actual</p>
                {status ? (
                  <Badge className={`mt-1 text-sm ${getStatusStyle(status.name)}`}>
                    {status.name}
                  </Badge>
                ) : (
                  <p className="mt-1 text-sm text-gray-400">Sin estado</p>
                )}
              </div>
              <CaseStatusChanger
                caseId={params.id}
                currentStatusId={caseData.status_id}
                currentStatusName={status?.name ?? ""}
                statuses={allStatuses}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ── SECTION: Información del caso ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Tag size={18} className="text-integra-navy" />
          <h2 className="text-lg font-semibold text-integra-navy">
            Información del Caso
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Case Info */}
          <Card className="border border-gray-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-integra-navy">
                Datos del Caso
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {classification && (
                <>
                  <div className="flex items-start gap-2">
                    <Tag size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Clasificación</p>
                      <p className="font-medium">{classification.name}</p>
                    </div>
                  </div>
                  <Separator />
                </>
              )}
              {institution && (
                <>
                  <div className="flex items-start gap-2">
                    <Building2
                      size={14}
                      className="mt-0.5 shrink-0 text-gray-400"
                    />
                    <div>
                      <p className="text-xs text-gray-500">Institución</p>
                      <p className="font-medium">{institution.name}</p>
                    </div>
                  </div>
                  <Separator />
                </>
              )}
              {responsible && (
                <>
                  <div className="flex items-start gap-2">
                    <User size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Responsable</p>
                      <p className="font-medium">{responsible.name}</p>
                    </div>
                  </div>
                  <Separator />
                </>
              )}
              <div className="flex items-start gap-2">
                <Calendar size={14} className="mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Fecha de apertura</p>
                  <p className="font-medium">{formatDate(caseData.opened_at)}</p>
                </div>
              </div>
              {caseData.physical_location && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <MapPin
                      size={14}
                      className="mt-0.5 shrink-0 text-gray-400"
                    />
                    <div>
                      <p className="text-xs text-gray-500">Ubicación física</p>
                      <p className="font-medium">{caseData.physical_location}</p>
                    </div>
                  </div>
                </>
              )}
              <Separator />
              <div className="flex items-start gap-2">
                <HardDrive
                  size={14}
                  className="mt-0.5 shrink-0 text-gray-400"
                />
                <div>
                  <p className="text-xs text-gray-500">Expediente digital</p>
                  <p className="font-medium">
                    {caseData.has_digital_file ? "Disponible" : "No disponible"}
                  </p>
                </div>
              </div>
              {caseData.entity && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <Building2 size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Entidad</p>
                      <p className="font-medium">{caseData.entity}</p>
                    </div>
                  </div>
                </>
              )}
              {caseData.procedure_type && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <Tag size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">Tipo de trámite</p>
                      <p className="font-medium">{caseData.procedure_type}</p>
                    </div>
                  </div>
                </>
              )}
              {caseData.institution_procedure_number && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <Hash size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">N° trámite institución</p>
                      <p className="font-mono font-medium">{caseData.institution_procedure_number}</p>
                    </div>
                  </div>
                </>
              )}
              {caseData.institution_case_number && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <Hash size={14} className="mt-0.5 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-xs text-gray-500">N° caso institución</p>
                      <p className="font-mono font-medium">{caseData.institution_case_number}</p>
                    </div>
                  </div>
                </>
              )}
              {caseData.case_start_date && (() => {
                const d = daysSince(caseData.case_start_date);
                return (
                  <>
                    <Separator />
                    <div className="flex items-start gap-2">
                      <Calendar size={14} className="mt-0.5 shrink-0 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Fecha inicio caso</p>
                        <p className="font-medium">
                          {formatDate(caseData.case_start_date)}
                          {d !== null && <Badge className="ml-2 border-transparent bg-gray-100 text-gray-600 text-xs">{d} días</Badge>}
                        </p>
                      </div>
                    </div>
                  </>
                );
              })()}
              {caseData.procedure_start_date && (() => {
                const d = daysSince(caseData.procedure_start_date);
                return (
                  <>
                    <Separator />
                    <div className="flex items-start gap-2">
                      <Calendar size={14} className="mt-0.5 shrink-0 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Fecha inicio trámite</p>
                        <p className="font-medium">
                          {formatDate(caseData.procedure_start_date)}
                          {d !== null && <Badge className="ml-2 border-transparent bg-gray-100 text-gray-600 text-xs">{d} días</Badge>}
                        </p>
                      </div>
                    </div>
                  </>
                );
              })()}
              {caseData.deadline && (() => {
                const d = daysSince(caseData.deadline);
                const isPastDue = d !== null && d > 0;
                return (
                  <>
                    <Separator />
                    <div className="flex items-start gap-2">
                      <Clock size={14} className={`mt-0.5 shrink-0 ${isPastDue ? "text-red-500" : "text-gray-400"}`} />
                      <div>
                        <p className="text-xs text-gray-500">Fecha tope</p>
                        <p className="font-medium">
                          {formatDate(caseData.deadline)}
                          {isPastDue
                            ? <Badge className="ml-2 border-transparent bg-red-100 text-red-700 text-xs">Vencido hace {d} días</Badge>
                            : d !== null
                              ? <Badge className="ml-2 border-transparent bg-green-100 text-green-700 text-xs">Faltan {Math.abs(d)} días</Badge>
                              : null}
                        </p>
                      </div>
                    </div>
                  </>
                );
              })()}
              {caseData.last_followup_at && (() => {
                const d = daysSince(caseData.last_followup_at);
                return (
                  <>
                    <Separator />
                    <div className="flex items-start gap-2">
                      <MessageSquare size={14} className="mt-0.5 shrink-0 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Último seguimiento</p>
                        <p className="font-medium">
                          {formatDate(caseData.last_followup_at)}
                          {d !== null && <Badge className="ml-2 border-transparent bg-gray-100 text-gray-600 text-xs">hace {d} días</Badge>}
                        </p>
                      </div>
                    </div>
                  </>
                );
              })()}
              {caseData.description && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-gray-500">Descripción</p>
                    <p className="mt-1 text-gray-700">{caseData.description}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Client Info */}
          <Card className="border border-gray-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-integra-navy">
                Datos del Cliente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {client ? (
                <>
                  <div>
                    <p className="text-xs text-gray-500">Nombre</p>
                    <p className="font-medium">{client.name}</p>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-xs text-gray-500">N° de Cliente</p>
                    <p className="font-mono font-medium">
                      {client.client_number}
                    </p>
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
      </section>

      <Separator />

      {/* ── SECTION: Gastos ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign size={18} className="text-integra-navy" />
            <h2 className="text-lg font-semibold text-integra-navy">
              Gastos
            </h2>
          </div>
          <span className="text-sm font-semibold text-red-600">
            {formatCurrency(totalExpenses)} total
          </span>
        </div>

        {/* Expenses list */}
        {expenses.length > 0 ? (
          <Card className="border border-gray-100">
            <CardContent className="pt-4 px-4 pb-2">
              <ul className="divide-y divide-gray-100">
                {expenses.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {e.concept}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDate(e.date)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-red-600">
                      {formatCurrency(Number(e.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <p className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">
            Sin gastos registrados en este caso.
          </p>
        )}

        {/* Add Expense Form */}
        <Card className="border border-dashed border-integra-gold/50 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-integra-navy">
              Registrar Nuevo Gasto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseForm caseId={params.id} />
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ── SECTION: Tareas ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ListTodo size={18} className="text-integra-navy" />
          <h2 className="text-lg font-semibold text-integra-navy">
            Tareas
          </h2>
        </div>
        <TaskList caseId={params.id} tasks={tasks} />
      </section>

      <Separator />

      {/* ── SECTION: Comentarios ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-integra-navy" />
          <h2 className="text-lg font-semibold text-integra-navy">
            Comentarios
          </h2>
        </div>
        <CommentList caseId={params.id} comments={comments} />
      </section>

      <Separator />

      {/* ── SECTION: Documentos (placeholder) ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-integra-navy" />
          <h2 className="text-lg font-semibold text-integra-navy">
            Documentos
          </h2>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 py-12 text-gray-400">
          <FileText size={40} className="mb-2 opacity-40" />
          <p className="text-sm font-medium text-gray-500">
            Gestión de documentos
          </p>
          <p className="text-xs">Próximamente disponible</p>
        </div>
      </section>
    </div>
  );
}

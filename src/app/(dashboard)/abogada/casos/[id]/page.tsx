import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AddCommentForm } from "@/components/cases/add-comment-form";
import { AddExpenseForm } from "@/components/cases/add-expense-form";
import { AddTaskForm, CompleteTaskButton } from "@/components/cases/add-task-form";
import { CaseStatusChanger } from "@/components/cases/case-status-changer";
import { InlineCaseInfoEditor } from "@/components/cases/inline-case-editor";
import { formatDate, formatDateTime, daysSince } from "@/lib/utils/format-date";
import { DocumentUpload } from "@/components/documents/document-upload";
import { PrintCaseCard } from "@/components/cases/print-case-card";
import { BackButton } from "@/components/ui/back-button";
import {
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
  Hash,
  Clock,
  Upload,
  Paperclip,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { getStatusStyle, formatCurrency } from "@/lib/utils/status-styles";

interface PageProps {
  params: { id: string };
  searchParams: { tab?: string; from?: string; client_id?: string };
}

export default async function ExpedienteDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { db, tenantId } = await getAuthenticatedContext();
  const activeTab = searchParams.tab ?? "info";
  const backUrl = searchParams.from === "client" && searchParams.client_id
    ? `/abogada/clientes/${searchParams.client_id}`
    : "/abogada/casos";

  // Fetch case with specific columns for performance
  const { data: caseData, error } = await db
    .from("cases")
    .select(
      `
      id, case_code, case_number, client_id, description, classification_id,
      institution_id, responsible_id, assistant_id, opened_at, status_id,
      physical_location, observations, has_digital_file, entity, procedure_type,
      institution_procedure_number, institution_case_number, case_start_date,
      procedure_start_date, deadline, last_followup_at, created_at, updated_at,
      clients(id, name, client_number, ruc, type, phone, email),
      cat_statuses(id, name),
      cat_classifications(id, name, prefix, color),
      cat_institutions(id, name)
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
  const classification = caseData.cat_classifications as unknown as { id: string; name: string; prefix: string; color: string | null } | null;
  const institution = caseData.cat_institutions as unknown as { id: string; name: string } | null;

  // Fetch responsible (now from users table)
  let responsible: { id: string; name: string } | null = null;
  if (caseData.responsible_id) {
    const { data: respData } = await db
      .from("users")
      .select("id, full_name")
      .eq("id", caseData.responsible_id)
      .single();
    if (respData) responsible = { id: respData.id, name: respData.full_name };
  }

  // Fetch assistant info if exists (assistant_id references users table)
  let assistant: { id: string; name: string } | null = null;
  if (caseData.assistant_id) {
    const { data: assistantData } = await db
      .from("users")
      .select("id, full_name")
      .eq("id", caseData.assistant_id)
      .single();
    if (assistantData) {
      assistant = { id: assistantData.id, name: assistantData.full_name };
    }
  }

  // Fetch tab-specific data and catalogs for editing
  const [expensesRes, paymentsRes, tasksRes, commentsRes, statusesRes, classificationsRes, institutionsRes, teamRes, documentsRes, usersRes] =
    await Promise.all([
      db
        .from("expenses")
        .select("id, amount, concept, date, expense_type, registered_by")
        .eq("case_id", params.id)
        .order("date", { ascending: false }),
      db
        .from("client_payments")
        .select("id, amount, payment_date, payment_type, registered_by")
        .eq("case_id", params.id)
        .order("payment_date", { ascending: false }),
      db
        .from("tasks")
        .select(`
          id, description, deadline, status, created_at, completed_at,
          assigned:users!tasks_assigned_to_fkey(full_name)
        `)
        .eq("case_id", params.id)
        .order("created_at", { ascending: false }),
      db
        .from("comments")
        .select(`
          id, text, created_at, follow_up_date,
          users(full_name)
        `)
        .eq("case_id", params.id)
        .order("created_at", { ascending: false }),
      db
        .from("cat_statuses")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("created_at", { ascending: true }),
      db
        .from("cat_classifications")
        .select("id, name, prefix")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("cat_institutions")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("users")
        .select("id, full_name, role")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .in("role", ["abogada", "asistente"])
        .order("full_name"),
      db
        .from("documents")
        .select("id, file_name, file_path, created_at, uploaded_by")
        .eq("entity_type", "case")
        .eq("entity_id", params.id)
        .order("created_at", { ascending: false }),
      db
        .from("users")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("full_name"),
    ]);

  const expenses = expensesRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const comments = commentsRes.data ?? [];
  const allStatuses = statusesRes.data ?? [];
  const allClassifications = classificationsRes.data ?? [];
  const allInstitutions = institutionsRes.data ?? [];
  const allTeam = (teamRes.data ?? []).map((u: { id: string; full_name: string; role: string }) => ({ id: u.id, name: u.full_name, role: u.role }));
  const documents = documentsRes.data ?? [];
  const allUsers = (usersRes.data ?? []) as { id: string; full_name: string }[];

  const expensesTramite = expenses.filter((e) => (e as Record<string, unknown>).expense_type !== "administrativo");
  const expensesAdmin = expenses.filter((e) => (e as Record<string, unknown>).expense_type === "administrativo");
  const totalTramite = expensesTramite.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalAdmin = expensesAdmin.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalExpenses = totalTramite + totalAdmin;
  // Split payments by type
  const paymentsTramite = payments.filter((p) => (p as Record<string, unknown>).payment_type !== "administrativo");
  const paymentsAdmin = payments.filter((p) => (p as Record<string, unknown>).payment_type === "administrativo");
  const totalPayTramite = paymentsTramite.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalPayAdmin = paymentsAdmin.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalPayments = totalPayTramite + totalPayAdmin;
  const balanceTramite = totalPayTramite - totalTramite;
  const balanceAdmin = totalPayAdmin - totalAdmin;
  const balance = totalPayments - totalExpenses;
  const isInRed = totalExpenses > totalPayments && totalExpenses > 0;

  const tabs = [
    { key: "info", label: "Información", icon: FolderOpen },
    { key: "gastos", label: "Gastos", icon: DollarSign },
    { key: "seguimiento", label: "Seguimiento", icon: MessageSquare },
    { key: "documentos", label: "Documentos", icon: FileText },
  ];

  const buildTabUrl = (tab: string) =>
    `/abogada/casos/${params.id}?tab=${tab}`;

  return (
    <div className="space-y-5">
      {/* Header — no global Edit button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <BackButton fallbackHref="/abogada/casos" />
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
            <p className="text-sm text-gray-500">
              {client?.name ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex gap-2 pl-12 sm:pl-0 flex-wrap">
          <PrintCaseCard
            caseCode={caseData.case_code}
            clientName={client?.name ?? "—"}
            description={caseData.description}
            classification={classification?.name ?? null}
            classificationColor={classification?.color ?? null}
            responsibleName={responsible?.name ?? null}
            openedAt={caseData.opened_at}
            clientNumber={client?.client_number ?? "—"}
          />
          <CaseStatusChanger
            caseId={params.id}
            currentStatusId={caseData.status_id}
            currentStatusName={status?.name ?? ""}
            statuses={allStatuses}
          />
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
        <div className="space-y-4">
          {/* Per-tab inline editor */}
          <InlineCaseInfoEditor
            caseId={params.id}
            caseData={{
              description: caseData.description,
              classification_id: caseData.classification_id,
              institution_id: caseData.institution_id,
              responsible_id: caseData.responsible_id,
              opened_at: caseData.opened_at,
              physical_location: caseData.physical_location,
              observations: caseData.observations,
              has_digital_file: caseData.has_digital_file,
              entity: caseData.entity,
              procedure_type: caseData.procedure_type,
              institution_procedure_number: caseData.institution_procedure_number,
              institution_case_number: caseData.institution_case_number,
              case_start_date: caseData.case_start_date,
              procedure_start_date: caseData.procedure_start_date,
              deadline: caseData.deadline,
              assistant_id: caseData.assistant_id ?? null,
            }}
            classifications={allClassifications}
            institutions={allInstitutions}
            team={allTeam}
            statuses={allStatuses}
            users={allUsers}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Case info card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-integra-navy">
                  Datos del Caso
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
                  <UserCheck size={15} className="mt-0.5 shrink-0 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">Abogado Responsable</p>
                    <p className="font-medium">{responsible?.name ?? "—"}</p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-start gap-2">
                  <Users size={15} className="mt-0.5 shrink-0 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">Asistente Responsable de Seguimiento</p>
                    <p className="font-medium">{assistant?.name ?? "—"}</p>
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
                    <p className="text-xs text-gray-500">Ubicación del Expediente</p>
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
                {caseData.procedure_type && (
                  <>
                    <Separator />
                    <div className="flex items-start gap-2">
                      <Tag size={15} className="mt-0.5 shrink-0 text-gray-400" />
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
                      <Hash size={15} className="mt-0.5 shrink-0 text-gray-400" />
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
                      <Hash size={15} className="mt-0.5 shrink-0 text-gray-400" />
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
                        <Calendar size={15} className="mt-0.5 shrink-0 text-gray-400" />
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
                        <Calendar size={15} className="mt-0.5 shrink-0 text-gray-400" />
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
                        <Clock size={15} className={`mt-0.5 shrink-0 ${isPastDue ? "text-red-500" : "text-gray-400"}`} />
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
                        <MessageSquare size={15} className="mt-0.5 shrink-0 text-gray-400" />
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
        </div>
      )}

      {/* TAB: Gastos */}
      {activeTab === "gastos" && (
        <div className="space-y-4">
          {/* Add expense/payment buttons */}
          <AddExpenseForm caseId={params.id} />

          {/* Balance summary — separate by type */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            {/* Trámite column */}
            <Card>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs text-gray-500 font-semibold uppercase">Trámite</p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Gastos:</span>
                  <span className="font-bold text-red-600">{formatCurrency(totalTramite)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Pagos:</span>
                  <span className="font-bold text-green-600">{formatCurrency(totalPayTramite)}</span>
                </div>
                <div className="border-t pt-1 flex justify-between text-sm">
                  <span className="text-gray-500">Balance:</span>
                  <span className={`font-bold ${balanceTramite < 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(balanceTramite)}
                  </span>
                </div>
              </CardContent>
            </Card>
            {/* Administrativo column */}
            <Card>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs text-gray-500 font-semibold uppercase">Administrativo</p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Gastos:</span>
                  <span className="font-bold text-amber-600">{formatCurrency(totalAdmin)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Pagos:</span>
                  <span className="font-bold text-teal-600">{formatCurrency(totalPayAdmin)}</span>
                </div>
                <div className="border-t pt-1 flex justify-between text-sm">
                  <span className="text-gray-500">Balance:</span>
                  <span className={`font-bold ${balanceAdmin < 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(balanceAdmin)}
                  </span>
                </div>
              </CardContent>
            </Card>
            {/* Total */}
            <Card className={isInRed ? "border-red-300 bg-red-50" : "border-green-200 bg-green-50"}>
              <CardContent className="p-4 space-y-1">
                <div className="flex items-center gap-1.5">
                  {isInRed ? (
                    <AlertTriangle size={16} className="text-red-500" />
                  ) : (
                    <CheckCircle size={16} className="text-green-600" />
                  )}
                  <p className="text-xs text-gray-500 font-semibold uppercase">Balance Total</p>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Gastos:</span>
                  <span className="font-bold text-red-600">{formatCurrency(totalExpenses)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Pagos:</span>
                  <span className="font-bold text-green-600">{formatCurrency(totalPayments)}</span>
                </div>
                <div className="border-t pt-1 flex justify-between text-sm">
                  <span className="text-gray-500">Balance:</span>
                  <span className={`text-lg font-bold ${isInRed ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(balance)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Gastos del Trámite */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-red-700">Gastos del Trámite</CardTitle>
              </CardHeader>
              <CardContent>
                {expensesTramite.length > 0 ? (
                  <div className="divide-y">
                    {expensesTramite.map((e) => (
                      <div key={e.id} className="flex items-start justify-between py-3">
                        <div>
                          <p className="font-medium text-sm">{e.concept}</p>
                          <p className="text-xs text-gray-500">{formatDate(e.date)}</p>
                        </div>
                        <span className="font-semibold text-red-600">{formatCurrency(Number(e.amount))}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">Sin gastos de trámite</p>
                )}
              </CardContent>
            </Card>

            {/* Gastos Administrativos */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-amber-700">Gastos Administrativos</CardTitle>
              </CardHeader>
              <CardContent>
                {expensesAdmin.length > 0 ? (
                  <div className="divide-y">
                    {expensesAdmin.map((e) => (
                      <div key={e.id} className="flex items-start justify-between py-3">
                        <div>
                          <p className="font-medium text-sm">{e.concept}</p>
                          <p className="text-xs text-gray-500">{formatDate(e.date)}</p>
                        </div>
                        <span className="font-semibold text-amber-600">{formatCurrency(Number(e.amount))}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">Sin gastos administrativos</p>
                )}
              </CardContent>
            </Card>

            {/* Pagos del Cliente */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-green-700">Pagos del Cliente</CardTitle>
              </CardHeader>
              <CardContent>
                {payments.length > 0 ? (
                  <div className="divide-y">
                    {payments.map((p) => {
                      const pType = (p as Record<string, unknown>).payment_type;
                      return (
                        <div key={p.id} className="flex items-start justify-between py-3">
                          <div>
                            <p className="font-medium text-sm">
                              {pType === "administrativo" ? "Pago Administrativo" : "Pago Trámite"}
                            </p>
                            <p className="text-xs text-gray-500">{formatDate(p.payment_date)}</p>
                          </div>
                          <span className={`font-semibold ${pType === "administrativo" ? "text-teal-600" : "text-green-600"}`}>
                            {formatCurrency(Number(p.amount))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">Sin pagos registrados</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB: Seguimiento (unified tasks + comments) */}
      {activeTab === "seguimiento" && (() => {
        // Merge tasks and comments into a chronological thread
        type ThreadItem =
          | { type: "task"; id: string; date: string; data: typeof tasks[number] }
          | { type: "comment"; id: string; date: string; data: typeof comments[number] };

        const thread: ThreadItem[] = [
          ...tasks.map((t) => ({
            type: "task" as const,
            id: `t-${t.id}`,
            date: t.created_at,
            data: t,
          })),
          ...comments.map((c) => ({
            type: "comment" as const,
            id: `c-${c.id}`,
            date: c.created_at,
            data: c,
          })),
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return (
          <div className="space-y-4">
            {/* Action buttons — two big intuitive buttons */}
            <div className="grid gap-3 sm:grid-cols-2">
              <AddTaskForm caseId={params.id} users={allUsers} />
              <AddCommentForm caseId={params.id} />
            </div>

            <Separator />

            {/* Chronological thread */}
            {thread.length > 0 ? (
              <div className="space-y-3">
                {thread.map((item) => {
                  if (item.type === "task") {
                    const t = item.data;
                    const taskPending = t.status === "pendiente";
                    const assignedUser = t.assigned as unknown as { full_name: string } | null;
                    const isOverdue = taskPending && t.deadline && new Date(t.deadline) < new Date();

                    return (
                      <Card key={item.id} className={`border-l-4 ${
                        taskPending
                          ? isOverdue ? "border-l-red-500 bg-red-50/30" : "border-l-amber-500"
                          : "border-l-green-500"
                      }`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700">
                                <ListTodo size={10} className="mr-1" />
                                Tarea
                              </Badge>
                              <span>{formatDateTime(t.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {taskPending && <CompleteTaskButton taskId={t.id} />}
                              <Badge className={
                                taskPending
                                  ? isOverdue ? "border-transparent bg-red-100 text-red-700" : "border-transparent bg-amber-100 text-amber-700"
                                  : "border-transparent bg-green-100 text-green-700"
                              }>
                                {taskPending ? (isOverdue ? "Vencida" : "Pendiente") : "Cumplida"}
                              </Badge>
                            </div>
                          </div>
                          <p className={`mt-2 font-medium text-sm ${!taskPending ? "text-gray-400 line-through" : ""}`}>
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
                              <span className={`flex items-center gap-1 ${isOverdue ? "text-red-500 font-medium" : ""}`}>
                                <Calendar size={11} />
                                Vence: {formatDate(t.deadline)}
                              </span>
                            )}
                            {t.completed_at && (
                              <span className="flex items-center gap-1 text-green-600">
                                <CheckCircle size={11} />
                                Cumplida: {formatDate(t.completed_at)}
                              </span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  }

                  // Comment
                  const c = item.data;
                  const commentUser = c.users as unknown as { full_name: string } | null;
                  return (
                    <Card key={item.id} className="border-l-4 border-l-blue-400">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700">
                            <MessageSquare size={10} className="mr-1" />
                            Comentario
                          </Badge>
                          <span>{formatDateTime(c.created_at)}</span>
                          <span className="font-medium text-integra-navy">
                            {commentUser?.full_name ?? "Usuario"}
                          </span>
                        </div>
                        {c.follow_up_date && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                            <Calendar size={12} />
                            Seguimiento: {formatDate(c.follow_up_date)}
                          </p>
                        )}
                        <p className="mt-2 text-sm text-gray-700 whitespace-pre-line">{c.text}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center text-gray-400">
                <MessageSquare size={40} className="mx-auto mb-2 opacity-40" />
                <p>No hay seguimiento registrado</p>
                <p className="text-sm mt-1">Agrega un comentario o asigna una tarea</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB: Documentos */}
      {activeTab === "documentos" && (
        <div className="space-y-4">
          {/* Attach document — QuickBooks style */}
          <DocumentUpload entityType="case" entityId={params.id} />

          {/* Existing documents list */}
          {documents.length > 0 ? (
            <div className="space-y-2">
              {documents.map((doc) => (
                <Card key={doc.id}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <Paperclip size={18} className="shrink-0 text-integra-navy" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{doc.file_name}</p>
                      <p className="text-xs text-gray-500">
                        {formatDateTime(doc.created_at)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-gray-400">
              <FileText size={40} className="mx-auto mb-2 opacity-40" />
              <p>No hay documentos adjuntos</p>
              <p className="text-sm mt-1">Usa el botón de arriba para adjuntar archivos</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { DollarSign, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GastosFormPanel } from "./gastos-client";
import { formatDate } from "@/lib/utils/format-date";

function formatCurrency(amount: number): string {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AsistenteGastosPage() {
  const { db, user } = await getAuthenticatedContext();

  // Fetch all expenses registered by this user (with case + client info)
  const { data: expensesRaw } = await db
    .from("expenses")
    .select(
      `
      id, amount, concept, date, case_id,
      cases!inner(
        id, case_code,
        clients!inner(id, name)
      )
    `
    )
    .eq("registered_by", user.id)
    .order("date", { ascending: false });

  const expenses = (expensesRaw ?? []).map((e) => {
    const caseInfo = e.cases as unknown as {
      id: string;
      case_code: string;
      clients: { id: string; name: string };
    } | null;

    return {
      id: e.id as string,
      amount: Number(e.amount),
      concept: e.concept as string,
      date: e.date as string,
      caseId: caseInfo?.id ?? "",
      caseCode: caseInfo?.case_code ?? "—",
      clientName: caseInfo?.clients?.name ?? "—",
    };
  });

  // Fetch cases assigned to this asistente (via cat_team or tasks) for the expense form
  const [teamRes, taskCasesRes] = await Promise.all([
    db
      .from("cat_team")
      .select("id")
      .eq("user_id", user.id),
    db
      .from("tasks")
      .select("case_id")
      .eq("assigned_to", user.id),
  ]);

  const teamIds = (teamRes.data ?? []).map((t) => t.id as string);
  const taskCaseIdsRaw = (taskCasesRes.data ?? []).map(
    (t) => t.case_id as string
  );
  const taskCaseIds = taskCaseIdsRaw.filter(
    (id, idx) => taskCaseIdsRaw.indexOf(id) === idx
  );

  let assignedCases: { id: string; code: string; clientName: string }[] = [];

  const orParts: string[] = [];
  if (teamIds.length > 0) {
    orParts.push(`responsible_id.in.(${teamIds.join(",")})`);
  }
  if (taskCaseIds.length > 0) {
    orParts.push(`id.in.(${taskCaseIds.join(",")})`);
  }

  if (orParts.length > 0) {
    const { data: casesData } = await db
      .from("cases")
      .select(
        `
        id, case_code,
        clients!inner(id, name)
      `
      )
      .or(orParts.join(","))
      .order("case_code", { ascending: true });

    assignedCases = (casesData ?? []).map((c) => {
      const client = c.clients as unknown as { id: string; name: string } | null;
      return {
        id: c.id as string,
        code: c.case_code as string,
        clientName: client?.name ?? "—",
      };
    });
  }

  // Monthly summary (current month)
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthTotal = expenses
    .filter((e) => {
      const d = new Date(e.date + "T00:00:00");
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    })
    .reduce((sum, e) => sum + e.amount, 0);

  const totalAll = expenses.reduce((sum, e) => sum + e.amount, 0);

  const monthName = now.toLocaleDateString("es-PA", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">
            Mis Gastos
          </h1>
          <p className="text-sm text-gray-500">
            Gastos que has registrado en tus casos asignados
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-100 p-2.5">
                <TrendingDown size={18} className="text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">
                  Este mes ({monthName})
                </p>
                <p className="text-xl font-bold text-amber-700">
                  {formatCurrency(monthTotal)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-integra-navy/10 p-2.5">
                <DollarSign size={18} className="text-integra-navy" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total registrado</p>
                <p className="text-xl font-bold text-integra-navy">
                  {formatCurrency(totalAll)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Register Expense Panel (client component — handles toggle + case selector) */}
      <GastosFormPanel cases={assignedCases} />

      {/* Expenses List */}
      {expenses.length > 0 ? (
        <Card className="border border-gray-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-integra-navy">
              Historial de Gastos ({expenses.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-gray-100">
              {expenses.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {e.concept}
                    </p>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-400">
                      <span>{formatDate(e.date)}</span>
                      <span>·</span>
                      <Link
                        href={`/asistente/casos/${e.caseId}`}
                        className="font-mono font-semibold text-integra-navy hover:underline"
                      >
                        {e.caseCode}
                      </Link>
                      <span>·</span>
                      <span className="truncate">{e.clientName}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-red-600">
                    {formatCurrency(e.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 py-16 text-gray-400">
          <DollarSign size={48} className="mb-3 opacity-40" />
          <p className="text-base font-medium text-gray-500">
            No has registrado gastos aún
          </p>
          <p className="text-sm">
            Usa el botón "Registrar Gasto" para agregar un gasto a un caso.
          </p>
        </div>
      )}
    </div>
  );
}

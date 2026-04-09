import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { GastosTable } from "@/components/expenses/gastos-table";

function formatCurrency(amount: number): string {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function GastosPage() {
  const { db, tenantId } = await getAuthenticatedContext();

  // Fetch all cases with their expenses and payments
  const { data: cases } = await db
    .from("cases")
    .select(`
      id, case_code, description,
      clients(name),
      cat_statuses(name),
      expenses(amount),
      client_payments(amount)
    `)
    .eq("tenant_id", tenantId)
    .order("case_code");

  const rows = (cases ?? []).map((c: Record<string, unknown>) => {
    const client = c.clients as { name: string } | null;
    const status = c.cat_statuses as { name: string } | null;
    const expenses = (c.expenses as { amount: number }[] | null) ?? [];
    const payments = (c.client_payments as { amount: number }[] | null) ?? [];
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalPayments = payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance = totalPayments - totalExpenses;
    return {
      id: c.id as string,
      caseCode: c.case_code as string,
      description: c.description as string | null,
      clientName: client?.name ?? "—",
      statusName: status?.name ?? "—",
      totalPayments,
      totalExpenses,
      balance,
    };
  });

  const grandPayments = rows.reduce((s, r) => s + r.totalPayments, 0);
  const grandExpenses = rows.reduce((s, r) => s + r.totalExpenses, 0);
  const grandBalance = grandPayments - grandExpenses;

  // Unique status names for filter dropdown
  const statuses = Array.from(new Set(rows.map((r) => r.statusName))).filter((s) => s !== "—").sort();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-integra-navy">Balance General de Gastos</h2>
        <p className="text-sm text-gray-500">Resumen financiero por caso</p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
              <TrendingUp className="text-green-600" size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Total Pagado por Clientes</p>
              <p className="text-xl font-bold text-green-700">{formatCurrency(grandPayments)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50">
              <TrendingDown className="text-amber-600" size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Total Gastos Ejecutados</p>
              <p className="text-xl font-bold text-amber-700">{formatCurrency(grandExpenses)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <Wallet className={grandBalance < 0 ? "text-red-600" : "text-blue-600"} size={24} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Balance General</p>
              <p className={`text-xl font-bold ${grandBalance < 0 ? "text-red-600" : "text-green-700"}`}>
                {formatCurrency(grandBalance)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table with sort + filter */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <DollarSign size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">No hay casos registrados</p>
        </div>
      ) : (
        <GastosTable rows={rows} statuses={statuses} />
      )}
    </div>
  );
}

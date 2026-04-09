import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { ClickableRow } from "@/components/expenses/clickable-row";

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

      {/* Cases table */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <DollarSign size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">No hay casos registrados</p>
        </div>
      ) : (
        <>
          {/* Mobile: card layout */}
          <div className="flex flex-col gap-3 sm:hidden">
            {rows.map((row) => (
              <Link key={row.id} href={`/abogada/casos/${row.id}?tab=gastos`}>
                <Card className="overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-integra-navy">{row.caseCode}</span>
                      <Badge variant="outline" className={`text-xs ${row.balance < 0 ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
                        {formatCurrency(row.balance)}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600">{row.clientName}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <span>Pagado: <strong className="text-green-700">{formatCurrency(row.totalPayments)}</strong></span>
                      <span>Gastos: <strong className="text-amber-700">{formatCurrency(row.totalExpenses)}</strong></span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-xl border bg-white sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Caso</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Pagado por Cliente</th>
                    <th className="px-4 py-3 text-right">Gastos Ejecutados</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <ClickableRow key={row.id} href={`/abogada/casos/${row.id}?tab=gastos`}>
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-integra-navy">
                          {row.caseCode}
                        </span>
                        {row.description && (
                          <p className="text-xs text-gray-400 truncate max-w-[200px]">{row.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{row.clientName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">{row.statusName}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">
                        {formatCurrency(row.totalPayments)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-amber-700">
                        {formatCurrency(row.totalExpenses)}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${row.balance < 0 ? "text-red-600" : "text-green-700"}`}>
                        {formatCurrency(row.balance)}
                      </td>
                    </ClickableRow>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-gray-50 font-bold">
                    <td className="px-4 py-3" colSpan={3}>TOTAL</td>
                    <td className="px-4 py-3 text-right text-green-700">{formatCurrency(grandPayments)}</td>
                    <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(grandExpenses)}</td>
                    <td className={`px-4 py-3 text-right ${grandBalance < 0 ? "text-red-600" : "text-green-700"}`}>
                      {formatCurrency(grandBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

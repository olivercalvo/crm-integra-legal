"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ExpenseForm } from "./expense-form";
import { PaymentForm } from "./payment-form";
import { TrendingDown, TrendingUp, Wallet, Plus, X } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import type { Expense, ClientPayment } from "@/types/database";

interface ExpenseListProps {
  caseId: string;
  expenses: Expense[];
  payments: ClientPayment[];
}

function formatCurrency(amount: number) {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ExpenseList({ caseId, expenses, payments }: ExpenseListProps) {
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const totalGastos = expenses.reduce((sum, e) => sum + e.amount, 0);
  const totalPagado = payments.reduce((sum, p) => sum + p.amount, 0);
  const balance = totalPagado - totalGastos;
  const isNegative = balance < 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-100 p-2">
                <TrendingUp size={18} className="text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Pagado</p>
                <p className="text-lg font-bold text-green-700">{formatCurrency(totalPagado)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-gray-100">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <TrendingDown size={18} className="text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Gastos</p>
                <p className="text-lg font-bold text-red-700">{formatCurrency(totalGastos)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`border ${isNegative ? "border-red-200 bg-red-50" : "border-gray-100"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`rounded-full p-2 ${isNegative ? "bg-red-200" : "bg-integra-navy/10"}`}>
                <Wallet size={18} className={isNegative ? "text-red-700" : "text-integra-navy"} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Balance</p>
                <p className={`text-lg font-bold ${isNegative ? "text-red-700" : "text-integra-navy"}`}>
                  {formatCurrency(balance)}
                </p>
                {isNegative && (
                  <Badge variant="destructive" className="mt-1 text-xs">
                    Saldo en contra
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Expenses Section */}
      <Card className="border border-gray-100">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold text-integra-navy">Gastos</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { setShowExpenseForm(!showExpenseForm); setShowPaymentForm(false); }}
            className="h-9 border-integra-navy text-integra-navy hover:bg-integra-navy hover:text-white"
          >
            {showExpenseForm ? (
              <span className="flex items-center gap-1"><X size={14} /> Cancelar</span>
            ) : (
              <span className="flex items-center gap-1"><Plus size={14} /> Nuevo Gasto</span>
            )}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {showExpenseForm && (
            <div className="mb-4 rounded-lg border border-dashed border-integra-gold/50 bg-amber-50/30 p-4">
              <ExpenseForm caseId={caseId} onSuccess={() => setShowExpenseForm(false)} />
            </div>
          )}

          {expenses.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">Sin gastos registrados.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {expenses.map((expense) => (
                <li key={expense.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{expense.concept}</p>
                    <p className="text-xs text-gray-400">{formatDate(expense.date)}</p>
                  </div>
                  <span className="text-sm font-semibold text-red-600">
                    {formatCurrency(expense.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Payments Section */}
      <Card className="border border-gray-100">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold text-integra-navy">Pagos del Cliente</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { setShowPaymentForm(!showPaymentForm); setShowExpenseForm(false); }}
            className="h-9 border-integra-gold text-integra-gold hover:bg-integra-gold hover:text-integra-navy"
          >
            {showPaymentForm ? (
              <span className="flex items-center gap-1"><X size={14} /> Cancelar</span>
            ) : (
              <span className="flex items-center gap-1"><Plus size={14} /> Registrar Pago</span>
            )}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {showPaymentForm && (
            <div className="mb-4 rounded-lg border border-dashed border-integra-gold/50 bg-amber-50/30 p-4">
              <PaymentForm caseId={caseId} onSuccess={() => setShowPaymentForm(false)} />
            </div>
          )}

          {payments.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">Sin pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Pago recibido</p>
                    <p className="text-xs text-gray-400">{formatDate(payment.payment_date)}</p>
                  </div>
                  <span className="text-sm font-semibold text-green-600">
                    {formatCurrency(payment.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

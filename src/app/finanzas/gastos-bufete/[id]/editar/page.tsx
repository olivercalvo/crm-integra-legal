import { redirect, notFound } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import {
  getBusinessExpenseById,
  listExpenseAccountOptions,
} from "@/lib/finanzas/queries/business-expenses";
import { BusinessExpenseForm } from "../../_components/business-expense-form";
import type {
  BusinessExpensePaymentMethod,
  BusinessExpenseTaxRate,
} from "@/lib/finanzas/types/business-expense";

interface PageProps {
  params: { id: string };
}

const MUTATING_ROLES = ["admin", "contador"];

export default async function EditarGastoBufetePage({ params }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole)) {
    redirect(`/finanzas/gastos-bufete/${params.id}`);
  }

  const [expense, accounts] = await Promise.all([
    getBusinessExpenseById(ctx.db, ctx.tenantId, params.id),
    listExpenseAccountOptions(ctx.db, ctx.tenantId),
  ]);
  if (!expense) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref={`/finanzas/gastos-bufete/${expense.id}`}
          label="Volver al detalle"
          showLabel
        />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Editar gasto</h1>
          <p className="text-sm text-gray-500 truncate max-w-[600px]">
            {expense.description}
          </p>
        </div>
      </div>

      <BusinessExpenseForm
        mode="edit"
        accounts={accounts}
        initial={{
          id: expense.id,
          expense_date: expense.expense_date,
          supplier_name: expense.supplier_name,
          supplier_ruc: expense.supplier_ruc,
          chart_account_code: expense.chart_account_code,
          description: expense.description,
          subtotal: Number(expense.subtotal),
          tax_rate: Number(expense.tax_rate) as BusinessExpenseTaxRate,
          tax_amount: Number(expense.tax_amount),
          status: expense.status,
          payment_date: expense.payment_date,
          payment_method: expense.payment_method as BusinessExpensePaymentMethod | null,
          notes: expense.notes,
        }}
      />
    </div>
  );
}

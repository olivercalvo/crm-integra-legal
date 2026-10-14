import { redirect, notFound } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { cuentasParaLineaDeCompra } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import {
  getBusinessExpenseById,
  listExpenseAccountOptions,
} from "@/lib/finanzas/queries/business-expenses";
import { listSupplierOptions } from "@/lib/finanzas/queries/suppliers";
import { listTaxCodesActive } from "@/lib/finanzas/queries/catalogs";
import { BusinessExpenseForm } from "../../_components/business-expense-form";
import { estadoDeCorreccionDeCompra } from "@/lib/finanzas/api/business-expenses";

/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Editar compra · Finanzas",
};
import type {
  BusinessExpensePaymentMethod,
  BusinessExpenseTaxRate,
} from "@/lib/finanzas/types/business-expense";

interface PageProps {
  params: { id: string };
}

const MUTATING_ROLES = ["admin", "abogada", "contador"];

export default async function EditarGastoBufetePage({ params }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole)) {
    redirect(`/finanzas/gastos-bufete/${params.id}`);
  }

  const [expense, lineasRes, suppliers, taxCodes] = await Promise.all([
    getBusinessExpenseById(ctx.db, ctx.tenantId, params.id),
    ctx.db
      .from("expense_lines")
      .select("line_order, description, chart_account_code, amount, tax_code_id, tax_rate, tax_amount")
      .eq("tenant_id", ctx.tenantId)
      .eq("business_expense_id", params.id)
      .order("line_order", { ascending: true }),
    listSupplierOptions(ctx.db, ctx.tenantId),
    listTaxCodesActive(ctx.db, ctx.tenantId),
  ]);
  const lineasDeLaCompra = lineasRes.data as
    | { line_order: number; description: string; chart_account_code: string | null;
        amount: number | string; tax_code_id: string | null;
        tax_rate: number | string; tax_amount: number | string }[]
    | null;

  // Una línea puede estar clasificada contra una cuenta que se desactivó
  // después. Se incluyen igual, marcadas, para no reclasificarla en silencio al
  // guardar — antes esto se hacía con la única cuenta del encabezado.
  const accounts = await listExpenseAccountOptions(
    ctx.db,
    ctx.tenantId,
    (lineasDeLaCompra ?? []).map((l) => l.chart_account_code).find((c) => !!c) ?? null
  );
  if (!expense) notFound();

  // 103: contabilizada → se CORRIGE (reversa + asiento nuevo, con motivo). Si no
  // se puede (pagos, NC, mes cerrado), se dice acá y no se ofrece el formulario.
  const correccion = await estadoDeCorreccionDeCompra(ctx.db, ctx.tenantId, params.id);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref={`/finanzas/gastos-bufete/${expense.id}`}
          label="Volver al detalle"
          showLabel
        />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">
            {correccion.contabilizada ? "Corregir compra" : "Editar compra"}
          </h1>
          <p className="text-sm text-gray-500 truncate max-w-[600px]">
            {expense.description}
          </p>
        </div>
      </div>

      {correccion.contabilizada && correccion.bloqueo ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="note">
          <p className="font-semibold">Esta compra no se puede corregir todavía.</p>
          <p className="mt-1">{correccion.bloqueo}</p>
        </div>
      ) : (
      <BusinessExpenseForm
        mode="edit"
        correccion={
          correccion.contabilizada && correccion.asiento
            ? { entryEsperado: correccion.asiento.id, asientoNumero: correccion.asiento.entryNumber }
            : undefined
        }
        bancos={[]}
        accounts={cuentasParaLineaDeCompra(
          accounts,
          (lineasDeLaCompra ?? []).map((l) => l.chart_account_code)
        )}
        suppliers={suppliers}
        taxCodes={taxCodes}
        initial={{
          id: expense.id,
          expense_date: expense.expense_date,
          accounting_date: expense.accounting_date ?? expense.expense_date,
          due_date: expense.due_date,
          supplier_id: expense.supplier_id,
          supplier_name: expense.supplier_name,
          supplier_ruc: expense.supplier_ruc,
          supplier_invoice_number: expense.supplier_invoice_number,
          // La cuenta vive en las líneas desde la `040`.
          lineas: (lineasDeLaCompra ?? []).map((l) => ({
            description: l.description as string,
            chart_account_code: l.chart_account_code as string | null,
            amount: Number(l.amount),
            tax_code_id: l.tax_code_id ?? "",
            tax_rate: Number(l.tax_rate),
            tax_amount: Number(l.tax_amount),
          })),
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
      )}
    </div>
  );
}

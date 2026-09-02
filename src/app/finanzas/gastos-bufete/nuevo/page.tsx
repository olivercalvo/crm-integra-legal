import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { listExpenseAccountOptions } from "@/lib/finanzas/queries/business-expenses";
import { listSupplierOptions } from "@/lib/finanzas/queries/suppliers";
import { BusinessExpenseForm } from "../_components/business-expense-form";


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Nuevo gasto · Finanzas",
};
const MUTATING_ROLES = ["admin", "abogada", "contador"];

export default async function NuevoGastoBufetePage() {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas/gastos-bufete");
  }

  const [accounts, suppliers] = await Promise.all([
    listExpenseAccountOptions(ctx.db, ctx.tenantId),
    listSupplierOptions(ctx.db, ctx.tenantId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/finanzas/gastos-bufete" label="Volver a gastos" showLabel />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Nuevo gasto del bufete</h1>
          <p className="text-sm text-gray-500">
            Registra una compra del bufete (alquiler, oficina, servicios, suministros).
            El ITBMS pagado es recuperable contra DGI.
          </p>
        </div>
      </div>

      <BusinessExpenseForm mode="create" accounts={accounts} suppliers={suppliers} />
    </div>
  );
}

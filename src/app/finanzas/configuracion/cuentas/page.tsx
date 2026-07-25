import { redirect } from "next/navigation";
import { BookOpenCheck } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listChartAccounts } from "@/lib/finanzas/queries/chart-of-accounts";
import { ChartOfAccountsManager } from "./_components/chart-of-accounts-manager";

// Mismo set de roles que el resto de /finanzas.
const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Plan de Cuentas · Finanzas",
};

export default async function PlanDeCuentasPage() {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const accounts = await listChartAccounts(ctx.db, ctx.tenantId);
  const canMutate = FINANZAS_ROLES.includes(ctx.userRole);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
          <BookOpenCheck size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Plan de Cuentas</h1>
          <p className="text-sm text-gray-500">
            {accounts.length === 0
              ? "Sin cuentas registradas"
              : `${accounts.length} cuenta${accounts.length === 1 ? "" : "s"} contable${accounts.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      <ChartOfAccountsManager initialAccounts={accounts} canMutate={canMutate} />
    </div>
  );
}

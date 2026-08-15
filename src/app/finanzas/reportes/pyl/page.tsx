import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadReportAccounts } from "@/lib/finanzas/reports/accounting-source";
import { buildEstadoResultado } from "@/lib/finanzas/reports/accounting-reports";
import {
  StatementHeader,
  OpeningBalancesNotice,
  UnclassifiedWarning,
  SignConventionNote,
} from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { EstadoResultadoStatement } from "./_components/estado-resultado-statement";

// Mismo set de roles que el resto de /finanzas/reportes.
const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Estado de Resultado · Reportes",
};

export default async function EstadoResultadoPage() {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const accounts = await loadReportAccounts(ctx.db, ctx.tenantId);
  const er = buildEstadoResultado(accounts);
  const isrPct = (er.isr.rate * 100).toLocaleString("es-PA", { maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title="Estado de Resultado"
        subtitle="Saldos de apertura · Ganancias y pérdidas"
        generatedAt={formatGeneratedAt()}
      />

      <OpeningBalancesNotice />
      <UnclassifiedWarning sections={[er.ingresos, er.costos, er.gastos]} />

      {/* La tabla es client component por el toggle de cuentas con saldo; el
          reporte se arma acá en el server y llega ya calculado. */}
      <EstadoResultadoStatement er={er} isrPct={isrPct} />

      <div className="space-y-2">
        <SignConventionNote />
        <p className="text-xs text-gray-500">
          <strong>Impuesto sobre la Renta:</strong> el renglón usa una tasa plana del {isrPct}% sobre
          la utilidad operativa y solo se aplica si hubo ganancia. La tasa y el método (base gravable,
          ajustes, tarifa alternativa) están <strong>pendientes de confirmación del contador</strong>;
          es un parámetro del reporte, no una regla fiscal implementada.
        </p>
      </div>
    </div>
  );
}

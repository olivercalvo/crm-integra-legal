import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadReportAccounts } from "@/lib/finanzas/reports/accounting-source";
import { buildBalanceComprobacion } from "@/lib/finanzas/reports/balance-comprobacion";
import { StatementHeader, OpeningBalancesNotice } from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { PeriodoFiltros, fechaLarga } from "../_components/periodo-filtros";
import { ComprobacionTable } from "./_components/comprobacion-table";

const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Balance de Comprobación · Reportes",
};

export default async function BalanceComprobacionPage({
  searchParams,
}: {
  searchParams: { desde?: string; hasta?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const desde = searchParams.desde?.trim() || "";
  const hasta = searchParams.hasta?.trim() || "";

  // La MISMA lectura que alimenta el Balance General y el Estado de Resultado.
  // Es lo que garantiza que los saldos finales coincidan cuenta por cuenta: no
  // hay dos fuentes que puedan separarse.
  //
  // Con `desde`, la columna "Saldo inicial" deja de ser la apertura de la cuenta
  // y pasa a ser el saldo al arrancar el período (apertura + lo anterior). El
  // builder no cambió: lee el mismo campo, que ahora trae otra cosa.
  const accounts = await loadReportAccounts(ctx.db, ctx.tenantId, {
    rango: { desde, hasta },
  });
  const reporte = buildBalanceComprobacion(accounts);

  const inactivas = reporte.filas.filter((f) => f.inactivaConMovimiento);

  return (
    <div className="space-y-4">

      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title="Balance de Comprobación"
        subtitle={
          desde || hasta
            ? `Sumas y saldos · ${desde ? `Del ${fechaLarga(desde)}` : "Desde el inicio"} ${
                hasta ? `al ${fechaLarga(hasta)}` : "a hoy"
              }`
            : "También llamado Balance de sumas y saldos"
        }
        generatedAt={formatGeneratedAt()}
      />

      <PeriodoFiltros
        basePath="/finanzas/reportes/comprobacion"
        modo="rango"
        desde={desde}
        hasta={hasta}
      />

      {desde && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
          La columna <strong>Saldo inicial</strong> es el saldo al{" "}
          <strong>{fechaLarga(desde)}</strong>: el de apertura de cada cuenta más todo lo
          movido antes de esa fecha. Los débitos y créditos son solo los del período.
        </p>
      )}

      <OpeningBalancesNotice />

      <p className="rounded-md border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
        Los <strong>saldos finales</strong> de esta tabla son exactamente los que muestran el{" "}
        <strong>Balance General</strong> y el <strong>Estado de Resultado</strong>: los tres
        reportes leen la misma fuente. Los saldos van en convención de balanza —débito positivo,
        crédito negativo—, así que un pasivo con saldo se ve en negativo.
      </p>

      {inactivas.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Hay <strong>{inactivas.length} cuenta(s) desactivada(s) con movimientos</strong> (
            {inactivas.map((f) => f.code).join(", ")}). Se incluyen porque sus asientos son un
            hecho contable y sacarlas descuadraría el reporte.
          </span>
        </p>
      )}

      <ComprobacionTable reporte={reporte} />
    </div>
  );
}

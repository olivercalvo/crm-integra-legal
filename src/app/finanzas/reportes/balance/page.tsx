import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadReportAccounts } from "@/lib/finanzas/reports/accounting-source";
import { buildAccountingReports } from "@/lib/finanzas/reports/accounting-reports";
import { getTasaIsr } from "@/lib/finanzas/queries/parametros";
import {
  StatementHeader,
  OpeningBalancesNotice,
  UnclassifiedWarning,
  SignConventionNote,
  formatAmount,
} from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { PeriodoFiltros } from "../_components/periodo-filtros";
import { fechaLarga } from "@/lib/finanzas/reports/fecha-larga";
import { BalanceStatement } from "./_components/balance-statement";

// Mismo set de roles que el resto de /finanzas/reportes.
const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Balance General · Reportes",
};

export default async function BalanceGeneralPage({
  searchParams,
}: {
  searchParams: { hasta?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  // UN solo extremo. El Balance es la foto del patrimonio a una fecha: no
  // existe "el activo entre marzo y junio", así que un `desde` no significaría
  // nada acá y por eso ni se lee.
  const hasta = searchParams.hasta?.trim() || "";

  const accounts = await loadReportAccounts(ctx.db, ctx.tenantId, {
    rango: { hasta },
  });
  // Los dos reportes se arman juntos para que la "Utilidad neta" del patrimonio
  // sea exactamente la del Estado de Resultado, con la MISMA tasa de ISR (E10).
  const isrRate = await getTasaIsr(ctx.db, ctx.tenantId);
  const { balanceGeneral: bg } = buildAccountingReports(accounts, { isrRate });

  // El riesgo de doble conteo lo detecta el BUILDER, que es quien tiene los
  // números: desde que el Balance suma el ledger, un asiento puede acreditar la
  // cuenta de utilidad sin que nadie cargue nada a mano.
  const riesgoDobleConteo = bg.patrimonioConSaldo.length > 0;
  const saldoCuentasPatrimonio = bg.patrimonioConSaldo.reduce((a, r) => a + r.amount, 0);

  // Cuentas DESACTIVADAS que entran igual porque tienen movimientos. Sacarlas
  // descuadraría el estado; dejarlas sin avisar sería un renglón que el contador
  // no reconoce en su plan de cuentas.
  const inactivasConMovimiento = accounts.filter((a) => a.inactivaConMovimiento);

  return (
    <div className="space-y-4">
      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title="Estado de Situación Financiera"
        subtitle={
          hasta
            ? `Balance General · Al ${fechaLarga(hasta)}`
            : "Balance General · Saldos de apertura + movimientos del mayor"
        }
        generatedAt={formatGeneratedAt()}
      />

      <PeriodoFiltros basePath="/finanzas/reportes/balance" modo="fecha" hasta={hasta} />

      <OpeningBalancesNotice conFiltroDeFechas />
      <UnclassifiedWarning sections={[bg.activos, bg.pasivos, bg.patrimonio]} />

      {riesgoDobleConteo && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Hay cuentas de patrimonio con saldo ({formatAmount(saldoCuentasPatrimonio)}) y además se
            suma el renglón calculado <strong>Utilidad neta</strong>. Si alguna de esas
            cuentas ya representa el resultado del período,{" "}
            <strong>se estaría contando dos veces</strong>. Confírmalo con el contador.
          </span>
        </p>
      )}

      {inactivasConMovimiento.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Hay{" "}
            <strong>
              {inactivasConMovimiento.length} cuenta(s) desactivada(s) con movimientos
            </strong>{" "}
            ({inactivasConMovimiento.map((a) => a.code).join(", ")}). Se incluyen igual: sus
            asientos son un hecho contable y sacarlas descuadraría el balance. Si ya no se usan,
            hay que reclasificar esos movimientos antes de darlas de baja.
          </span>
        </p>
      )}

      {/* La tabla es client component por el toggle de cuentas con saldo; el
          reporte se arma acá en el server y llega ya calculado. */}
      <BalanceStatement bg={bg} />

      {/* Cuadre */}
      {bg.cuadra ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <strong>El balance cuadra.</strong> Total de Activo {formatAmount(bg.activos.total)} y Total
          Pasivo + Patrimonio {formatAmount(bg.totalPasivoPatrimonio)} son iguales y opuestos.
        </p>
      ) : (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">El balance NO cuadra.</p>
          <p className="mt-1">
            Diferencia de <strong>{formatAmount(bg.descuadre)}</strong> entre el Total de Activo (
            {formatAmount(bg.activos.total)}) y el Total Pasivo + Patrimonio (
            {formatAmount(bg.totalPasivoPatrimonio)}). Revise los <strong>saldos de apertura</strong>{" "}
            en el Plan de Cuentas y los <strong>asientos del período</strong>: la suma de los
            débitos y los créditos de la balanza tiene que dar cero.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <SignConventionNote />
        <p className="text-xs text-gray-500">
          <strong>Utilidad neta:</strong> el patrimonio incluye la{" "}
          <strong>utilidad neta</strong> del Estado de Resultado (después del impuesto sobre la
          renta calculado con la tasa del bufete), como renglón calculado.{" "}
          <strong>Es acumulada desde el inicio</strong> mientras no haya un cierre anual: el
          cierre lleva el resultado del año a 300002 con un asiento y el renglón calculado deja de
          incluir ese año.
        </p>
      </div>
    </div>
  );
}

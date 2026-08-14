import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadReportAccounts } from "@/lib/finanzas/reports/accounting-source";
import { buildAccountingReports } from "@/lib/finanzas/reports/accounting-reports";
import {
  StatementHeader,
  StatementTable,
  StatementSection,
  SectionHeaderRow,
  SectionAccountRows,
  SectionTotalRow,
  ComputedRow,
  OpeningBalancesNotice,
  UnclassifiedWarning,
  SignConventionNote,
  formatAmount,
} from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";

// Mismo set de roles que el resto de /finanzas/reportes.
const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Balance General · Reportes",
};

export default async function BalanceGeneralPage() {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const accounts = await loadReportAccounts(ctx.db, ctx.tenantId);
  // Los dos reportes se arman juntos para que la "Utilidad del Ejercicio" del
  // patrimonio sea exactamente la utilidad operativa del Estado de Resultado.
  const { balanceGeneral: bg } = buildAccountingReports(accounts);

  /**
   * El plan de Josuar tiene una cuenta de patrimonio "Utilidad del Ejercicio"
   * (300003) Y este reporte agrega un renglón calculado con el mismo nombre.
   * Mientras las cuentas de patrimonio estén en 0 los totales dan bien, pero si
   * alguien les carga un saldo el resultado se contaría DOS VECES.
   *
   * El chequeo mira el SALDO, no el nombre de la cuenta: cualquier saldo de
   * patrimonio distinto de cero merece que el contador confirme que no se está
   * duplicando el resultado del período.
   */
  const saldoCuentasPatrimonio = bg.patrimonio.groups.reduce(
    (acc, g) => acc + g.subtotal,
    0
  );
  const riesgoDobleConteo = Math.abs(saldoCuentasPatrimonio) >= 0.005;

  return (
    <div className="space-y-4">
      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title="Estado de Situación Financiera"
        subtitle="Balance General · Saldos de apertura"
        generatedAt={formatGeneratedAt()}
      />

      <OpeningBalancesNotice />
      <UnclassifiedWarning sections={[bg.activos, bg.pasivos, bg.patrimonio]} />

      {riesgoDobleConteo && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Hay cuentas de patrimonio con saldo ({formatAmount(saldoCuentasPatrimonio)}) y además se
            suma el renglón calculado <strong>Utilidad del Ejercicio</strong>. Si alguna de esas
            cuentas ya representa el resultado del período,{" "}
            <strong>se estaría contando dos veces</strong>. Confirmalo con el contador.
          </span>
        </p>
      )}

      <StatementTable>
        <StatementSection section={bg.activos} />

        <StatementSection section={bg.pasivos} />

        {/* PATRIMONIO se compone a mano porque intercala un renglón CALCULADO
            (la utilidad del ejercicio) entre las cuentas y el total. */}
        <SectionHeaderRow label={bg.patrimonio.label} />
        <SectionAccountRows section={bg.patrimonio} />
        <ComputedRow
          label="Utilidad del Ejercicio"
          value={bg.utilidadDelEjercicio}
          note="del Estado de Resultado (operativa)"
        />
        <SectionTotalRow label={bg.patrimonio.totalLabel} value={bg.patrimonio.total} />

        <ComputedRow
          label="TOTAL PASIVO + PATRIMONIO"
          value={bg.totalPasivoPatrimonio}
          emphasis
        />
      </StatementTable>

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
            {formatAmount(bg.totalPasivoPatrimonio)}). Revisá los saldos de apertura en el Plan de
            Cuentas: la suma de los débitos y los créditos de la balanza tiene que dar cero.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <SignConventionNote />
        <p className="text-xs text-gray-500">
          <strong>Utilidad del Ejercicio:</strong> es un renglón calculado que trae la utilidad
          operativa del Estado de Resultado (antes de impuesto). Está{" "}
          <strong>pendiente de confirmación del contador</strong> si el patrimonio debe llevar la
          utilidad operativa o la neta. Cuando exista el cierre de ejercicio con asientos, el
          resultado se posteará a una cuenta de patrimonio y este renglón calculado desaparece.
        </p>
      </div>
    </div>
  );
}

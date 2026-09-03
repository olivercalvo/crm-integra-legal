import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadReportAccounts } from "@/lib/finanzas/reports/accounting-source";
import { buildEstadoResultadoNiif18 } from "@/lib/finanzas/reports/estado-resultado-niif18";
import {
  StatementHeader,
  OpeningBalancesNotice,
  formatAmount,
} from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { PeriodoFiltros, fechaLarga } from "../_components/periodo-filtros";
import { EstadoResultadoStatement } from "./_components/estado-resultado-statement";

// Mismo set de roles que el resto de /finanzas/reportes.
const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Estado de Resultado · Reportes",
};

export default async function EstadoResultadoPage({
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
  const hayPeriodo = Boolean(desde || hasta);

  // ───────────────────────────────────────────────────────────────────────────
  // POR QUÉ SE EXCLUYE LA APERTURA CUANDO HAY PERÍODO
  // ───────────────────────────────────────────────────────────────────────────
  // El saldo de apertura de una cuenta de resultado es lo acumulado de ejercicios
  // anteriores. Sumarlo a un trimestre convertiría el reporte en un acumulado
  // desde el origen disfrazado de trimestre, que es justo lo que este filtro vino
  // a arreglar.
  //
  // SIN período se sigue incluyendo, para que el reporte por defecto dé
  // exactamente lo de siempre.
  //
  // ⚠️ Esto hace que el reporte SIN filtro y el reporte del año completo NO den
  // lo mismo, y la diferencia no es chica. La nota de abajo lo dice con el número
  // exacto en vez de esconderlo: hoy son 244.476,91 de apertura contra 905,75 de
  // movimiento real del ledger.
  const accounts = await loadReportAccounts(ctx.db, ctx.tenantId, {
    rango: { desde, hasta },
    aperturaDeResultado: hayPeriodo ? "excluir" : "incluir",
  });

  // Cuánto se dejó afuera. Se suma de las cuentas, no se recalcula aparte: es el
  // mismo número que el reporte no usó.
  const aperturaExcluida = accounts.reduce((a, c) => a + (c.aperturaExcluida ?? 0), 0);
  const hayAperturaExcluida = Math.abs(aperturaExcluida) >= 0.005;

  // Integra es sociedad civil: sin ISR a nivel de empresa y con distribución a
  // socias. Los dos son los defaults del builder; se escriben acá igual para que
  // se vea de dónde sale, y para que cambiarlo a una S.A. sea una línea.
  const er = buildEstadoResultadoNiif18(accounts);

  return (
    <div className="space-y-4">
      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title="Estado de Resultado"
        subtitle={
          hayPeriodo
            ? `${desde ? `Del ${fechaLarga(desde)}` : "Desde el inicio"} ${
                hasta ? `al ${fechaLarga(hasta)}` : "a hoy"
              } · Clasificado por actividad (NIIF 18)`
            : "Saldos de apertura · Clasificado por actividad (NIIF 18)"
        }
        generatedAt={formatGeneratedAt()}
      />

      <PeriodoFiltros
        basePath="/finanzas/reportes/pyl"
        modo="rango"
        desde={desde}
        hasta={hasta}
      />

      {hayAperturaExcluida && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Se excluyeron <strong>{formatAmount(Math.abs(aperturaExcluida))}</strong> de saldos
            de apertura de cuentas de resultado, que corresponden a ejercicios anteriores al
            corte. Por eso este reporte no coincide con el que se ve sin filtro: aquel los
            incluye.
          </span>
        </p>
      )}

      {!hayPeriodo && <OpeningBalancesNotice />}

      {er.sinClasificar.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Hay <strong>{er.sinClasificar.length} cuenta(s) de resultado sin subcategoría</strong>.
            Están incluidas en los totales bajo &ldquo;Sin clasificar&rdquo;, pero hay que
            clasificarlas en el Plan de Cuentas para que caigan en su bloque de actividad.
          </span>
        </p>
      )}

      {/* La tabla es client component por el toggle de cuentas con saldo; el
          reporte se arma acá en el server y llega ya calculado. */}
      <EstadoResultadoStatement er={er} />

      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          <strong>Convención de signos:</strong> este reporte se lee como el modelo del
          contador — los ingresos en positivo y los costos y gastos{" "}
          <strong>entre paréntesis</strong>, porque restan. Es la convención inversa a la de la
          balanza de comprobación y a la del Balance General, donde los saldos van tal cual y
          los créditos salen negativos.
        </p>
        <p className="text-xs text-gray-500">
          <strong>NIIF 18:</strong> obligatoria desde el 1 de enero de 2027, reemplaza a la NIC 1
          y clasifica ingresos y gastos por <strong>actividad</strong> (operación, inversión y
          financiamiento). Los bloques sin cuentas no se muestran.
        </p>
        <p className="text-xs text-gray-500">
          <strong>Impuesto sobre la Renta y distribución:</strong> Integra es una{" "}
          <strong>sociedad civil</strong>, así que no paga impuesto sobre la renta a nivel de
          empresa: el resultado se reparte a las socias y cada una paga su renta personal. Por
          eso el impuesto va en 0 y el <strong>resultado del ejercicio cierra en cero</strong>. La
          tasa quedó como parámetro del reporte para cuando se use en sociedades anónimas.
        </p>
        <p className="text-xs text-gray-500">
          El renglón de <strong>Distribución a Socias</strong> es un{" "}
          <strong>cálculo del reporte, no un asiento</strong>: la cuenta 300004 todavía no tiene
          movimientos registrados. Cuando se postee el cierre del ejercicio, el número va a salir
          de los asientos.
        </p>
      </div>
    </div>
  );
}

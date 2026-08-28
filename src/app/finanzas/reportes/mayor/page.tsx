import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, BookOpen } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  loadCuentaDelMayor,
  loadCuentasControl,
  loadCuentasConMovimiento,
  loadMovimientosDeCuenta,
  loadDestinosDeOrigen,
} from "@/lib/finanzas/reports/libro-mayor-source";
import { buildMayorDeCuenta } from "@/lib/finanzas/reports/libro-mayor";
import { listChartAccounts } from "@/lib/finanzas/queries/chart-of-accounts";
import { StatementHeader } from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { LibroMayorTable } from "./_components/libro-mayor-table";
import { MayorFiltros } from "./_components/mayor-filtros";

const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Libro Mayor · Reportes",
};

export default async function LibroMayorPage({
  searchParams,
}: {
  searchParams: { cuenta?: string; desde?: string; hasta?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const [cuentas, conMovimiento] = await Promise.all([
    listChartAccounts(ctx.db, ctx.tenantId),
    loadCuentasConMovimiento(ctx.db, ctx.tenantId),
  ]);

  const activas = cuentas.filter((c) => c.active);
  const code = searchParams.cuenta?.trim() || "";
  const desde = searchParams.desde?.trim() || "";
  const hasta = searchParams.hasta?.trim() || "";

  const cuenta = code ? await loadCuentaDelMayor(ctx.db, ctx.tenantId, code) : null;

  let mayor = null;
  let destinos = new Map<string, string>();
  if (cuenta) {
    const [movimientos, control] = await Promise.all([
      loadMovimientosDeCuenta(ctx.db, ctx.tenantId, code, { desde, hasta }),
      loadCuentasControl(ctx.db, ctx.tenantId),
    ]);
    mayor = buildMayorDeCuenta(cuenta, movimientos, { controlPorCodigo: control });
    destinos = await loadDestinosDeOrigen(ctx.db, ctx.tenantId, movimientos);
  }

  return (
    <div className="space-y-4">
      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title="Libro Mayor"
        subtitle={
          cuenta ? `${cuenta.code} · ${cuenta.name}` : "Elegí una cuenta para ver su mayor"
        }
        generatedAt={formatGeneratedAt()}
      />

      {/*
        Este aviso NO es decorativo: hoy el mayor y los estados financieros leen
        de fuentes distintas, y un contador que compare los números tiene que
        saber por qué no coinciden.
      */}
      <p className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          El Libro Mayor lee del <strong>libro de asientos</strong>. El Balance General y el
          Estado de Resultado todavía se arman <strong>solo con los saldos de apertura</strong>,
          así que no incluyen estos movimientos. La fila{" "}
          <strong>&ldquo;Saldo inicial&rdquo;</strong> de cada cuenta es exactamente el número
          que muestran esos reportes.
        </span>
      </p>

      <MayorFiltros
        cuentas={activas.map((c) => ({
          code: c.code,
          name: c.name,
          conMovimiento: conMovimiento.includes(c.code),
        }))}
        cuentaSeleccionada={code}
        desde={desde}
        hasta={hasta}
      />

      {!cuenta && (
        <div className="rounded-xl border bg-white px-6 py-12 text-center">
          <BookOpen size={28} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Elegí una cuenta del selector para ver su mayor.
          </p>
          {conMovimiento.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              {conMovimiento.length} cuenta(s) tienen movimientos registrados.
            </p>
          )}
        </div>
      )}

      {cuenta && mayor && (
        <LibroMayorTable mayor={mayor} destinos={destinos} />
      )}

      {cuenta && mayor && mayor.cantidadMovimientos === 0 && (
        <p className="text-xs text-gray-500">
          Esta cuenta no tiene movimientos
          {desde || hasta ? " en el rango de fechas elegido" : ""}. Solo se muestra su saldo
          inicial.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          <strong>Convención de signos:</strong> el importe va con signo, en convención de
          balanza — débito positivo, crédito negativo — igual que el Balance General. El saldo
          es corrido: arranca en el saldo inicial y acumula los movimientos.
        </p>
        <p className="text-xs text-gray-500">
          <strong>Pie de la cuenta:</strong> se muestran el{" "}
          <strong>neto del período</strong> (la suma de los movimientos) y el{" "}
          <strong>saldo final</strong> (saldo inicial + neto), por separado. Cuál de los dos
          quiere el contador en el recuadro está pendiente de confirmación.
        </p>
        <p className="text-xs text-gray-500">
          <Link href="/finanzas/reportes" className="text-integra-navy underline">
            Volver a Reportes
          </Link>
        </p>
      </div>
    </div>
  );
}

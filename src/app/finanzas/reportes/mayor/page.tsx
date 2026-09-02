import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen } from "lucide-react";
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
import { BotonExportar } from "../_components/boton-exportar";
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

  // El rango va también acá, no solo a los movimientos: con `desde`, la fila
  // "Saldo inicial" tiene que traer el saldo al día anterior, no el de apertura.
  const cuenta = code
    ? await loadCuentaDelMayor(ctx.db, ctx.tenantId, code, { desde, hasta })
    : null;

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
          cuenta ? `${cuenta.code} · ${cuenta.name}` : "Seleccione una cuenta para ver su mayor"
        }
        generatedAt={formatGeneratedAt()}
      />

      {/*
        CORREGIDO el 02/09/2026. Este aviso decía que el Balance y el Estado de
        Resultado se armaban "solo con los saldos de apertura" y que por eso no
        coincidían con el mayor. Dejó de ser cierto en el bloque de convergencia
        del mismo día: los tres leen `saldo_inicial + Σ ledger`. Un aviso que
        avisa de un problema que ya no existe hace dudar de los números que SÍ
        están bien.
      */}
      <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
        El Libro Mayor, el <strong>Balance General</strong> y el{" "}
        <strong>Estado de Resultado</strong> leen la <strong>misma fuente</strong>: el saldo de
        apertura del Plan de Cuentas más todos los movimientos del libro de asientos. El saldo
        final de una cuenta acá es el mismo que muestra esa cuenta en el Balance.{" "}
        <strong>Todavía no hay corte por período:</strong> se incluye todo lo registrado, sin
        importar la fecha.
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
            Seleccione una cuenta del selector para ver su mayor.
          </p>
          {conMovimiento.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              {conMovimiento.length} cuenta(s) tienen movimientos registrados.
            </p>
          )}
        </div>
      )}

      {cuenta && mayor && (
        <>
          {/* La exportación que pidió Josuarth: "si yo entro a la cuenta de
              gastos de combustible, yo debo poder extraer eso en Excel y ese
              Excel debe venir con DV, nombre, cantidad de gastos". */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              Toque una fila para ver el <strong>asiento completo con todas sus líneas</strong>. El
              archivo trae el <strong>RUC y el DV en columnas separadas</strong>, como los pide el
              formulario de la DGI para los anexos de la declaración de renta.
            </p>
            <BotonExportar
              href={`/api/finanzas/reportes/mayor/export?cuenta=${encodeURIComponent(cuenta.code)}${
                desde ? `&desde=${desde}` : ""
              }${hasta ? `&hasta=${hasta}` : ""}`}
              nombreSugerido={`Mayor_${cuenta.code}.xlsx`}
            />
          </div>

          <LibroMayorTable mayor={mayor} destinos={destinos} />
        </>
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
          <strong>Pie de la cuenta:</strong> en el recuadro se muestran los dos números por
          separado: el <strong>neto de los movimientos del período</strong> y el{" "}
          <strong>saldo final</strong> (saldo inicial + neto).
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

import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadAntiguedad, type TipoAntiguedad } from "@/lib/finanzas/reports/antiguedad-source";
import { buildAntiguedad, TRAMO_LABEL } from "@/lib/finanzas/reports/antiguedad";
import { RUTA_DEL_DOCUMENTO } from "@/lib/finanzas/reports/destino-documento";
import { StatementHeader, OpeningBalancesNotice } from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { AntiguedadTable } from "./_components/antiguedad-table";

const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Antigüedad de Saldos · Reportes",
};

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function AntiguedadPage({
  searchParams,
}: {
  searchParams: { tipo?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const tipo: TipoAntiguedad = searchParams.tipo === "pagar" ? "pagar" : "cobrar";
  const esCobrar = tipo === "cobrar";

  const { documentos, control } = await loadAntiguedad(ctx.db, ctx.tenantId, tipo);
  const reporte = buildAntiguedad(documentos, control);

  // Las rutas salen del MISMO resolvedor que el Libro Mayor y el Diario, así que
  // respetan el permiso del rol que las abre. Acá el id del documento ES el
  // destino: no hace falta resolver contra el ledger.
  const destinos = new Map<string, string>(
    documentos
      .filter((d) => RUTA_DEL_DOCUMENTO[d.sourceType])
      .map((d) => [d.id, RUTA_DEL_DOCUMENTO[d.sourceType](d.id)])
  );

  return (
    <div className="space-y-4">

      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title={esCobrar ? "Antigüedad de Cuentas por Cobrar" : "Antigüedad de Cuentas por Pagar"}
        subtitle="Detallada por documento · clic en un tercero para abrir sus documentos"
        generatedAt={formatGeneratedAt()}
      />

      {/* Selector de auxiliar */}
      <div className="inline-flex overflow-hidden rounded-lg border border-integra-navy/20 bg-white">
        <Link
          href="/finanzas/reportes/aging?tipo=cobrar"
          className={
            "min-h-[44px] px-4 py-2.5 text-sm font-medium transition-colors " +
            (esCobrar ? "bg-integra-navy text-white" : "text-gray-700 hover:bg-gray-50")
          }
        >
          Por cobrar
        </Link>
        <Link
          href="/finanzas/reportes/aging?tipo=pagar"
          className={
            "min-h-[44px] px-4 py-2.5 text-sm font-medium transition-colors " +
            (!esCobrar ? "bg-integra-navy text-white" : "text-gray-700 hover:bg-gray-50")
          }
        >
          Por pagar
        </Link>
      </div>

      <OpeningBalancesNotice />

      {/* ─────────────────────────────────────────────────────────────────
          LAS TRES CIFRAS DE CONTROL. La guía marca como no negociable que el
          auxiliar cuadre con su cuenta control; hoy no cuadra, y en vez de
          esconderlo se declara con su explicación.
          ───────────────────────────────────────────────────────────────── */}
      <div
        className={
          "rounded-md border px-4 py-3 " +
          (reporte.control.cuadra
            ? "border-green-200 bg-green-50"
            : "border-amber-200 bg-amber-50")
        }
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Total del auxiliar</p>
            <p className="font-mono text-base font-bold text-integra-navy">
              {money(reporte.control.totalAuxiliar)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">
              Cuenta control {reporte.control.cuentaCodigo}
            </p>
            <p className="font-mono text-base font-bold text-integra-navy">
              {money(reporte.control.saldoCuentaControl)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Diferencia</p>
            <p
              className={
                "font-mono text-base font-bold " +
                (reporte.control.cuadra ? "text-green-700" : "text-amber-800")
              }
            >
              {money(reporte.control.diferencia)}
            </p>
          </div>
        </div>

        {!reporte.control.cuadra && (
          <p className="mt-2 flex items-start gap-2 border-t border-amber-200 pt-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              El auxiliar <strong>no cuadra</strong> con su cuenta control, y es esperable: de los{" "}
              {money(reporte.control.saldoCuentaControl)} de{" "}
              <strong>
                {reporte.control.cuentaCodigo} {reporte.control.cuentaNombre}
              </strong>
              , <strong>{money(reporte.control.saldoApertura)}</strong> son el{" "}
              <strong>saldo de apertura cargado desde QuickBooks sin detalle de documentos</strong>.
              Solo los movimientos registrados en el sistema tienen facturas detrás, y son los
              únicos que esta tabla puede abrir. Para que el auxiliar cuadre hace falta el detalle
              de los documentos pendientes a la fecha de apertura, que lo tiene el contador.
            </span>
          </p>
        )}
      </div>

      {!esCobrar && (
        <p className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Dos cosas propias de cuentas por pagar:{" "}
            <strong>la antigüedad se cuenta desde la fecha del gasto</strong>, no desde su
            vencimiento, porque los gastos del bufete todavía no tienen campo de vencimiento. Y{" "}
            <strong>el proveedor se agrupa por su nombre escrito</strong>: todavía no es una
            entidad del sistema, así que dos gastos escritos distinto salen como dos proveedores.
            Las dos cosas se resuelven con el módulo de compras.
          </span>
        </p>
      )}

      {reporte.tramosVacios.length > 0 && reporte.filas.length > 0 && (
        <p className="text-xs text-gray-500">
          Sin documentos en{" "}
          <strong>{reporte.tramosVacios.map((t) => TRAMO_LABEL[t]).join(", ")}</strong>. Las
          columnas se muestran igual para que la estructura del reporte no cambie según los datos.
        </p>
      )}

      <AntiguedadTable reporte={reporte} destinos={destinos} />
    </div>
  );
}

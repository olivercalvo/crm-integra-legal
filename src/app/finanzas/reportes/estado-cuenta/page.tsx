import { redirect } from "next/navigation";
import Link from "next/link";
import { Info } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  loadClientesConMovimiento,
  loadProveedoresConMovimiento,
  loadMovimientosDeCliente,
  loadMovimientosDeProveedor,
} from "@/lib/finanzas/reports/estado-cuenta-source";
import { buildEstadoCuenta } from "@/lib/finanzas/reports/estado-cuenta";
import { RUTA_DEL_DOCUMENTO } from "@/lib/finanzas/reports/destino-documento";
import { StatementHeader, OpeningBalancesNotice } from "../_components/financial-statement";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "../_components/report-meta";
import { EstadoCuentaTable } from "./_components/estado-cuenta-table";
import { TerceroSelector } from "./_components/tercero-selector";

const FINANZAS_ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Estado de Cuenta · Reportes",
};

export default async function EstadoCuentaPage({
  searchParams,
}: {
  searchParams: { tipo?: string; id?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const tipo: "cliente" | "proveedor" =
    searchParams.tipo === "proveedor" ? "proveedor" : "cliente";
  const id = searchParams.id?.trim() ?? "";
  const esCliente = tipo === "cliente";

  const opciones = esCliente
    ? (await loadClientesConMovimiento(ctx.db, ctx.tenantId)).map((c) => ({
        value: c.id,
        label: c.name,
      }))
    : (await loadProveedoresConMovimiento(ctx.db, ctx.tenantId)).map((n) => ({
        value: n,
        label: n,
      }));

  let estado = null;
  let destinos = new Map<string, string>();

  if (id) {
    const movimientos = esCliente
      ? await loadMovimientosDeCliente(ctx.db, ctx.tenantId, id)
      : await loadMovimientosDeProveedor(ctx.db, ctx.tenantId, id);

    const nombre = opciones.find((o) => o.value === id)?.label ?? id;
    // El saldo inicial es 0 porque la apertura no está repartida por tercero.
    // Ver el encabezado de `estado-cuenta.ts`.
    estado = buildEstadoCuenta(nombre, esCliente ? id : null, movimientos, 0);

    destinos = new Map(
      movimientos
        .filter((m) => m.documentoId && m.sourceType && RUTA_DEL_DOCUMENTO[m.sourceType])
        .map((m) => [m.documentoId as string, RUTA_DEL_DOCUMENTO[m.sourceType as string](m.documentoId as string)])
    );
  }

  return (
    <div className="space-y-4">

      <StatementHeader
        firmName={REPORT_FIRM_NAME}
        title={esCliente ? "Estado de Cuenta por Cliente" : "Estado de Cuenta por Proveedor"}
        subtitle="Movimientos y saldo corrido, como el Libro Mayor pero por tercero"
        generatedAt={formatGeneratedAt()}
      />

      <div className="inline-flex overflow-hidden rounded-lg border border-integra-navy/20 bg-white">
        <Link
          href="/finanzas/reportes/estado-cuenta?tipo=cliente"
          className={
            "min-h-[44px] px-4 py-2.5 text-sm font-medium transition-colors " +
            (esCliente ? "bg-integra-navy text-white" : "text-gray-700 hover:bg-gray-50")
          }
        >
          Por cliente
        </Link>
        <Link
          href="/finanzas/reportes/estado-cuenta?tipo=proveedor"
          className={
            "min-h-[44px] px-4 py-2.5 text-sm font-medium transition-colors " +
            (!esCliente ? "bg-integra-navy text-white" : "text-gray-700 hover:bg-gray-50")
          }
        >
          Por proveedor
        </Link>
      </div>

      <OpeningBalancesNotice />

      <p className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong>El saldo inicial arranca en cero</strong>, y no significa que el tercero no
          debiera nada: el saldo que vino de QuickBooks está en la cuenta control{" "}
          <strong>sin repartir por cliente ni proveedor</strong>. Acá se ve solo lo que el sistema
          registró.
          {!esCliente && (
            <>
              {" "}
              El proveedor se identifica por su <strong>nombre escrito</strong>: todavía no es una
              entidad del sistema.
            </>
          )}
        </span>
      </p>

      <TerceroSelector tipo={tipo} opciones={opciones} seleccionado={id} />

      {estado ? (
        <EstadoCuentaTable estado={estado} destinos={destinos} />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-base font-medium text-integra-navy">
            Elegí un {esCliente ? "cliente" : "proveedor"} para ver su estado de cuenta
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {opciones.length} {esCliente ? "cliente(s)" : "proveedor(es)"} con movimientos
            registrados.
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import {
  tieneAlgo,
  type BalanceComprobacion,
  type FilaComprobacion,
} from "@/lib/finanzas/reports/balance-comprobacion";
import {
  DEFAULT_ACCOUNT_VISIBILITY,
  type AccountVisibility,
} from "@/lib/finanzas/reports/report-visibility";
import { AccountVisibilityToggle } from "../../_components/account-visibility-toggle";

/**
 * Tabla del Balance de Comprobación.
 *
 * Los saldos van en convención de BALANZA —igual que el Balance General, no como
 * el Estado de Resultado— porque este reporte es la balanza: mostrarlos con otra
 * convención rompería justamente la comparación que se viene a hacer.
 */

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Las columnas de suma no muestran ceros: un 0.00 repetido es ruido. */
function Suma({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-gray-300">—</span>;
  return <span className="font-mono text-sm tabular-nums text-gray-700">{money(value)}</span>;
}

function Saldo({ value, bold }: { value: number; bold?: boolean }) {
  const cero = Math.abs(value) < 0.005;
  return (
    <span
      className={
        "font-mono text-sm tabular-nums " +
        (cero ? "text-gray-300" : "text-gray-800") +
        (bold ? " font-bold" : "")
      }
    >
      {cero ? "—" : money(value)}
    </span>
  );
}

function Fila({ fila }: { fila: FilaComprobacion }) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">{fila.code}</td>
      <td className="px-3 py-2 text-sm text-gray-700">
        {fila.name}
        {fila.inactivaConMovimiento && (
          <span
            className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200"
            title="Cuenta desactivada que se incluye porque tiene movimientos"
          >
            desactivada
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right"><Saldo value={fila.saldoInicial} /></td>
      <td className="px-3 py-2 text-right"><Suma value={fila.debitos} /></td>
      <td className="px-3 py-2 text-right"><Suma value={fila.creditos} /></td>
      <td className="px-3 py-2 text-right"><Saldo value={fila.saldoFinal} bold /></td>
    </tr>
  );
}

export function ComprobacionTable({ reporte }: { reporte: BalanceComprobacion }) {
  const [visibility, setVisibility] = useState<AccountVisibility>(DEFAULT_ACCOUNT_VISIBILITY);

  const filas = useMemo(
    () => (visibility === "all" ? reporte.filas : reporte.filas.filter(tieneAlgo)),
    [reporte.filas, visibility]
  );

  const { totales } = reporte;

  return (
    <div className="space-y-3">
      <AccountVisibilityToggle
        value={visibility}
        onChange={setVisibility}
        zeroCount={reporte.cuentasEnCero}
      />

      {!totales.cuadra && (
        <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>El balance de comprobación NO cuadra.</strong> La suma de débitos difiere de
            la de créditos en <strong>B/. {money(Math.abs(totales.diferencia))}</strong>. Cada
            asiento tiene la misma plata de los dos lados, así que esto significa que hay un
            asiento descuadrado en la base. Avisá antes de usar estos reportes.
          </span>
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-semibold">Código</th>
              <th className="px-3 py-2 font-semibold">Cuenta</th>
              <th className="px-3 py-2 text-right font-semibold">Saldo inicial</th>
              <th className="px-3 py-2 text-right font-semibold">Débitos</th>
              <th className="px-3 py-2 text-right font-semibold">Créditos</th>
              <th className="px-3 py-2 text-right font-semibold">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <Fila key={f.code} fila={f} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-integra-navy/20 bg-gray-50/60">
              <td colSpan={2} className="px-3 py-2.5 text-sm font-bold text-integra-navy">
                Totales ({filas.length} cuenta{filas.length === 1 ? "" : "s"})
              </td>
              <td className="px-3 py-2.5 text-right"><Saldo value={totales.saldoInicial} bold /></td>
              <td className="px-3 py-2.5 text-right">
                <span className="font-mono text-sm font-bold tabular-nums text-gray-800">
                  {money(totales.debitos)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right">
                <span className="font-mono text-sm font-bold tabular-nums text-gray-800">
                  {money(totales.creditos)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right"><Saldo value={totales.saldoFinal} bold /></td>
            </tr>
            <tr className={totales.cuadra ? "bg-green-50/60" : "bg-red-50"}>
              <td colSpan={5} className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                Débitos − Créditos
              </td>
              <td className="px-3 py-2 text-right">
                <span
                  className={
                    "font-mono text-sm font-bold tabular-nums " +
                    (totales.cuadra ? "text-green-700" : "text-red-700")
                  }
                >
                  {money(totales.diferencia)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

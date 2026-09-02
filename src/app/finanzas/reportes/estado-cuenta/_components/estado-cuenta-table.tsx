import Link from "next/link";
import { FileText } from "lucide-react";

import type { EstadoCuenta } from "@/lib/finanzas/reports/estado-cuenta";

/**
 * Tabla del Estado de Cuenta.
 *
 * Deliberadamente igual a la del Libro Mayor: fila de saldo inicial, movimientos
 * con saldo corrido y pie con los totales. Es el mismo reporte mirado por
 * tercero en vez de por cuenta, y tiene que sentirse así.
 */

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Monto({ value, bold }: { value: number; bold?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="text-gray-300">—</span>;
  return (
    <span className={"font-mono text-sm tabular-nums text-gray-800" + (bold ? " font-bold" : "")}>
      {money(value)}
    </span>
  );
}

export function EstadoCuentaTable({
  estado,
  destinos,
}: {
  estado: EstadoCuenta;
  destinos: Map<string, string>;
}) {
  if (estado.filas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
        <p className="text-base font-medium text-integra-navy">Sin movimientos registrados</p>
        <p className="mt-1 text-sm text-gray-500">
          {estado.tercero} no tiene documentos cargados en el sistema. Si tenía saldo antes de la
          puesta en marcha, ese saldo está en la cuenta control y todavía no se repartió por
          tercero.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2 font-semibold">Fecha</th>
            <th className="px-3 py-2 font-semibold">Tipo</th>
            <th className="px-3 py-2 font-semibold">Documento</th>
            <th className="px-3 py-2 font-semibold">Descripción</th>
            <th className="px-3 py-2 text-right font-semibold">Débito</th>
            <th className="px-3 py-2 text-right font-semibold">Crédito</th>
            <th className="px-3 py-2 text-right font-semibold">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-200 bg-integra-navy/5">
            <td className="px-3 py-2 font-mono text-xs text-gray-500">—</td>
            <td className="px-3 py-2 text-sm" colSpan={5}>
              <span className="font-semibold text-integra-navy">Saldo inicial</span>
            </td>
            <td className="px-3 py-2 text-right">
              <Monto value={estado.saldoInicial} bold />
            </td>
          </tr>

          {estado.filas.map((f, i) => {
            const destino = f.documentoId ? (destinos.get(f.documentoId) ?? null) : null;
            return (
              <tr key={`${f.fecha}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                  {f.fecha}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">{f.tipo}</td>
                <td className="px-3 py-2 text-sm">
                  {destino ? (
                    <Link
                      href={destino}
                      className="inline-flex items-center gap-1 text-integra-navy underline decoration-dotted underline-offset-2 hover:text-integra-gold"
                      title="Abrir el documento"
                    >
                      <FileText size={12} />
                      {f.documento}
                    </Link>
                  ) : (
                    <span className="text-gray-700">{f.documento}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600">{f.descripcion}</td>
                <td className="px-3 py-2 text-right"><Monto value={f.debito} /></td>
                <td className="px-3 py-2 text-right"><Monto value={f.credito} /></td>
                <td className="px-3 py-2 text-right"><Monto value={f.saldo} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-integra-navy/20 bg-gray-50/60">
            <td colSpan={4} className="px-3 py-2.5 text-right text-sm text-gray-600">
              Totales
            </td>
            <td className="px-3 py-2.5 text-right"><Monto value={estado.totalDebito} bold /></td>
            <td className="px-3 py-2.5 text-right"><Monto value={estado.totalCredito} bold /></td>
            <td className="px-3 py-2.5 text-right">
              <span className="inline-block rounded border-2 border-integra-navy/40 px-2 py-1">
                <Monto value={estado.saldoFinal} bold />
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

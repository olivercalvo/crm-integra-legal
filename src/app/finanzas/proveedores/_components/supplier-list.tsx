import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { SupplierListItem } from "@/lib/finanzas/types/supplier";
import { paymentTermsLabel } from "@/lib/finanzas/types/supplier";

/**
 * Listado de proveedores.
 *
 * 🔴 RUC y DV se muestran en DOS COLUMNAS, igual que se guardan y que los pide
 * el formulario de la DGI. No hay ningún punto de esta tabla donde se junten.
 */

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SupplierList({
  proveedores,
  rucRepetidos,
}: {
  proveedores: SupplierListItem[];
  /** id → números de los otros proveedores que comparten su RUC. */
  rucRepetidos: Map<string, string[]>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[900px]">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2 font-semibold">Número</th>
            <th className="px-3 py-2 font-semibold">Razón social</th>
            <th className="px-3 py-2 font-semibold">RUC</th>
            <th className="px-3 py-2 font-semibold">DV</th>
            <th className="px-3 py-2 font-semibold">Plazo</th>
            <th className="px-3 py-2 text-right font-semibold">Gastos</th>
            <th className="px-3 py-2 text-right font-semibold">Pendiente</th>
            <th className="px-3 py-2 font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody>
          {proveedores.map((p) => {
            const gemelos = rucRepetidos.get(p.id);
            return (
              <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2">
                  <Link
                    href={`/finanzas/proveedores/${p.id}`}
                    className="font-mono text-sm text-integra-navy underline decoration-dotted underline-offset-2 hover:text-integra-gold"
                  >
                    {p.supplier_number}
                  </Link>
                </td>

                <td className="px-3 py-2">
                  <span className="text-sm font-medium text-gray-900">{p.legal_name}</span>
                  {p.trade_name && (
                    <span className="block text-xs text-gray-500">{p.trade_name}</span>
                  )}
                </td>

                {/* RUC y DV: dos celdas, siempre. */}
                <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-gray-700">
                  {p.ruc ?? <span className="text-amber-600">sin RUC</span>}
                  {gemelos && gemelos.length > 0 && (
                    <span
                      className="ml-1.5 inline-flex items-center gap-1 text-xs text-amber-700"
                      title={`Mismo RUC que ${gemelos.join(", ")}`}
                    >
                      <AlertTriangle size={12} />
                      {gemelos.join(", ")}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-gray-700">
                  {p.dv ?? <span className="text-gray-300">—</span>}
                </td>

                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                  {paymentTermsLabel(p.payment_terms_days)}
                </td>

                <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-700">
                  {p.expense_count}
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-800">
                  {p.pending_total > 0.005 ? (
                    money(p.pending_total)
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>

                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium " +
                      (p.active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-200 text-gray-600")
                    }
                  >
                    {p.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

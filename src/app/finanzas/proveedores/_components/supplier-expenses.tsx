import Link from "next/link";

import { paymentTermsLabel } from "@/lib/finanzas/types/supplier";

/**
 * Los gastos del proveedor dentro de su ficha.
 *
 * Muestra fecha del gasto Y fecha de vencimiento en columnas distintas, porque
 * la diferencia entre las dos ES el plazo, y es lo que hace visible para qué
 * sirve el campo que se cargó arriba.
 */

interface Gasto {
  id: string;
  description: string;
  expense_date: string;
  due_date: string | null;
  total: string | number;
  status: string;
}

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function soloFecha(s: string): string {
  return String(s).slice(0, 10);
}

export function SupplierExpenses({ gastos, plazo }: { gastos: Gasto[]; plazo: number }) {
  if (gastos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <p className="text-sm font-medium text-integra-navy">Sin gastos registrados</p>
        <p className="mt-1 text-xs text-gray-500">
          Cuando se cargue un gasto con este proveedor va a aparecer acá, con su vencimiento
          calculado a {paymentTermsLabel(plazo).toLowerCase()}.
        </p>
      </div>
    );
  }

  const pendiente = gastos
    .filter((g) => g.status === "pendiente_pago")
    .reduce((s, g) => s + Number(g.total), 0);

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-gray-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-integra-navy">
          Gastos ({gastos.length})
        </h2>
        <p className="text-xs text-gray-600">
          Pendiente de pago:{" "}
          <span className="font-mono font-semibold text-gray-900">{money(pendiente)}</span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-semibold">Fecha del gasto</th>
              <th className="px-3 py-2 font-semibold">Vence</th>
              <th className="px-3 py-2 font-semibold">Plazo</th>
              <th className="px-3 py-2 font-semibold">Descripción</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {gastos.map((g) => {
              const desde = soloFecha(g.expense_date);
              const vence = g.due_date ? soloFecha(g.due_date) : null;
              const dias = vence
                ? Math.round(
                    (new Date(`${vence}T00:00:00Z`).getTime() -
                      new Date(`${desde}T00:00:00Z`).getTime()) /
                      86_400_000
                  )
                : null;

              return (
                <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                    {desde}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-800">
                    {vence ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                    {dias === null ? "—" : paymentTermsLabel(dias)}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    <Link
                      href={`/finanzas/gastos-bufete/${g.id}`}
                      className="text-integra-navy underline decoration-dotted underline-offset-2 hover:text-integra-gold"
                    >
                      {g.description}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-800">
                    {money(Number(g.total))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium " +
                        (g.status === "pendiente_pago"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-green-100 text-green-800")
                      }
                    >
                      {g.status === "pendiente_pago" ? "Pendiente" : "Pagado"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

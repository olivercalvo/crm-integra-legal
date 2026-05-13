import Link from "next/link";
import { FileText } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import { QuoteStatusBadge } from "@/components/finanzas/cotizaciones/quote-status-badge";
import type { QuoteListItem } from "@/lib/finanzas/types/quote";

interface Props {
  quotes: QuoteListItem[];
}

/**
 * Tabla responsive de cotizaciones. Desktop → tabla; mobile → cards
 * touch-friendly (mínimo 48px tap target). Mismo patrón que InvoicesList
 * para mantener consistencia con el módulo Facturas.
 */
export function QuotesList({ quotes }: Props) {
  return (
    <>
      {/* Desktop: tabla */}
      <div className="hidden lg:block overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Número</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Caso</th>
              <th className="px-4 py-3 font-semibold">Emisión</th>
              <th className="px-4 py-3 font-semibold">Vence</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {quotes.map((q) => (
              <tr key={q.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/finanzas/cotizaciones/${q.id}`}
                    className="font-mono text-sm font-medium text-integra-navy hover:underline"
                  >
                    {q.quote_number}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {q.client ? (
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {q.client.name}
                        {q.client.client_status === "prospect" && (
                          <span className="ml-1 text-[10px] font-semibold uppercase text-amber-700">
                            (prospecto)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">{q.client.client_number}</p>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {q.case ? (
                    <span className="font-mono text-xs text-gray-600">{q.case.case_code}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {formatDate(q.issue_date)}
                </td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {formatDate(q.valid_until)}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                  ${Number(q.grand_total).toFixed(2)}
                </td>
                <td className="px-4 py-3">
                  <QuoteStatusBadge status={q.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="lg:hidden space-y-2">
        {quotes.map((q) => (
          <Link
            key={q.id}
            href={`/finanzas/cotizaciones/${q.id}`}
            className="block rounded-lg border bg-white p-4 shadow-sm hover:border-integra-navy"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-integra-gold shrink-0" />
                  <span className="font-mono text-sm font-medium text-integra-navy">
                    {q.quote_number}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-gray-900 truncate">
                  {q.client?.name ?? "—"}
                  {q.client?.client_status === "prospect" && (
                    <span className="ml-1 text-[10px] font-semibold uppercase text-amber-700">
                      (prospecto)
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  Vence {formatDate(q.valid_until)}
                  {q.case?.case_code && (
                    <>
                      {" · "}
                      <span className="font-mono">{q.case.case_code}</span>
                    </>
                  )}
                </p>
              </div>
              <QuoteStatusBadge status={q.status} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-gray-500">Emitida {formatDate(q.issue_date)}</span>
              <p className="font-semibold text-gray-900">
                ${Number(q.grand_total).toFixed(2)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

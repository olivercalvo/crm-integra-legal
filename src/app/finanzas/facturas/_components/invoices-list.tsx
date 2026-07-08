import Link from "next/link";
import { FileText } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import { InvoiceStatusBadge } from "@/components/finanzas/invoice-status-badge";
import { FeEstadoBadge } from "@/components/finanzas/fe-estado-badge";
import { INVOICE_KIND_LABEL, type InvoiceListItem } from "@/lib/finanzas/types/invoice";

interface Props {
  invoices: InvoiceListItem[];
}

/**
 * Tabla responsive de facturas. En desktop se muestra como tabla; en mobile
 * cada factura se presenta como card touch-friendly (mín 48px tap target).
 */
export function InvoicesList({ invoices }: Props) {
  return (
    <>
      {/* Desktop: tabla */}
      <div className="hidden lg:block overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Número</th>
              <th className="px-4 py-3 font-semibold">Tipo</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Caso</th>
              <th className="px-4 py-3 font-semibold">Emisión</th>
              <th className="px-4 py-3 font-semibold">Vence</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th>
              <th className="px-4 py-3 font-semibold text-right">Saldo</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Fiscal</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/finanzas/facturas/${inv.id}`}
                    className="font-mono text-sm font-medium text-integra-navy hover:underline"
                  >
                    {inv.invoice_number || (
                      <span className="italic text-gray-400">— sin número —</span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {INVOICE_KIND_LABEL[inv.invoice_kind]}
                </td>
                <td className="px-4 py-3">
                  {inv.client ? (
                    <div>
                      <p className="font-medium text-gray-900 truncate">{inv.client.name}</p>
                      <p className="text-xs text-gray-500">{inv.client.client_number}</p>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {inv.case ? (
                    <span className="font-mono text-xs text-gray-600">{inv.case.case_code}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {formatDate(inv.issue_date)}
                </td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {formatDate(inv.due_date)}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                  ${Number(inv.grand_total).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <span
                    className={
                      Number(inv.balance_due) > 0
                        ? "font-medium text-amber-700"
                        : "text-gray-400"
                    }
                  >
                    ${Number(inv.balance_due).toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <InvoiceStatusBadge status={inv.status} />
                </td>
                <td className="px-4 py-3">
                  <FeEstadoBadge estado={inv.fe_estado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="lg:hidden space-y-2">
        {invoices.map((inv) => (
          <Link
            key={inv.id}
            href={`/finanzas/facturas/${inv.id}`}
            className="block rounded-lg border bg-white p-4 shadow-sm hover:border-integra-navy"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-integra-gold shrink-0" />
                  <span className="font-mono text-sm font-medium text-integra-navy">
                    {inv.invoice_number || "— sin número —"}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-gray-900 truncate">
                  {inv.client?.name ?? "—"}
                </p>
                <p className="text-xs text-gray-500">
                  {INVOICE_KIND_LABEL[inv.invoice_kind]}
                  {inv.case?.case_code && (
                    <>
                      {" · "}
                      <span className="font-mono">{inv.case.case_code}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <InvoiceStatusBadge status={inv.status} />
                <FeEstadoBadge estado={inv.fe_estado} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-gray-500">Vence {formatDate(inv.due_date)}</span>
              <div className="text-right">
                <p className="font-semibold text-gray-900">
                  ${Number(inv.grand_total).toFixed(2)}
                </p>
                {Number(inv.balance_due) > 0 && (
                  <p className="text-xs text-amber-700">
                    Saldo ${Number(inv.balance_due).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

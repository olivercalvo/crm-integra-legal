import Link from "next/link";
import { FileText, Paperclip } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import { BusinessExpenseStatusBadge } from "./business-expense-status-badge";
import type { BusinessExpenseListItem } from "@/lib/finanzas/types/business-expense";

interface Props {
  expenses: BusinessExpenseListItem[];
}

function fmtMoney(n: number | string): string {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Tabla responsive de gastos del bufete. Desktop: tabla; mobile: cards.
 * Mismo patrón que invoices-list.tsx.
 */
export function BusinessExpenseList({ expenses }: Props) {
  return (
    <>
      {/* Desktop: tabla */}
      <div className="hidden lg:block overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Fecha</th>
              <th className="px-4 py-3 font-semibold">Proveedor</th>
              <th className="px-4 py-3 font-semibold">Descripción</th>
              <th className="px-4 py-3 font-semibold">Cuenta</th>
              <th className="px-4 py-3 font-semibold text-right">Subtotal</th>
              <th className="px-4 py-3 font-semibold text-right">ITBMS</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                  <Link
                    href={`/finanzas/gastos-bufete/${e.id}`}
                    className="text-integra-navy hover:underline"
                  >
                    {formatDate(e.expense_date)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {e.supplier_name ? (
                    <div>
                      <p className="text-gray-900 truncate max-w-[180px]">{e.supplier_name}</p>
                      {e.supplier_ruc && (
                        <p className="font-mono text-xs text-gray-500">{e.supplier_ruc}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 max-w-[260px]">
                    <span className="text-gray-900 truncate">{e.description}</span>
                    {e.receipt_url && (
                      <Paperclip size={12} className="shrink-0 text-integra-gold" />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {e.account ? (
                    <span className="text-xs text-gray-600">
                      <span className="font-mono">{e.account.code}</span>
                      <span className="ml-1 text-gray-400">{e.account.name}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">Sin clasificar</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                  ${fmtMoney(e.subtotal)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {Number(e.tax_amount) > 0 ? (
                    <span className="text-gray-700">${fmtMoney(e.tax_amount)}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-integra-navy whitespace-nowrap">
                  ${fmtMoney(e.total)}
                </td>
                <td className="px-4 py-3">
                  <BusinessExpenseStatusBadge status={e.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="lg:hidden space-y-2">
        {expenses.map((e) => (
          <Link
            key={e.id}
            href={`/finanzas/gastos-bufete/${e.id}`}
            className="block rounded-lg border bg-white p-4 shadow-sm hover:border-integra-navy"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-integra-gold shrink-0" />
                  <span className="text-sm font-medium text-integra-navy">
                    {formatDate(e.expense_date)}
                  </span>
                  {e.receipt_url && (
                    <Paperclip size={12} className="text-integra-gold" />
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-gray-900 truncate">
                  {e.description}
                </p>
                {e.supplier_name && (
                  <p className="text-xs text-gray-500 truncate">{e.supplier_name}</p>
                )}
                {e.account && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    <span className="font-mono">{e.account.code}</span>{" "}
                    <span className="text-gray-400">— {e.account.name}</span>
                  </p>
                )}
              </div>
              <BusinessExpenseStatusBadge status={e.status} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-xs text-gray-500">
                Subtotal ${fmtMoney(e.subtotal)}
                {Number(e.tax_amount) > 0 && (
                  <> · ITBMS ${fmtMoney(e.tax_amount)}</>
                )}
              </span>
              <span className="font-semibold text-integra-navy">
                ${fmtMoney(e.total)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

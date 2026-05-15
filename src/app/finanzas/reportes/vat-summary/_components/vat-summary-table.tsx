import type { VatSummaryLine } from "@/lib/finanzas/reports/vat-summary";

interface Props {
  lines: VatSummaryLine[];
}

function fmtMoney(n: number): string {
  // Formato en-US con separadores de miles y 2 decimales. Negativos con
  // paréntesis al estilo contable. Cero exactamente como "0.00".
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n < 0) return `(${abs})`;
  return abs;
}

/**
 * Tabla principal del VAT Summary — render server-side de las 10 líneas
 * canónicas con resaltado para las líneas total (7 y 10).
 */
export function VatSummaryTable({ lines }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-4 py-3 font-semibold w-12 text-center">#</th>
            <th className="px-4 py-3 font-semibold">Concepto</th>
            <th className="px-4 py-3 font-semibold text-right">Monto (B/.)</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {lines.map((line) => {
            const isTotal = line.is_total === true;
            const isNegative = line.value < 0;
            return (
              <tr
                key={line.number}
                className={
                  isTotal
                    ? "bg-integra-navy/5"
                    : "hover:bg-gray-50"
                }
              >
                <td className="px-4 py-3 text-center text-xs text-gray-400 align-top">
                  {line.number}
                </td>
                <td className={"px-4 py-3 " + (isTotal ? "font-semibold text-integra-navy" : "text-gray-900")}>
                  {line.label}
                  {line.hint && (
                    <p className={"mt-0.5 text-xs " + (isTotal ? "text-gray-600" : "text-gray-400")}>
                      {line.hint}
                    </p>
                  )}
                </td>
                <td
                  className={
                    "px-4 py-3 text-right whitespace-nowrap font-mono " +
                    (isTotal ? "text-base font-bold text-integra-navy" : "text-sm text-gray-900") +
                    (isNegative ? " text-red-700" : "")
                  }
                >
                  {fmtMoney(line.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

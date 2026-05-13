"use client";

import { useMemo } from "react";
import type { QuoteLineEditorInput } from "./quote-lines-editor";

interface Props {
  lines: QuoteLineEditorInput[];
}

/**
 * Tarjeta de totales calculados client-side. La BD recalcula vía trigger
 * T8b-quote al guardar — esto es solo para feedback inmediato (D2).
 *
 * Muestra 3 bloques:
 *   - Subtotal Honorarios (HON)
 *   - Subtotal Reembolso (REI)
 *   - Total general (subtotal + impuestos, más prominente)
 */
export function QuoteTotalsCard({ lines }: Props) {
  const totals = useMemo(() => {
    let subtotal_hon = 0;
    let subtotal_rei = 0;
    let tax_total = 0;
    for (const ln of lines) {
      const q = Number(ln.quantity) || 0;
      const p = Number(ln.unit_price) || 0;
      const r = Number(ln.tax_rate) || 0;
      const sub = q * p;
      tax_total += sub * r;
      if (ln.invoice_kind === "HON") subtotal_hon += sub;
      else if (ln.invoice_kind === "REI") subtotal_rei += sub;
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const subtotal = subtotal_hon + subtotal_rei;
    return {
      subtotal_hon: round2(subtotal_hon),
      subtotal_rei: round2(subtotal_rei),
      tax_total: round2(tax_total),
      grand_total: round2(subtotal + tax_total),
    };
  }, [lines]);

  return (
    <div className="rounded-lg border border-integra-gold/40 bg-integra-navy/[0.03] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-integra-navy mb-3">
        Totales (estimados)
      </h3>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-blue-700">Subtotal honorarios</dt>
          <dd className="font-mono font-medium text-gray-900">
            ${totals.subtotal_hon.toFixed(2)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-orange-700">Subtotal reembolso</dt>
          <dd className="font-mono font-medium text-gray-900">
            ${totals.subtotal_rei.toFixed(2)}
          </dd>
        </div>
        <div className="flex justify-between text-xs text-gray-500 pt-1">
          <dt>Impuestos</dt>
          <dd className="font-mono">${totals.tax_total.toFixed(2)}</dd>
        </div>
        <div className="border-t border-integra-gold/30 pt-2 flex justify-between">
          <dt className="font-semibold text-integra-navy">Total general</dt>
          <dd className="font-mono text-lg font-bold text-integra-navy">
            ${totals.grand_total.toFixed(2)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-gray-500">
        Los totales finales se recalculan en el servidor al guardar.
      </p>
    </div>
  );
}

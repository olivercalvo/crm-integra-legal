"use client";

import { useMemo } from "react";
import { calcTotalsClient } from "@/lib/finanzas/validators/invoice";
import type { InvoiceLineInput } from "@/lib/finanzas/types/invoice";

interface Props {
  lines: Pick<InvoiceLineInput, "quantity" | "unit_price" | "tax_rate">[];
}

/**
 * Tarjeta de totales calculados client-side (D5). El server recalcula
 * vía trigger T8b al guardar — esto es solo para feedback inmediato.
 */
export function InvoiceTotalsCard({ lines }: Props) {
  const { subtotal, taxTotal, grandTotal } = useMemo(
    () => calcTotalsClient(lines),
    [lines]
  );

  return (
    <div className="rounded-lg border border-integra-gold/40 bg-integra-navy/[0.03] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-integra-navy mb-3">
        Totales (estimados)
      </h3>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-600">Subtotal</dt>
          <dd className="font-mono font-medium text-gray-900">
            ${subtotal.toFixed(2)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600">Impuestos</dt>
          <dd className="font-mono font-medium text-gray-900">
            ${taxTotal.toFixed(2)}
          </dd>
        </div>
        <div className="border-t border-integra-gold/30 pt-2 flex justify-between">
          <dt className="font-semibold text-integra-navy">Total</dt>
          <dd className="font-mono text-lg font-bold text-integra-navy">
            ${grandTotal.toFixed(2)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-gray-500">
        El total final se recalcula en el servidor al guardar.
      </p>
    </div>
  );
}

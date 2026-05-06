"use client";

import type { TaxCodeOption } from "@/lib/finanzas/types/invoice";

interface TaxCodeSelectProps {
  taxCodes: TaxCodeOption[];
  value: string; // tax_code_id (UUID)
  onChange: (taxCodeId: string, taxCode: TaxCodeOption | null) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Select de impuesto — HTML nativo. Pocas opciones (3-4 tax codes activos),
 * UI compacta para que viva inline en una fila de línea sin ocupar mucho.
 *
 * El caller se encarga de snapshotear `tax_code` (TEXT) y `tax_rate` en la
 * línea cuando esto cambia (el callback recibe el TaxCodeOption completo).
 */
export function TaxCodeSelect({
  taxCodes,
  value,
  onChange,
  error,
  disabled,
}: TaxCodeSelectProps) {
  return (
    <div>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const id = e.target.value;
          const tc = taxCodes.find((t) => t.id === id) ?? null;
          onChange(id, tc);
        }}
        className={`block w-full rounded-md border px-3 min-h-[44px] text-sm bg-white transition-colors ${
          error ? "border-red-300" : "border-gray-300"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-integra-navy focus:border-integra-navy focus:outline-none"}`}
      >
        {!value && <option value="">— impuesto —</option>}
        {taxCodes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({(t.rate * 100).toFixed(t.rate * 100 === 0 ? 0 : 1)}%)
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

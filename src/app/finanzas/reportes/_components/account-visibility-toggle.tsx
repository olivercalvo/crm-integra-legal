"use client";

import { Filter, List } from "lucide-react";
import type { AccountVisibility } from "@/lib/finanzas/reports/report-visibility";

/**
 * Toggle "Solo cuentas con saldo" / "Todas las cuentas", compartido por el
 * Balance General y el Estado de Resultado.
 *
 * Es 100% client-side sobre los datos que la página ya trajo: no hay refetch ni
 * parámetro en la URL, alternar es instantáneo.
 */
export function AccountVisibilityToggle({
  value,
  onChange,
  zeroCount,
}: {
  value: AccountVisibility;
  onChange: (v: AccountVisibility) => void;
  /** Cuántas cuentas en 0 se esconden en la vista "solo con saldo". */
  zeroCount: number;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div
        role="radiogroup"
        aria-label="Cuentas a mostrar"
        className="inline-flex w-full overflow-hidden rounded-lg border border-integra-navy/20 bg-white sm:w-auto"
      >
        <ToggleOption
          selected={value === "with-balance"}
          onSelect={() => onChange("with-balance")}
          icon={<Filter size={16} />}
          label="Solo cuentas con saldo"
        />
        <ToggleOption
          selected={value === "all"}
          onSelect={() => onChange("all")}
          icon={<List size={16} />}
          label="Todas las cuentas"
        />
      </div>

      {zeroCount > 0 && (
        <p className="text-xs text-gray-500">
          {value === "with-balance" ? (
            <>
              <strong>{zeroCount}</strong> cuenta(s) en 0 ocultas. Los totales son los mismos en
              las dos vistas.
            </>
          ) : (
            <>
              Se muestran las <strong>{zeroCount}</strong> cuenta(s) en 0.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function ToggleOption({
  selected,
  onSelect,
  icon,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors sm:flex-none ${
        selected
          ? "bg-integra-navy text-white"
          : "bg-white text-integra-navy hover:bg-integra-navy/5"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

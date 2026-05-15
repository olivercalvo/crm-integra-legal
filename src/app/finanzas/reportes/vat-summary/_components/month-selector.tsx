"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthBefore, monthAfter } from "@/lib/finanzas/reports/vat-summary";

interface Props {
  /** Mes actual en formato YYYY-MM. */
  month: string;
  /** Etiqueta legible del mes ("Abril 2026"). */
  label: string;
  /** YYYY-MM del mes actual (para deshabilitar "siguiente" si ya estamos en él). */
  currentMonth: string;
}

/**
 * Selector de período del VAT Summary. Tres elementos:
 *   - Flecha izquierda: mes anterior.
 *   - <input type="month">: salto directo a cualquier mes.
 *   - Flecha derecha: mes siguiente (deshabilitada si ya estamos en el mes actual,
 *     porque no permitimos consultar meses futuros).
 *
 * Cada cambio reescribe el query param ?month=YYYY-MM y el server component
 * refetchea el cálculo.
 */
export function MonthSelector({ month, label, currentMonth }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function go(toMonth: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", toMonth);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const nextMonth = monthAfter(month);
  const prevMonth = monthBefore(month);
  // No permitir avanzar a un mes posterior al actual del calendario.
  const canGoNext = nextMonth <= currentMonth;

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => go(prevMonth)}
        disabled={isPending}
        className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-l-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        aria-label="Mes anterior"
      >
        <ChevronLeft size={18} />
      </button>

      <input
        type="month"
        value={month}
        max={currentMonth}
        onChange={(e) => {
          const v = e.target.value;
          if (v) go(v);
        }}
        disabled={isPending}
        className="h-10 border-l border-r border-gray-200 bg-white px-3 text-sm focus:outline-none"
        aria-label={`Mes seleccionado: ${label}`}
      />

      <button
        type="button"
        onClick={() => go(nextMonth)}
        disabled={isPending || !canGoNext}
        className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-r-md text-gray-600 hover:bg-gray-50 disabled:opacity-30"
        aria-label="Mes siguiente"
        title={canGoNext ? "Mes siguiente" : "No se permite consultar meses futuros"}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

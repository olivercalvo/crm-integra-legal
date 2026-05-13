import { QUOTE_LINE_KIND_LABEL, type QuoteLineKind } from "@/lib/finanzas/types/quote";

interface QuoteKindIndicatorProps {
  kind: QuoteLineKind;
  /** Versión compacta — solo el código HON/REI. Default false → "HON · Honorarios". */
  compact?: boolean;
  className?: string;
}

/**
 * Indicador HON / REI por línea de cotización (D2). Azul para honorarios,
 * naranja para reembolsos. Se usa en la tabla del editor de líneas, en el
 * detalle y en el preview de conversión a facturas.
 */
function kindClasses(kind: QuoteLineKind): string {
  return kind === "HON"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-orange-50 text-orange-700 border-orange-200";
}

export function QuoteKindIndicator({ kind, compact = false, className = "" }: QuoteKindIndicatorProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${kindClasses(
        kind
      )} ${className}`}
    >
      <span className="font-mono">{kind}</span>
      {!compact && (
        <span className="font-normal text-[11px] opacity-80">
          · {QUOTE_LINE_KIND_LABEL[kind]}
        </span>
      )}
    </span>
  );
}

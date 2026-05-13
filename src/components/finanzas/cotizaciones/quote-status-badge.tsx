import { Badge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "@/lib/finanzas/types/quote";

interface QuoteStatusBadgeProps {
  status: QuoteStatus;
}

/**
 * Badge de status de cotización. Paleta D7 — distinta a InvoiceStatusBadge
 * para que se distingan visualmente en pantallas mixtas (un mismo cliente
 * puede ver una factura "borrador" gris y una cotización "borrador" gris,
 * pero las transiciones únicas — convertida violeta, expirada ámbar — son
 * exclusivas del flujo de cotizaciones).
 */
function statusClasses(status: QuoteStatus): string {
  switch (status) {
    case "borrador":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "enviada":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "aceptada":
      return "bg-green-100 text-green-800 border-green-200";
    case "rechazada":
      return "bg-red-100 text-red-700 border-red-200";
    case "expirada":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "convertida":
      return "bg-violet-100 text-violet-800 border-violet-200";
    case "cancelada_pre_envio":
      return "bg-gray-200 text-gray-600 border-gray-300 italic";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

/** Etiqueta corta para mostrar (D7: "cancelada_pre_envio" → "Cancelada"). */
function statusLabel(status: QuoteStatus): string {
  if (status === "cancelada_pre_envio") return "Cancelada";
  return QUOTE_STATUS_LABEL[status] ?? status;
}

export function QuoteStatusBadge({ status }: QuoteStatusBadgeProps) {
  return (
    <Badge variant="outline" className={`${statusClasses(status)} font-medium`}>
      {statusLabel(status)}
    </Badge>
  );
}

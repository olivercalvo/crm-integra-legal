import { Badge } from "@/components/ui/badge";
import type { InvoiceStatus } from "@/lib/finanzas/types/invoice";
import { INVOICE_STATUS_LABEL } from "@/lib/finanzas/types/invoice";

interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
}

/** Mapea status → variante visual. Mantenemos paleta corporativa Integra. */
function statusClasses(status: InvoiceStatus): string {
  switch (status) {
    case "borrador":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "emitida":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "parcialmente_pagada":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "pagada":
      return "bg-green-50 text-green-700 border-green-200";
    case "anulada":
      return "bg-red-50 text-red-700 border-red-200";
    case "cancelada_pre_emision":
      return "bg-gray-50 text-gray-500 border-gray-200 italic";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

export function InvoiceStatusBadge({ status }: InvoiceStatusBadgeProps) {
  return (
    <Badge variant="outline" className={`${statusClasses(status)} font-medium`}>
      {INVOICE_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

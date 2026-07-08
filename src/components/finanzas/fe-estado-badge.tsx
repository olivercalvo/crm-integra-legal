import { Badge } from "@/components/ui/badge";
import type { FeEstado } from "@/lib/finanzas/types/invoice";
import { FE_ESTADO_LABEL } from "@/lib/finanzas/types/invoice";

interface FeEstadoBadgeProps {
  estado: FeEstado;
}

function estadoClasses(estado: FeEstado): string {
  switch (estado) {
    case "no_emitida":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "pending":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "authorized":
      return "bg-green-50 text-green-700 border-green-200";
    case "error":
      return "bg-red-50 text-red-700 border-red-200";
    case "canceled":
      return "bg-gray-50 text-gray-500 border-gray-200 italic";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

export function FeEstadoBadge({ estado }: FeEstadoBadgeProps) {
  return (
    <Badge variant="outline" className={`${estadoClasses(estado)} font-medium`}>
      {FE_ESTADO_LABEL[estado] ?? estado}
    </Badge>
  );
}

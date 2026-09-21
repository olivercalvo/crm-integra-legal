import { CheckCircle2, CircleDot, Clock } from "lucide-react";
import {
  BUSINESS_EXPENSE_STATUS_LABEL,
  type BusinessExpenseStatus,
} from "@/lib/finanzas/types/business-expense";

interface Props {
  status: BusinessExpenseStatus;
}

/**
 * Badge de estado de un gasto del bufete. Lo deriva el trigger de la 048.
 *   - pagado:               verde, icono check
 *   - parcialmente_pagado:  azul, icono medio círculo (Bloque 3)
 *   - pendiente_pago:       ámbar, icono reloj
 */
export function BusinessExpenseStatusBadge({ status }: Props) {
  const estilo =
    status === "pagado"
      ? { Icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-700" }
      : status === "parcialmente_pagado"
        ? { Icon: CircleDot, cls: "bg-sky-100 text-sky-700" }
        : { Icon: Clock, cls: "bg-amber-100 text-amber-700" };
  const Icon = estilo.Icon;
  return (
    <span
      className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " + estilo.cls}
    >
      <Icon size={12} />
      {BUSINESS_EXPENSE_STATUS_LABEL[status]}
    </span>
  );
}

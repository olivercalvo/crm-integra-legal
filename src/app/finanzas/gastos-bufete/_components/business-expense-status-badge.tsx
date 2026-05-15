import { CheckCircle2, Clock } from "lucide-react";
import {
  BUSINESS_EXPENSE_STATUS_LABEL,
  type BusinessExpenseStatus,
} from "@/lib/finanzas/types/business-expense";

interface Props {
  status: BusinessExpenseStatus;
}

/**
 * Badge de estado de un gasto del bufete.
 *   - pagado:         verde, icono check
 *   - pendiente_pago: ámbar, icono reloj
 */
export function BusinessExpenseStatusBadge({ status }: Props) {
  const isPaid = status === "pagado";
  const Icon = isPaid ? CheckCircle2 : Clock;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
        (isPaid
          ? "bg-emerald-100 text-emerald-700"
          : "bg-amber-100 text-amber-700")
      }
    >
      <Icon size={12} />
      {BUSINESS_EXPENSE_STATUS_LABEL[status]}
    </span>
  );
}

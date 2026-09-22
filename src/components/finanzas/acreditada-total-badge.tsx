import { Badge } from "@/components/ui/badge";

/**
 * "Acreditada total" NO es un estado de la factura (Bloque 5, D3): es una
 * factura `emitida` cuyo total quedó acreditado por notas de crédito, con
 * saldo 0. T7a no la marca `pagada` (se pagó nada) y la antigüedad no la
 * lista (saldo 0). Se deriva en la pantalla de `credited_total >= grand_total`
 * y se muestra junto al badge de status, nunca en su lugar.
 */
export function AcreditadaTotalBadge() {
  return (
    <Badge
      variant="outline"
      className="border-violet-200 bg-violet-50 font-medium text-violet-700"
      title="Todo el total de la factura fue acreditado por nota de crédito: saldo 0"
    >
      Acreditada total
    </Badge>
  );
}

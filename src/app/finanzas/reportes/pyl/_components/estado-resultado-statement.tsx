"use client";

import { useMemo, useState } from "react";
import type { EstadoResultado } from "@/lib/finanzas/reports/accounting-reports";
import {
  DEFAULT_ACCOUNT_VISIBILITY,
  countZeroRows,
  filterSection,
  type AccountVisibility,
} from "@/lib/finanzas/reports/report-visibility";
import {
  StatementTable,
  StatementSection,
  ComputedRow,
} from "../../_components/financial-statement";
import { AccountVisibilityToggle } from "../../_components/account-visibility-toggle";

const EMPTY_FILTERED = "Todas las cuentas de esta sección están en 0";

/**
 * Tabla del Estado de Resultado con el toggle "solo cuentas con saldo".
 *
 * Los renglones CALCULADOS (Ganancia Bruta, Utilidad Operativa, ISR, Utilidad
 * Neta) se muestran siempre: no son cuentas, son la estructura del reporte.
 */
export function EstadoResultadoStatement({
  er,
  isrPct,
}: {
  er: EstadoResultado;
  /** Tasa ya formateada en el server, para no depender del locale del browser. */
  isrPct: string;
}) {
  const [visibility, setVisibility] = useState<AccountVisibility>(DEFAULT_ACCOUNT_VISIBILITY);

  const zeroCount = useMemo(
    () => countZeroRows([er.ingresos, er.costos, er.gastos]),
    [er]
  );

  const ingresos = filterSection(er.ingresos, visibility);
  const costos = filterSection(er.costos, visibility);
  const gastos = filterSection(er.gastos, visibility);
  const emptyLabel = visibility === "with-balance" ? EMPTY_FILTERED : undefined;

  return (
    <div className="space-y-3">
      <AccountVisibilityToggle
        value={visibility}
        onChange={setVisibility}
        zeroCount={zeroCount}
      />

      <StatementTable>
        <StatementSection section={ingresos} emptyLabel={emptyLabel} />
        <StatementSection section={costos} emptyLabel={emptyLabel} />
        <ComputedRow label="GANANCIA O PÉRDIDA BRUTA" value={er.gananciaBruta} emphasis />

        <StatementSection section={gastos} emptyLabel={emptyLabel} />
        <ComputedRow label="UTILIDAD OPERATIVA" value={er.utilidadOperativa} emphasis />

        <ComputedRow
          label="Impuesto sobre la Renta"
          value={er.isr.amount}
          note={
            er.isr.applied
              ? `tasa provisional ${isrPct}% — a confirmar`
              : "no aplica: el período no cerró con utilidad"
          }
        />
        <ComputedRow label="UTILIDAD NETA" value={er.utilidadNeta} emphasis />
      </StatementTable>
    </div>
  );
}

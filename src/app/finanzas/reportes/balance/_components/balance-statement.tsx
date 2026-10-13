"use client";

import { useMemo, useState } from "react";
import type { BalanceGeneral } from "@/lib/finanzas/reports/accounting-reports";
import {
  DEFAULT_ACCOUNT_VISIBILITY,
  countZeroRows,
  filterSection,
  type AccountVisibility,
} from "@/lib/finanzas/reports/report-visibility";
import {
  StatementTable,
  StatementSection,
  SectionHeaderRow,
  SectionAccountRows,
  SectionTotalRow,
  ComputedRow,
} from "../../_components/financial-statement";
import { AccountVisibilityToggle } from "../../_components/account-visibility-toggle";

const EMPTY_FILTERED = "Todas las cuentas de esta sección están en 0";

/**
 * Tabla del Balance General con el toggle "solo cuentas con saldo".
 *
 * Es client component SOLO por el toggle: el reporte ya viene armado del server
 * (`bg`) y acá nada se recalcula, apenas se esconden filas.
 */
export function BalanceStatement({ bg }: { bg: BalanceGeneral }) {
  const [visibility, setVisibility] = useState<AccountVisibility>(DEFAULT_ACCOUNT_VISIBILITY);

  const zeroCount = useMemo(
    () => countZeroRows([bg.activos, bg.pasivos, bg.patrimonio]),
    [bg]
  );

  const activos = filterSection(bg.activos, visibility);
  const pasivos = filterSection(bg.pasivos, visibility);
  const patrimonio = filterSection(bg.patrimonio, visibility);
  const filtered = visibility === "with-balance";

  return (
    <div className="space-y-3">
      <AccountVisibilityToggle
        value={visibility}
        onChange={setVisibility}
        zeroCount={zeroCount}
      />

      <StatementTable>
        <StatementSection
          section={activos}
          emptyLabel={filtered ? EMPTY_FILTERED : undefined}
        />

        {/* E10: con tasa de ISR distinta de 0, el impuesto CALCULADO entra al
            pasivo como renglón calculado (no es un asiento). Con tasa 0 la
            sección se dibuja como siempre. */}
        {Math.abs(bg.isrPorPagarCalculado) >= 0.005 ? (
          <>
            <SectionHeaderRow label={pasivos.label} />
            <SectionAccountRows section={pasivos} />
            <ComputedRow
              label="Impuesto sobre la renta por pagar"
              value={bg.isrPorPagarCalculado}
              note="calculado con la tasa del bufete, no registrado en el libro"
            />
            <SectionTotalRow label={pasivos.totalLabel} value={pasivos.total} />
          </>
        ) : (
          <StatementSection
            section={pasivos}
            emptyLabel={filtered ? EMPTY_FILTERED : undefined}
          />
        )}

        {/* PATRIMONIO se compone a mano porque intercala un renglón CALCULADO
            (la utilidad neta) entre las cuentas y el total. Ese renglón
            se muestra en las dos vistas: no es una cuenta. */}
        <SectionHeaderRow label={patrimonio.label} />
        <SectionAccountRows section={patrimonio} />
        <ComputedRow
          label="Utilidad neta"
          value={bg.utilidadDelEjercicio}
          note="del Estado de Resultado, acumulada mientras no haya cierre anual"
        />
        <SectionTotalRow label={patrimonio.totalLabel} value={patrimonio.total} />

        <ComputedRow
          label="TOTAL PASIVO + PATRIMONIO"
          value={bg.totalPasivoPatrimonio}
          emphasis
        />
      </StatementTable>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  EstadoResultadoNiif18,
  FilaER,
  MontoPresentado,
} from "@/lib/finanzas/reports/estado-resultado-niif18";
import {
  DEFAULT_ACCOUNT_VISIBILITY,
  hasBalance,
  type AccountVisibility,
} from "@/lib/finanzas/reports/report-visibility";
import { StatementTable } from "../../_components/financial-statement";
import { AccountVisibilityToggle } from "../../_components/account-visibility-toggle";

/**
 * Tabla del Estado de Resultado con la estructura de NIIF 18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE REPORTE NO USA `StatementSection` COMO EL BALANCE
 * ─────────────────────────────────────────────────────────────────────────────
 * Los componentes compartidos de `financial-statement.tsx` imprimen los montos
 * TAL CUAL (convención de balanza: los ingresos salen negativos). El Estado de
 * Resultado usa la convención del REPORTE —ingresos en positivo, costos y gastos
 * entre paréntesis— así que necesita sus propios renglones.
 *
 * El Balance General se quedó con los compartidos, sin tocar. Son dos reportes
 * con dos convenciones distintas y esa diferencia es real, no un descuido.
 *
 * El vuelco de signos NO se hace acá: viene resuelto de
 * `estado-resultado-niif18.ts`, que entrega cada monto ya con su `monto` y su
 * `entreParentesis`. Este componente solo dibuja.
 */

const EMPTY_FILTERED = "Todas las cuentas de esta sección están en 0";

/** Formatea con separador de miles es-PA y 2 decimales. */
function formatAmount(n: number): string {
  return n.toLocaleString("es-PA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Monto en convención de reporte. Los paréntesis significan "resta", que es
 * como los lee un contador — no son un error ni un número negativo.
 */
function Monto({ valor, bold }: { valor: MontoPresentado; bold?: boolean }) {
  const cero = !hasBalance(valor.balanza);
  const tone = cero ? "text-gray-400" : valor.entreParentesis ? "text-gray-600" : "text-gray-800";
  return (
    <span className={`font-mono text-sm tabular-nums ${tone} ${bold ? "font-bold" : ""}`}>
      {valor.entreParentesis ? `(${formatAmount(valor.monto)})` : formatAmount(valor.monto)}
    </span>
  );
}

function Fila({ fila }: { fila: FilaER }) {
  switch (fila.kind) {
    case "bloque":
      return (
        <tr className="bg-integra-navy/5">
          <td
            colSpan={3}
            className="px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-integra-navy"
          >
            {fila.label}
          </td>
        </tr>
      );

    case "grupo":
      return (
        <tr className="bg-gray-50/60">
          <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-integra-navy">
            {fila.label}
          </td>
        </tr>
      );

    case "cuenta":
      // TRAZABILIDAD NIVEL 1 — clic en la cuenta abre su Libro Mayor. Los
      // renglones ESTRUCTURALES (la distribución a socias) no llevan enlace:
      // no vienen del plan de cuentas y no tienen mayor que mostrar.
      return (
        <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
          <td className="w-24 py-1.5 pl-6 pr-2 font-mono text-xs text-gray-500">
            {fila.estructural ? (
              fila.code
            ) : (
              <Link
                href={`/finanzas/reportes/mayor?cuenta=${encodeURIComponent(fila.code)}`}
                className="underline decoration-dotted underline-offset-2 hover:text-integra-navy"
                title={`Ver el Libro Mayor de ${fila.code} ${fila.name}`}
              >
                {fila.code}
              </Link>
            )}
          </td>
          <td className="py-1.5 pr-4 text-sm text-gray-700">
            {fila.estructural ? (
              fila.name
            ) : (
              <Link
                href={`/finanzas/reportes/mayor?cuenta=${encodeURIComponent(fila.code)}`}
                className="hover:text-integra-navy hover:underline"
                title={`Ver el Libro Mayor de ${fila.code} ${fila.name}`}
              >
                {fila.name}
              </Link>
            )}
          </td>
          <td className="w-40 py-1.5 pr-4 text-right">
            <Monto valor={fila.valor} />
          </td>
        </tr>
      );

    case "subtotal":
      return (
        <tr className="border-b border-gray-200">
          <td />
          <td className="py-2 pr-4 text-sm font-semibold text-integra-navy">{fila.label}</td>
          <td className="py-2 pr-4 text-right">
            <Monto valor={fila.valor} bold />
          </td>
        </tr>
      );

    case "resultado":
      return (
        <tr className="border-y-2 border-integra-gold/50 bg-integra-gold/10">
          <td />
          <td className="py-2.5 pr-4 text-sm font-bold text-integra-navy">{fila.label}</td>
          <td className="py-2.5 pr-4 text-right">
            <Monto valor={fila.valor} bold />
          </td>
        </tr>
      );

    case "impuesto":
      return (
        <tr className="border-b border-gray-200 bg-gray-50/40">
          <td />
          <td className="py-2.5 pr-4 text-sm font-semibold text-integra-navy">
            {fila.label}
            <span className="ml-2 text-xs font-normal text-gray-500">{fila.nota}</span>
          </td>
          <td className="py-2.5 pr-4 text-right">
            <Monto valor={fila.valor} bold />
          </td>
        </tr>
      );
  }
}

export function EstadoResultadoStatement({ er }: { er: EstadoResultadoNiif18 }) {
  const [visibility, setVisibility] = useState<AccountVisibility>(DEFAULT_ACCOUNT_VISIBILITY);

  const zeroCount = useMemo(
    () =>
      er.filas.filter(
        (f) => f.kind === "cuenta" && !f.estructural && !hasBalance(f.valor.balanza)
      ).length,
    [er.filas]
  );

  /**
   * El filtro esconde SOLO renglones de cuenta en 0. Encabezados, subtotales y
   * resultados se quedan siempre: son la estructura del estado financiero, y los
   * totales tienen que ser identicos en las dos vistas.
   *
   * Los renglones `estructural` (la distribución a socias) tampoco se esconden
   * aunque den 0, o la sección quedaría con encabezado y nada debajo.
   */
  const filas = useMemo(() => {
    if (visibility === "all") return er.filas;
    return er.filas.filter(
      (f) => f.kind !== "cuenta" || f.estructural || hasBalance(f.valor.balanza)
    );
  }, [er.filas, visibility]);

  /** Un grupo que se quedó sin cuentas visibles: se avisa en vez de dejar el hueco. */
  const gruposVacios = useMemo(() => {
    const vacios = new Set<number>();
    filas.forEach((f, i) => {
      if (f.kind !== "grupo") return;
      const siguiente = filas[i + 1];
      if (!siguiente || siguiente.kind !== "cuenta") vacios.add(i);
    });
    return vacios;
  }, [filas]);

  return (
    <div className="space-y-3">
      <AccountVisibilityToggle
        value={visibility}
        onChange={setVisibility}
        zeroCount={zeroCount}
      />

      <StatementTable>
        {filas.map((f, i) => (
          <FilaConAviso
            key={`${f.kind}-${i}`}
            fila={f}
            vacio={gruposVacios.has(i)}
          />
        ))}
      </StatementTable>
    </div>
  );
}

function FilaConAviso({ fila, vacio }: { fila: FilaER; vacio: boolean }) {
  return (
    <>
      <Fila fila={fila} />
      {vacio && (
        <tr>
          <td colSpan={3} className="px-6 py-2 text-sm italic text-gray-400">
            {EMPTY_FILTERED}
          </td>
        </tr>
      )}
    </>
  );
}

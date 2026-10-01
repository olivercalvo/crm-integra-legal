/**
 * LAS LÍNEAS DE IMPUESTO DE UN ASIENTO, UNA POR CUENTA (Bloque 1, punto 6,
 * migración `073`). Módulo PURO.
 *
 * Josuarth (P-6a): "una cuenta por tasa, la misma para ventas y compras". Cada
 * tasa (`tax_codes.account_code`) dice a qué cuenta va su impuesto. Una factura
 * con ITBMS_7 y una tasa nueva con otra cuenta genera DOS líneas de impuesto,
 * una por cuenta; la NC, que invierte la factura, debita las mismas.
 *
 * La usan los constructores de factura y de compra (y por ellos la NC de venta
 * y la de compra). Es UNA implementación: si cada constructor agrupara por su
 * cuenta, algún día una NC acreditaría una cuenta distinta de la que se debitó.
 *
 * ⚠️ `CUENTA_IMPUESTO_SIN_TASA = 200003` NO es "la cuenta del ITBMS": es lo que
 * se usa para una línea con impuesto y SIN tasa (las anteriores a la `045`, que
 * no guardaban `tax_code_id`), que es exactamente a donde fueron siempre. En
 * staging no hay ninguna con impuesto; el loader manda la cuenta de la tasa.
 */

import type { LineaAsiento } from "@/lib/finanzas/contabilidad/posting";

export const CUENTA_IMPUESTO_SIN_TASA = "200003";

export interface ImpuestoDeLinea {
  tax_amount: number;
  /** `tax_codes.account_code` de la tasa de la línea (073). */
  tax_account?: string | null;
  /** `tax_codes.code`, para nombrar la línea cuando hay más de una cuenta. */
  tax_code?: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Agrupa el impuesto de las líneas por cuenta. Una cuenta sin monto no genera
 * línea. Con UNA sola cuenta la descripción es `base` (como siempre); con
 * varias, cada una dice qué tasas junta: «ITBMS facturado · ITBMS_7».
 */
export function lineasDeImpuesto(
  lineas: readonly ImpuestoDeLinea[],
  lado: "debit" | "credit",
  base: string
): LineaAsiento[] {
  const porCuenta = new Map<string, { monto: number; tasas: Set<string> }>();
  for (const l of lineas) {
    const monto = round2(l.tax_amount);
    if (monto === 0) continue;
    const cuenta = l.tax_account?.trim() || CUENTA_IMPUESTO_SIN_TASA;
    const g = porCuenta.get(cuenta) ?? { monto: 0, tasas: new Set<string>() };
    g.monto = round2(g.monto + monto);
    if (l.tax_code) g.tasas.add(l.tax_code);
    porCuenta.set(cuenta, g);
  }
  const varias = porCuenta.size > 1;
  return Array.from(porCuenta.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, g]) => g.monto !== 0)
    .map(([cuenta, g]) => ({
      account_code: cuenta,
      debit: lado === "debit" ? g.monto : 0,
      credit: lado === "credit" ? g.monto : 0,
      description: varias && g.tasas.size > 0 ? `${base} · ${Array.from(g.tasas).sort().join(", ")}` : base,
    }));
}

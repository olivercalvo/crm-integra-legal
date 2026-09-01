/**
 * Catálogo de impuestos (`tax_codes`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA TASA NO ES 7% POR DECRETO
 * ─────────────────────────────────────────────────────────────────────────────
 * Rose lo pidió en la reunión del 25/08/2026: el sistema se puede vender a
 * empresas de otros rubros, donde el ITBMS es 10% o 5%. Fijar 7% en el código
 * obliga a una migración el día que eso pase.
 *
 * La columna `tax_codes.rate` ya es `NUMERIC(6,4)`, así que soporta cualquier
 * tasa de 0 a 1 con cuatro decimales (0.0725 = 7.25%). Lo que faltaba era poder
 * cambiarla sin tocar el código: eso es `/finanzas/configuracion/impuestos`.
 *
 * ⚠️ CAMBIAR LA TASA NO REESCRIBE DOCUMENTOS YA EMITIDOS, y así tiene que ser.
 * `invoice_lines.tax_rate` y `quote_lines.tax_rate` guardan una COPIA de la tasa
 * vigente al crear la línea. Una factura emitida con 7% sigue diciendo 7% para
 * siempre, aunque el catálogo pase a 10% — es lo correcto desde lo contable y lo
 * fiscal: el documento refleja la ley del día en que se emitió. La tasa nueva
 * rige para lo que se cree de ahí en adelante.
 */

/** Fila de `tax_codes` tal como la devuelve el SELECT. */
export interface TaxCodeRow {
  id: string;
  code: string;
  name: string;
  /** DECIMAL [0, 1] con 4 decimales. 0.07 = 7%. */
  rate: number | string;
  active: boolean;
}

/** Lo que la pantalla de configuración puede cambiar. */
export interface UpdateTaxCodeInput {
  name?: string;
  rate?: number;
  active?: boolean;
}

/** Máximo de decimales que aguanta la columna `NUMERIC(6,4)`. */
export const TAX_RATE_DECIMALS = 4;

/** Cota superior: una tasa mayor a 1 casi siempre es "7" escrito por "0.07". */
export const TAX_RATE_MAX = 1;

/** `0.07` → `"7%"`. Sin ceros de relleno: 0.075 → "7.5%". */
export function formatTaxRate(rate: number | string): string {
  const pct = Number(rate) * 100;
  if (!Number.isFinite(pct)) return "—";
  return `${Number(pct.toFixed(2))}%`;
}

/**
 * Convierte lo que el usuario escribe en el campo de porcentaje a decimal.
 *
 * Acepta "7", "7.5", "7,5" y "0.075". El separador decimal con coma es normal en
 * Panamá y no tiene por qué fallar en silencio.
 */
export function parseTaxRatePercent(raw: string): number | null {
  const limpio = raw.trim().replace("%", "").replace(",", ".");
  if (limpio === "") return null;
  const pct = Number(limpio);
  if (!Number.isFinite(pct)) return null;
  return Number((pct / 100).toFixed(TAX_RATE_DECIMALS + 2));
}

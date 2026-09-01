/**
 * Validación del cambio de tasa de un código de impuesto.
 *
 * La regla dura es la cota: una tasa mayor a 1 es, casi siempre, alguien que
 * escribió "7" donde el sistema esperaba "0.07". Como la columna acepta hasta
 * 9.9999, sin este chequeo una factura saldría con 700% de impuesto y el error
 * recién se vería en el total.
 */
import {
  TAX_RATE_DECIMALS,
  TAX_RATE_MAX,
  type UpdateTaxCodeInput,
} from "@/lib/finanzas/types/tax-code";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string> };

export function validateUpdateTaxCode(input: unknown): ValidationResult<UpdateTaxCodeInput> {
  const errors: Record<string, string> = {};
  const body = (input ?? {}) as Record<string, unknown>;
  const data: UpdateTaxCodeInput = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2 || name.length > 60) {
      errors.name = "El nombre debe tener entre 2 y 60 caracteres.";
    } else {
      data.name = name;
    }
  }

  if (body.rate !== undefined) {
    const rate = Number(body.rate);
    if (!Number.isFinite(rate)) {
      errors.rate = "La tasa debe ser un número.";
    } else if (rate < 0) {
      errors.rate = "La tasa no puede ser negativa.";
    } else if (rate > TAX_RATE_MAX) {
      errors.rate =
        `La tasa no puede superar el 100%. Se escribe en decimal: 7% es 0.07, no 7.`;
    } else if (Number(rate.toFixed(TAX_RATE_DECIMALS)) !== rate) {
      errors.rate = `La tasa admite hasta ${TAX_RATE_DECIMALS} decimales (0.0725 = 7.25%).`;
    } else {
      data.rate = rate;
    }
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      errors.active = "El estado activo debe ser verdadero o falso.";
    } else {
      data.active = body.active;
    }
  }

  if (Object.keys(data).length === 0 && Object.keys(errors).length === 0) {
    errors.general = "No se recibió ningún cambio.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data };
}

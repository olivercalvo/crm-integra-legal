/**
 * Validación de los parámetros contables del bufete (078). Módulo PURO.
 *
 * 🔴 La tasa llega en FRACCIÓN (0.25), como en las tasas de impuesto: la
 * pantalla pide el PORCENTAJE y convierte con `parseTaxRatePercent`, mostrando
 * las dos. Un 25 que llegue acá es un error de unidad, no una tasa de 2500 %.
 */

export interface ParametrosInput {
  isr_rate: number;
}

export function validarParametros(
  raw: unknown
): { ok: true; data: ParametrosInput } | { ok: false; errors: Record<string, string> } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const rate = typeof b.isr_rate === "number" ? b.isr_rate : Number(b.isr_rate);
  if (b.isr_rate === undefined || b.isr_rate === null || b.isr_rate === "" || !Number.isFinite(rate)) {
    return { ok: false, errors: { isr_rate: "Indica la tasa del impuesto sobre la renta." } };
  }
  if (rate < 0 || rate > 1) {
    return {
      ok: false,
      errors: { isr_rate: "La tasa tiene que estar entre 0 % y 100 %." },
    };
  }
  // Cuatro decimales en fracción = dos en porcentaje (numeric(5,4) en la base).
  return { ok: true, data: { isr_rate: Math.round(rate * 10000) / 10000 } };
}

/**
 * Utilidades de formato numérico y de fechas para el mapper eFactura.
 *
 * - `round2`: redondeo a 2 decimales (montos USD).
 * - `taxRateKey`: convierte tax_rate decimal a la clave string de 4
 *   decimales que usa la tabla ITBMS_RATE_TO_CODE (evita comparar floats).
 * - `toPanamaIso`: serializa Date / 'YYYY-MM-DD' a ISO 8601 con offset
 *   fijo -05:00 (Panamá, sin DST).
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Devuelve la representación de 4 decimales (string) de una tasa decimal.
 * Útil como key en ITBMS_RATE_TO_CODE para evitar comparar floats.
 *
 * @example taxRateKey(0.07) === "0.0700"
 * @example taxRateKey(0)    === "0.0000"
 */
export function taxRateKey(rate: number): string {
  if (!Number.isFinite(rate)) {
    throw new Error(`taxRateKey: tasa inválida ${rate}`);
  }
  // Redondeo defensivo a 4 decimales antes de toFixed para evitar el
  // clásico 0.1 + 0.2 → 0.30000000000000004.
  const rounded = Math.round(rate * 10000) / 10000;
  return rounded.toFixed(4);
}

const PANAMA_OFFSET_MIN = -5 * 60;     // -05:00 en minutos
const PANAMA_OFFSET_MS = PANAMA_OFFSET_MIN * 60 * 1000;
const PANAMA_OFFSET_STR = "-05:00";

/**
 * Serializa una fecha a ISO 8601 con offset fijo -05:00 (timezone
 * América/Panamá, sin DST). Acepta:
 *
 *   - `Date` → toma el instante UTC y lo expresa como wall-clock Panamá.
 *   - string `'YYYY-MM-DD'` → 00:00:00 hora Panamá del mismo día.
 *   - string ISO 8601 con timezone → re-expresada en hora Panamá.
 *
 * @example
 *   toPanamaIso('2026-05-30')               // '2026-05-30T00:00:00-05:00'
 *   toPanamaIso(new Date('2026-05-30Z'))    // '2026-05-29T19:00:00-05:00'
 */
export function toPanamaIso(input: Date | string): string {
  let d: Date;

  if (typeof input === "string") {
    // 'YYYY-MM-DD' (10 chars) → tratarla como medianoche local Panamá,
    // no como UTC. Si la parseamos como ISO normal, Date la interpreta
    // como UTC y al rotar a Panamá baja un día.
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (dateOnlyMatch) {
      const [, y, m, day] = dateOnlyMatch;
      // Construyo el instante UTC que corresponde a 00:00 hora Panamá.
      // 00:00 -05:00 == 05:00 UTC.
      d = new Date(
        Date.UTC(Number(y), Number(m) - 1, Number(day), 5, 0, 0, 0)
      );
    } else {
      d = new Date(input);
    }
  } else {
    d = input;
  }

  if (Number.isNaN(d.getTime())) {
    throw new Error(`toPanamaIso: fecha inválida ${String(input)}`);
  }

  // wall-clock Panamá = instante UTC + offset (negativo → resta).
  const pan = new Date(d.getTime() + PANAMA_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${pan.getUTCFullYear()}-` +
    `${pad(pan.getUTCMonth() + 1)}-` +
    `${pad(pan.getUTCDate())}T` +
    `${pad(pan.getUTCHours())}:` +
    `${pad(pan.getUTCMinutes())}:` +
    `${pad(pan.getUTCSeconds())}` +
    PANAMA_OFFSET_STR
  );
}

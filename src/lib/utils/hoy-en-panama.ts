/**
 * HOY EN PANAMÁ, como fecha `YYYY-MM-DD`. El ÚNICO lugar donde se calcula.
 *
 * Hasta el Bloque 1 (E1) el módulo contable calculaba "hoy" con
 * `new Date().toISOString().slice(0, 10)`, que es el día en **UTC**. Panamá está
 * en UTC-5 todo el año (no tiene horario de verano), así que desde las 7 p. m.
 * hasta la medianoche el día UTC ya es **mañana**: una nota de crédito hecha el
 * 30/09 a las 20:00 quedaba fechada el 01/10, en otro período contable.
 *
 * Se resuelve con `Intl` y la zona `America/Panama`, no restando 5 horas a mano:
 * la zona es la fuente de verdad y el cálculo no depende de la zona del servidor
 * (Vercel corre en UTC) ni de la del navegador.
 *
 * Módulo PURO: sin I/O. Lo importan el servidor y los client components.
 * `ahora` entra por parámetro para que los tests no dependan del reloj.
 */

const FORMATO_PANAMA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Panama",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` del día calendario en Panamá en el instante `ahora`. */
export function hoyEnPanama(ahora: Date = new Date()): string {
  // `en-CA` formatea como AAAA-MM-DD. Se arma con las partes y no con el string
  // entero para no depender de cómo cada motor une las partes.
  const partes = FORMATO_PANAMA.formatToParts(ahora);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

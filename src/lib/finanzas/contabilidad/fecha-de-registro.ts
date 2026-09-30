/**
 * LA FECHA DE REGISTRO — la fecha contable de un documento o de una reversión.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ ES
 * ═════════════════════════════════════════════════════════════════════════════
 * Es la `transaction_date` del asiento: define el PERÍODO. En los documentos
 * vive en `accounting_date` (migración `068`). La otra fecha —la del
 * documento: `issue_date`, `expense_date`, `date`— es informativa: la que va a
 * la DGI, la base del vencimiento y de la ventana de 182 h.
 *
 * ⚠️ No confundir con `journal_entries.record_date`: esa es el sello de
 * GRABACIÓN (`current_date` del día en que se posteó) y no la elige nadie.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA REGLA (revisión de Josuarth del 28/09/2026 y reunión del 30/09/2026)
 * ═════════════════════════════════════════════════════════════════════════════
 * Reemplaza a la segunda frase del acta del 09/09 ("la reversión lleva SIEMPRE
 * la fecha en que se hace"):
 *   · El contador ELIGE la fecha de registro de documentos, notas, reversiones
 *     y anulaciones. La pantalla propone `hoyEnPanama()`.
 *   · Siempre en un período ABIERTO.
 *   · Una reversión nunca es anterior al asiento que revierte.
 *   · Fechas futuras: detrás de `PERMITIR_FECHA_DE_REGISTRO_FUTURA`, mientras
 *     Josuarth contesta (pregunta 5 / P-1c del plan).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUIÉN LO HACE CUMPLIR
 * ═════════════════════════════════════════════════════════════════════════════
 * El PERÍODO lo hace cumplir la base: `post_journal_entry` rechaza un mes
 * cerrado, y "no antes del original" lo rechaza cada RPC de reversión. Esta
 * validación NO los reemplaza: existe para contestar ANTES de tomar un
 * correlativo (la lección de FND-011 y de la cuenta inactiva: un 422 no quema
 * número) y con un mensaje en palabras. Si alguna vez discrepan, manda la base.
 *
 * Módulo PURO: sin I/O. La consulta del período está en
 * `api/fecha-de-registro.ts`.
 */

/**
 * 🟡 ¿Se admite una fecha de registro posterior a hoy (en un mes abierto)?
 *
 * Josuarth no contestó todavía (pregunta 5 de la lista del 30/09, P-1c del
 * plan). Mientras tanto se permite. Es la ÚNICA llave: la base no mira el
 * futuro, así que cambiar esto a `false` basta para prohibirlas.
 */
export const PERMITIR_FECHA_DE_REGISTRO_FUTURA = true;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** `true` si es una fecha calendario real en formato `YYYY-MM-DD`. */
export function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** El período de una fecha, como lo muestra la pantalla de Períodos: `AAAA-MM`. */
export function periodoDe(fecha: string): { year: number; month: number; etiqueta: string } {
  const [y, m] = fecha.split("-").map(Number);
  return { year: y, month: m, etiqueta: `${y}-${String(m).padStart(2, "0")}` };
}

/** `DD/MM/AAAA`, para los mensajes. */
function dmy(fecha: string): string {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

export interface ReglaFechaDeRegistro {
  /** La fecha pedida. */
  fecha: unknown;
  /** Hoy en Panamá (`hoyEnPanama()`), por parámetro para no depender del reloj. */
  hoy: string;
  /** `true` si el período de `fecha` está cerrado. Lo averigua quien llama. */
  periodoCerrado: boolean;
  /** Para una reversión: el asiento que revierte. La fecha no puede ser anterior. */
  noAntesDe?: { fecha: string; etiqueta: string } | null;
  /** Qué se está registrando, para el mensaje ("la reversión", "la nota de crédito"). */
  que?: string;
}

/**
 * `null` si la fecha de registro se admite; si no, el mensaje para el usuario.
 * El orden de las reglas es el de la pantalla: formato → futuro → original →
 * período (el período es lo último porque es lo único que se arregla en otra
 * pantalla).
 */
export function errorDeFechaDeRegistro(r: ReglaFechaDeRegistro): string | null {
  const que = r.que ?? "el registro";
  if (!esFechaIso(r.fecha)) {
    return "La fecha de registro no es una fecha válida (AAAA-MM-DD).";
  }
  const fecha = r.fecha;
  if (!PERMITIR_FECHA_DE_REGISTRO_FUTURA && fecha > r.hoy) {
    return `La fecha de registro (${dmy(fecha)}) no puede ser posterior a hoy (${dmy(r.hoy)}).`;
  }
  if (r.noAntesDe && fecha < r.noAntesDe.fecha) {
    return (
      `La fecha de registro de ${que} (${dmy(fecha)}) no puede ser anterior a la de ` +
      `${r.noAntesDe.etiqueta} (${dmy(r.noAntesDe.fecha)}).`
    );
  }
  if (r.periodoCerrado) {
    return (
      `El período ${periodoDe(fecha).etiqueta} está cerrado: elige una fecha de registro ` +
      `en un mes abierto, o pide que se reabra en Períodos Contables.`
    );
  }
  return null;
}

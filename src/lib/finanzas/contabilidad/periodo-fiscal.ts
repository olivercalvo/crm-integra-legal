/**
 * Reglas del PERÍODO FISCAL de Integra.
 *
 * Fuente: respuesta de Rose (RM Consultores), agosto 2026 —
 *
 *   "el período fiscal va del 1 de enero al 31 de diciembre, y el 1 de enero de
 *    cada año las únicas cuentas que inician con saldos son las que pertenecen
 *    al estado de situación financiera"
 *
 * O sea: las cuentas de BALANCE (activo, pasivo, patrimonio) arrastran saldo de
 * un año al siguiente; las de RESULTADO (ingreso, costo, gasto) arrancan en cero
 * cada 1 de enero, porque el resultado del año anterior ya se cerró contra el
 * patrimonio.
 *
 * Módulo PURO: sin I/O, sin React. Lo usan hoy el saldo inicial (Fase 1) y lo va
 * a usar el sembrado de `accounting_periods` en la Fase 2 — por eso las reglas
 * viven acá y no sueltas en un componente.
 *
 * ⚠️ LO QUE HAY CARGADO HOY NO ES UNA APERTURA AL 1 DE ENERO.
 * Ver `docs/finanzas/roadmap-contable.md` y la consulta pendiente al contador:
 * los saldos actuales son una FOTO DE MITAD DE AÑO (las cuentas de resultado
 * traen movimiento de enero a agosto de 2026 y el patrimonio está en cero). Un
 * asiento de apertura al 1 de enero requiere que el resultado del año anterior
 * ya esté cerrado contra el patrimonio, y eso todavía no está.
 */

/** Mes de inicio del período fiscal (1 = enero). */
export const MES_INICIO_PERIODO = 1;

/** Día de inicio del período fiscal. */
export const DIA_INICIO_PERIODO = 1;

/** Formatea un año como la fecha de inicio de su período fiscal (ISO, YYYY-MM-DD). */
export function inicioPeriodoFiscal(anio: number): string {
  const mm = String(MES_INICIO_PERIODO).padStart(2, "0");
  const dd = String(DIA_INICIO_PERIODO).padStart(2, "0");
  return `${anio}-${mm}-${dd}`;
}

/** Fecha de cierre del período fiscal de ese año (ISO). */
export function cierrePeriodoFiscal(anio: number): string {
  // El período va del 1 de enero al 31 de diciembre: el cierre es el día
  // anterior al inicio del período siguiente. Se calcula así, en vez de
  // hardcodear "12-31", para que cambiar MES/DIA_INICIO_PERIODO no deje el
  // cierre desincronizado.
  const inicioSiguiente = new Date(`${inicioPeriodoFiscal(anio + 1)}T00:00:00Z`);
  inicioSiguiente.setUTCDate(inicioSiguiente.getUTCDate() - 1);
  return inicioSiguiente.toISOString().slice(0, 10);
}

/** El año fiscal al que pertenece una fecha ISO (YYYY-MM-DD). */
export function anioFiscalDe(fechaISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!m) return null;
  const [, y, mes, dia] = m;
  const anio = Number(y);
  // Con período de año calendario esto es directo. Se escribe igual con la
  // comparación explícita para que un período fiscal desfasado (ej. julio a
  // junio) solo requiera cambiar las dos constantes de arriba.
  const antesDelInicio =
    Number(mes) < MES_INICIO_PERIODO ||
    (Number(mes) === MES_INICIO_PERIODO && Number(dia) < DIA_INICIO_PERIODO);
  return antesDelInicio ? anio - 1 : anio;
}

/** true si una cadena es una fecha ISO válida (YYYY-MM-DD) y existe en el calendario. */
export function esFechaISOValida(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Rechaza fechas que el constructor "corrige" solo (2026-02-30 → 2026-03-02).
  return d.toISOString().slice(0, 10) === v;
}

/**
 * Rango aceptable para una fecha de saldo inicial.
 *
 * El piso corta errores de tipeo con siglos raros; el techo lo pone el año
 * siguiente al de la fecha que se pase como "hoy" — cargar un saldo de apertura
 * con fecha muy futura casi siempre es un dedazo, no una intención.
 */
export const ANIO_MINIMO_SALDO_INICIAL = 2000;

export function anioMaximoSaldoInicial(hoy: Date): number {
  return hoy.getUTCFullYear() + 1;
}

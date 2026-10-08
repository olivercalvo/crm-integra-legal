/**
 * ANTIGÜEDAD A UNA FECHA DE CORTE (requerimiento 41, 08/10/2026). Módulo PURO.
 *
 * El reporte responde «¿cuánto me debía cada cliente (o le debía yo a cada
 * proveedor) AL dd/mm/aaaa, y con cuántos días de atraso?». Para eso no sirve
 * `balance_due`, que es el saldo de HOY: el saldo de cada documento se
 * reconstruye a la fecha de corte con su HISTORIA.
 *
 * - El documento existe desde su fecha de REGISTRO (`accounting_date`, o la del
 *   documento si no tiene): es la fecha del asiento, así que el auxiliar al
 *   corte se compara contra la cuenta control al corte sin desfase.
 * - Cada baja (cobro o pago aplicado, nota de crédito, saldo a favor aplicado)
 *   resta desde SU fecha. Si después se reversó, deja de restar desde la fecha
 *   de registro de la reversión (`hasta`): al corte anterior, sí restaba.
 * - Una factura anulada (o un gasto de trámite reversado) deja de existir desde
 *   la fecha de la anulación (`finEn`); antes era una cuenta por cobrar.
 * - Los días de atraso se cuentan contra la fecha de corte, no contra hoy.
 *
 * Con el corte en HOY da lo mismo que `balance_due`: ninguna fecha de registro
 * es posterior a hoy (K-5). Hay un test que lo exige.
 */

export interface Baja {
  /** Desde cuándo resta (`YYYY-MM-DD`, inclusive). */
  fecha: string;
  monto: number;
  /** Fecha de registro de la reversión: desde ese día ya no resta. */
  hasta?: string | null;
}

export interface HistoriaDeSaldo {
  /** Fecha de registro del documento (`YYYY-MM-DD`). Antes de eso no existe. */
  desde: string;
  total: number;
  bajas: Baja[];
  /** Anulado o reversado desde esa fecha: al corte posterior ya no está. */
  finEn?: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** ¿La baja restaba al corte? Desde su fecha, y hasta el día de su reversión (exclusive). */
export function vigenteAlCorte(desde: string, hasta: string | null | undefined, corte: string): boolean {
  return desde <= corte && !(hasta && hasta <= corte);
}

/**
 * El saldo del documento AL CORTE, o `null` si al corte no existía todavía o
 * ya estaba anulado. Puede dar 0 (pagado al corte): quien llama decide.
 */
export function saldoAlCorte(h: HistoriaDeSaldo, corte: string): number | null {
  if (h.desde > corte) return null;
  if (h.finEn && h.finEn <= corte) return null;
  let saldo = h.total;
  for (const b of h.bajas) if (vigenteAlCorte(b.fecha, b.hasta, corte)) saldo -= b.monto;
  return round2(saldo);
}

/**
 * Días entre `fecha` y el corte (positivo = ya pasó). Las dos son fechas sin
 * hora, así que se restan en UTC: no depende de la zona del servidor.
 */
export function diasAlCorte(fecha: string, corte: string): number {
  const a = Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${corte.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** `YYYY-MM-DD` válido, o null. Para el parámetro `?al=` de la pantalla y del Excel. */
export function fechaDeCorte(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? v : null;
}

/**
 * La fecha de una aplicación que se hizo DESPUÉS del cobro («Aplicar saldo a
 * favor»): la del día en que se aplicó, nunca antes que el cobro. Una aplicación
 * grabada junto con el cobro (dentro de los 10 minutos) lleva la del cobro.
 */
export function fechaDeAplicacion(
  fechaDelCobro: string,
  cobroGrabadoEl: string | null,
  aplicadaEl: string | null,
  diaEnPanama: (d: Date) => string
): string {
  if (!aplicadaEl) return fechaDelCobro;
  const t = Date.parse(aplicadaEl);
  if (cobroGrabadoEl && Math.abs(t - Date.parse(cobroGrabadoEl)) <= 10 * 60_000) return fechaDelCobro;
  const dia = diaEnPanama(new Date(t));
  return dia > fechaDelCobro ? dia : fechaDelCobro;
}

/**
 * Reparto de un cobro entre varias facturas, de la más vieja a la más nueva
 * (Parte B del Bloque 2, 21/09/2026).
 *
 * Es lo que hace una persona con lápiz y lo que hace QuickBooks: paga primero
 * lo más viejo. El caso típico —el cliente manda la suma exacta de dos o tres
 * facturas— sale con cero tecleo; la excepción ("esta transferencia es de la
 * de julio, no de la de mayo") se corrige a mano fila por fila, y
 * `validarReparto` dice si lo corregido cierra.
 *
 * Módulo PURO, sin React ni base: lo usan el alta de `/finanzas/cobros/nuevo`
 * y los tests. El servidor NO reparte: recibe las aplicaciones ya decididas y
 * las valida (`validators/payment.ts`) — la autoridad sigue allá.
 *
 * Orden: `issue_date` ascendente y, a igual fecha, `invoice_number` ascendente
 * (el correlativo es el orden en que se emitieron).
 */

export interface FacturaARepartir {
  id: string;
  invoice_number: string;
  issue_date: string; // YYYY-MM-DD
  balance_due: number;
}

export interface Reparto {
  invoice_id: string;
  amount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** De la más vieja a la más nueva. No muta la entrada. */
export function ordenarPorAntiguedad<T extends FacturaARepartir>(facturas: T[]): T[] {
  return [...facturas].sort((a, b) => {
    if (a.issue_date !== b.issue_date) return a.issue_date < b.issue_date ? -1 : 1;
    return a.invoice_number < b.invoice_number ? -1 : a.invoice_number > b.invoice_number ? 1 : 0;
  });
}

/**
 * Llena cada saldo hasta agotar `total`, en orden de antigüedad. Devuelve UNA
 * entrada por factura seleccionada, con 0 en las que no alcanzó (la pantalla
 * las muestra en 0 para que se vea qué quedó afuera; `aplicacionesParaEnviar`
 * las saca antes de mandar, porque el CHECK de la tabla prohíbe montos en 0).
 *
 * Si `total` supera la suma de los saldos, el resto NO se reparte: queda como
 * diferencia y `validarReparto` lo rechaza con el mensaje del excedente.
 */
export function repartirPorAntiguedad(total: number, facturas: FacturaARepartir[]): Reparto[] {
  let resto = round2(Math.max(0, total));
  return ordenarPorAntiguedad(facturas).map((f) => {
    const saldo = round2(Math.max(0, f.balance_due));
    const aplicar = round2(Math.min(saldo, resto));
    resto = round2(resto - aplicar);
    return { invoice_id: f.id, amount: aplicar };
  });
}

export function sumaAplicada(reparto: Reparto[]): number {
  return round2(reparto.reduce((acc, r) => acc + (isFinite(r.amount) ? r.amount : 0), 0));
}

export interface ResultadoReparto {
  ok: boolean;
  aplicado: number;
  /** total − aplicado. > 0 excedente, < 0 sobra aplicado. */
  diferencia: number;
  /** Mensaje para la pantalla, en lenguaje de contador (SOP-027). Null si cierra. */
  mensaje: string | null;
  /** Errores por factura (monto > saldo). */
  porFactura: Record<string, string>;
}

function fmt(n: number): string {
  return `B/. ${round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * ¿El reparto cierra contra el total? Misma regla que el servidor: cada monto
 * ≤ saldo, y la suma == total. El mensaje del excedente es el acordado con
 * Oliver el 21/09: los dos montos, la diferencia y la salida.
 */
export function validarReparto(
  total: number,
  reparto: Reparto[],
  facturas: FacturaARepartir[]
): ResultadoReparto {
  const porFactura: Record<string, string> = {};
  const saldos = new Map(facturas.map((f) => [f.id, f]));
  for (const r of reparto) {
    const f = saldos.get(r.invoice_id);
    if (!f) continue;
    if (!isFinite(r.amount) || r.amount < 0) {
      porFactura[r.invoice_id] = "Monto inválido";
    } else if (r.amount > round2(f.balance_due) + 0.001) {
      porFactura[r.invoice_id] = `Supera el saldo de ${f.invoice_number} (${fmt(f.balance_due)})`;
    }
  }

  const aplicado = sumaAplicada(reparto);
  const diferencia = round2(total - aplicado);
  let mensaje: string | null = null;
  if (Object.keys(porFactura).length > 0) {
    mensaje = "Hay montos que superan el saldo de su factura.";
  } else if (aplicado <= 0) {
    mensaje = "Aplique el cobro a por lo menos una factura.";
  } else if (diferencia > 0.005) {
    mensaje =
      `La transferencia es de ${fmt(total)} y las facturas seleccionadas suman ${fmt(aplicado)}. ` +
      `Un recibo tiene que coincidir con la transferencia para que el banco concilie. ` +
      `Seleccione otra factura pendiente del mismo cliente por el resto (${fmt(diferencia)}) o ajuste el monto.`;
  } else if (diferencia < -0.005) {
    mensaje =
      `El monto del recibo es ${fmt(total)} pero lo aplicado a las facturas suma ${fmt(aplicado)}: ` +
      `sobran ${fmt(-diferencia)} aplicados. Baje lo aplicado o suba el monto del recibo.`;
  }

  return { ok: mensaje === null, aplicado, diferencia, mensaje, porFactura };
}

/** Lo que va al servidor: sin las filas en 0. */
export function aplicacionesParaEnviar(reparto: Reparto[]): Reparto[] {
  return reparto.filter((r) => isFinite(r.amount) && r.amount > 0).map((r) => ({ ...r, amount: round2(r.amount) }));
}

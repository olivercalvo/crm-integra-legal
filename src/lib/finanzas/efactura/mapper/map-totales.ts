/**
 * Construye el bloque `totales` (GTotRequest) desde la cabecera + líneas
 * del CRM.
 *
 * Reglas confirmadas (D2):
 *   - tiempoPago: 1 (contado) si due_date == issue_date, 2 (crédito) si
 *     due_date > issue_date.
 *   - grupoFormasPago: una sola entrada con formaPago=defaultFormaPago y
 *     valorCuotaPagada=grand_total.
 *   - grupoInformacionPago: solo si crédito → una cuota única con
 *     fechaVencimientoCuota=due_date (ISO -05:00).
 *
 * Subtotales:
 *   - totalNeto: suma de subtotales por línea (sin impuestos).
 *   - totalITBMS: suma de tax_amount por línea.
 *   - totalGrabado / totalGravado: suma de subtotales de líneas con
 *     tax_rate > 0 (la parte gravada con ITBMS). Si todo exento → 0.
 *     OJO: el campo que la DGI valida es `totalGrabado` (con el misspelling
 *     oficial "Grabado"); `totalGravado` (bien escrito) es un alias nullable
 *     que la DGI ignora. Enviamos AMBOS con el mismo valor.
 *   - totalTodosItems: suma de subtotales NETOS por línea (dVTotItems debe
 *     cuadrar con dTotNeto; NO incluye ITBMS).
 *   - valorTotalFactura: grand_total (= totalNeto + totalITBMS).
 *   - numeroTotalItems: cantidad de líneas.
 *   - sumaValoresRecibidos: grand_total (sin vuelto en este flujo).
 */

import type { Totales, FormaPago, PagoPlazo } from "@/lib/finanzas/efactura/types";
import { TIEMPO_PAGO } from "@/lib/finanzas/efactura/types";
import type {
  EfacturaBundleInvoice,
  EfacturaBundleLine,
} from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";
import { round2, toPanamaIso } from "./format-decimals";

export interface MapTotalesContext {
  defaultFormaPago: string;
}

export function mapTotales(
  invoice: EfacturaBundleInvoice,
  lines: EfacturaBundleLine[],
  ctx: MapTotalesContext
): Totales {
  const totalNeto = round2(
    lines.reduce((acc, ln) => acc + ln.subtotal, 0)
  );
  const totalITBMS = round2(
    lines.reduce((acc, ln) => acc + ln.tax_amount, 0)
  );
  const totalGravado = round2(
    lines
      .filter((ln) => ln.tax_rate > 0)
      .reduce((acc, ln) => acc + ln.subtotal, 0)
  );
  const totalTodosItems = round2(
    lines.reduce((acc, ln) => acc + ln.subtotal, 0)
  );
  const valorTotalFactura = round2(invoice.grand_total);
  const isCredito = invoice.due_date > invoice.issue_date;
  const tiempoPago = isCredito ? TIEMPO_PAGO.CREDITO : TIEMPO_PAGO.CONTADO;

  const formasPago: FormaPago[] = [
    {
      formaPago: ctx.defaultFormaPago,
      valorCuotaPagada: valorTotalFactura,
    },
  ];

  const totales: Totales = {
    tiempoPago,
    grupoFormasPago: formasPago,
    totalNeto,
    totalITBMS,
    // La DGI valida `totalGrabado` (misspelling oficial); `totalGravado` es
    // alias nullable ignorado. Enviamos ambos con el mismo valor.
    totalGrabado: totalGravado,
    totalGravado,
    valorTotalFactura,
    sumaValoresRecibidos: valorTotalFactura,
    numeroTotalItems: lines.length,
    totalTodosItems,
  };

  if (isCredito) {
    const cuota: PagoPlazo = {
      numeroSecuenciaCuota: 1,
      fechaVencimientoCuota: toPanamaIso(invoice.due_date),
      valorCuota: valorTotalFactura,
    };
    totales.grupoInformacionPago = [cuota];
  }

  return totales;
}

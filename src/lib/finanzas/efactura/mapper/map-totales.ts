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
 *   - totalNeto (D02 = dTotNeto): suma de subtotales por línea (sin impuestos).
 *   - totalITBMS (D03 = dTotITBMS): suma de tax_amount por línea.
 *   - totalGravado / totalGrabado (D05 = dTotGravado): CONTRAINTUITIVO. Según
 *     la Ficha Técnica DGI V1.00 (§6.6 diccionario de campos y §8.4.4 regla
 *     2503), "monto gravado" NO es la base imponible: es la SUMA DE IMPUESTOS
 *     aplicados = dTotITBMS + dTotISC + dTotOTI (D03 + D04 + D602). Por eso
 *     `totalGravado = round2(totalITBMS + totalISC + totalOTI)`. Hoy no
 *     manejamos ISC ni OTI, así que ambos son 0 y en la práctica queda
 *     = totalITBMS, pero la estructura ya suma los tres. Enviamos el valor
 *     bajo ambas claves (`totalGravado` bien escrito, que es el que el PAC
 *     mapea a dTotGravado, y `totalGrabado` con el misspelling por defensa).
 *   - totalTodosItems (D14 = dVTotItems): suma de dValTotItem NETOS por línea.
 *   - valorTotalFactura (D09 = dVTot): grand_total. Cuadre DGI regla 2507:
 *     dVTot = dTotGravado − dTotDesc + dTotAcar + dTotSeg + dTotNeto.
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
  // ISC y OTI (otras tasas/impuestos) no se manejan en este flujo hoy → 0.
  // Se dejan explícitos para que el cálculo de dTotGravado sume los tres
  // componentes cuando existan (D03 + D04 + D602).
  const totalISC = 0;
  const totalOTI = 0;
  // dTotGravado (D05) = SUMA DE IMPUESTOS, no la base imponible. Ver Ficha
  // Técnica DGI §8.4.4 regla 2503: D05 <> D03 + D04 + D602. En este caso
  // (sin ISC ni OTI) queda = totalITBMS.
  const totalGravado = round2(totalITBMS + totalISC + totalOTI);
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
    // dTotGravado = suma de impuestos (ver cálculo arriba). El PAC mapea
    // `totalGravado` (bien escrito) → dTotGravado; `totalGrabado` es un alias
    // defensivo con el misspelling. Enviamos ambos con el mismo valor.
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

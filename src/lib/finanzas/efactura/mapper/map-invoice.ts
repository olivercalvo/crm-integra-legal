/**
 * Mapper público: bundle del CRM + config del emisor → InvoiceRequest del PAC.
 *
 * Función PURA, sin I/O. El allocate de (puntoFacturacion, numeroDocumento)
 * desde fe_secuencias vive afuera (sprint propio cuando confirmemos la
 * política de quemado de correlativo con el PAC).
 *
 * Defaults estructurales (D6) vienen de EmisorConfig.default*. La fecha de
 * emisión se serializa con offset fijo -05:00 (D7).
 */

import type {
  DatosGenerales,
  InvoiceRequest,
} from "@/lib/finanzas/efactura/types";
import { TIPO_DOCUMENTO, TIPO_EMISION } from "@/lib/finanzas/efactura/types";
import type { EmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import type { InvoiceEfacturaBundle } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";
import { mapEmisor } from "./map-emisor";
import { mapReceptor } from "./map-receptor";
import { mapItem } from "./map-item";
import { mapTotales } from "./map-totales";
import { toPanamaIso } from "./format-decimals";

export interface MapInvoiceOptions {
  /** Ambiente PAC (informativo — no se envía en InvoiceRequest, queda para el transport). */
  iAmb?: 1 | 2;
  /** '01' normal | '02' contingencia. Default '01'. */
  tipoEmision?: "01" | "02";
  /**
   * Fecha de emisión. Default `new Date()`. Acepta `Date` (instante UTC)
   * o string `'YYYY-MM-DD'` que se interpreta como medianoche Panamá.
   */
  fechaEmision?: Date | string;
  /** Override del tipoDocumento. Default '01' (factura operación interna). */
  tipoDocumento?: string;
}

export interface MapInvoiceParams {
  bundle: InvoiceEfacturaBundle;
  emisor: EmisorConfig;
  /** Asignado por la pieza que consume fe_secuencias afuera del mapper. */
  sequence: {
    puntoFacturacion: string;
    numeroDocumento: number;
  };
  options?: MapInvoiceOptions;
}

export function mapInvoiceToEfacturaRequest(
  params: MapInvoiceParams
): InvoiceRequest {
  const { bundle, emisor, sequence, options } = params;
  const { invoice, client, lines } = bundle;

  if (lines.length === 0) {
    throw new Error(
      `[efactura/mapper] La factura ${invoice.invoice_number} no tiene líneas. ` +
        `No se puede emitir una factura sin items.`
    );
  }

  const informacionEmisor = mapEmisor(emisor);
  const informacionReceptor = mapReceptor(client);

  const listaItems = lines.map((ln) =>
    mapItem(ln, {
      invoiceKind: invoice.invoice_kind,
      cpbsHon: emisor.cpbsServiciosLegalesHon,
      cpbsRei: emisor.cpbsServiciosLegalesRei,
    })
  );

  const totales = mapTotales(invoice, lines, {
    defaultFormaPago: emisor.defaultFormaPago,
  });

  const fechaEmisionInput = options?.fechaEmision ?? new Date();
  const fechaEmision = toPanamaIso(fechaEmisionInput);

  const datosGenerales: DatosGenerales = {
    tipoEmision: options?.tipoEmision ?? TIPO_EMISION.NORMAL,
    tipoDocumento:
      options?.tipoDocumento ?? TIPO_DOCUMENTO.FACTURA_OPERACION_INTERNA,
    numeroDocumento: sequence.numeroDocumento,
    puntoFacturacion: sequence.puntoFacturacion,
    fechaEmision,
    tipoOperacion: emisor.defaultTipoOperacion,
    destinoOperacion: emisor.defaultDestinoOperacion,
    formatoGeneracionCafe: emisor.defaultFormatoGeneracionCafe,
    maneraEntregaCafe: emisor.defaultManeraEntregaCafe,
    envioContenedorReceptor: emisor.defaultEnvioContenedorReceptor,
    procesoGeneracionFe: emisor.defaultProcesoGeneracionFe,
    tipoTransaccionVenta: emisor.defaultTipoTransaccionVenta,
    tipoSucursal: emisor.defaultTipoSucursal,
    informacionEmisor,
    informacionReceptor,
  };

  return {
    datosGenerales,
    listaItems,
    totales,
  };
}

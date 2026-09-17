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
import type { TipoDocumento } from "@/lib/finanzas/efactura/types";
import type { EmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import type { InvoiceEfacturaBundle } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";
import type { InvoiceKind } from "@/lib/finanzas/types/invoice";
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
  /**
   * Override del tipoDocumento. Sin él se deriva de `invoice.invoice_kind`
   * con `tipoDocumentoDeKind()`. Reservado para notas de crédito/débito, que
   * no son un `invoice_kind`.
   */
  tipoDocumento?: TipoDocumento;
}

/**
 * El tipo de documento DGI que corresponde a cada tipo de factura del CRM.
 *
 *   HONORARIOS → "01" Factura de operación interna
 *   REEMBOLSO  → "09" Factura de reembolso
 *
 * Hasta el 17/09/2026 TODO salía como "01", incluidas las FAC-REI-*: 34
 * facturas de reembolso llegaron a la DGI como operación interna. Josuarth
 * decidió que NO se corrigen (ideati dice que técnicamente sería nota de
 * crédito + reemisión) porque el ITBMS y la DJR se presentaron bien.
 *
 * Es una función y no un mapa suelto para que el `switch` exhaustivo falle en
 * compilación el día que aparezca un tercer `invoice_kind`.
 */
export function tipoDocumentoDeKind(kind: InvoiceKind): TipoDocumento {
  switch (kind) {
    case "HONORARIOS":
      return TIPO_DOCUMENTO.FACTURA_OPERACION_INTERNA;
    case "REEMBOLSO":
      return TIPO_DOCUMENTO.FACTURA_REEMBOLSO;
    default: {
      const nunca: never = kind;
      throw new Error(`[efactura/mapper] invoice_kind desconocido: ${String(nunca)}`);
    }
  }
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
      options?.tipoDocumento ?? tipoDocumentoDeKind(invoice.invoice_kind),
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

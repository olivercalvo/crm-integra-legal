/**
 * Construye un `Item` (GItemRequest) desde una línea del CRM.
 *
 * Reglas confirmadas:
 *   - D1 (ITBMS): tasaITBMSAplicable se deriva con ITBMS_RATE_TO_CODE.
 *     Si la tasa no está en la tabla → error explícito.
 *   - montoITBMS = tax_amount de la línea.
 *   - numeroSecuenciaItem = line_order + 1 (BD es 0-indexed).
 *   - codigoItemCodificacionPanamena = cpbs HON o REI según invoice_kind
 *     (configurado en EmisorConfig, validado != 0 en el loader).
 */

import type { Item } from "@/lib/finanzas/efactura/types";
import { ITBMS_RATE_TO_CODE } from "@/lib/finanzas/efactura/types";
import type { EfacturaBundleLine } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";
import type { InvoiceKind } from "@/lib/finanzas/types/invoice";
import { round2, taxRateKey } from "./format-decimals";

export interface MapItemContext {
  invoiceKind: InvoiceKind;
  cpbsHon: number;
  cpbsRei: number;
}

export function mapItem(
  line: EfacturaBundleLine,
  ctx: MapItemContext
): Item {
  const key = taxRateKey(line.tax_rate);
  const tasaITBMSAplicable = (
    ITBMS_RATE_TO_CODE as Record<string, string>
  )[key];

  if (!tasaITBMSAplicable) {
    throw new Error(
      `[efactura/mapper] Tasa ITBMS desconocida ${line.tax_rate} ` +
        `(key=${key}) en línea ${line.line_order + 1} "${line.description}". ` +
        `Soportadas: ${Object.keys(ITBMS_RATE_TO_CODE).join(", ")}.`
    );
  }

  const cpbs =
    ctx.invoiceKind === "HONORARIOS" ? ctx.cpbsHon : ctx.cpbsRei;

  const cantidad = round2(line.quantity);
  const precioUnitario = round2(line.unit_price);
  const subtotal = round2(line.subtotal);
  const taxAmount = round2(line.tax_amount);

  return {
    numeroSecuenciaItem: line.line_order + 1,
    descripcionProductoServicio: line.description,
    cantidadProductoServicio: cantidad,
    codigoItemCodificacionPanamena: cpbs,
    grupoPrecios: {
      precioUnitarioTransferencia: precioUnitario,
      // dPrItem (C203): precio del item NETO (sin impuestos).
      precioItem: subtotal,
      // dValTotItem (sumaPrecioItem, C206): BRUTO. Ficha Técnica DGI §6.5.1
      // lo define como "suma del precio del item con los montos de los
      // impuestos", y §8.4.3.1 regla 2056 exige:
      //   C206 = C203 (precioItem) + C204 (acarreo) + C205 (seguro)
      //          + C402 (ITBMS) + C502 (ISC) + C602 (OTI)
      // Sin acarreo/seguro/ISC/OTI en este flujo → = subtotal + tax_amount.
      sumaPrecioItem: round2(subtotal + taxAmount),
    },
    grupoITBMS: {
      tasaITBMSAplicable,
      montoITBMS: taxAmount,
    },
  };
}

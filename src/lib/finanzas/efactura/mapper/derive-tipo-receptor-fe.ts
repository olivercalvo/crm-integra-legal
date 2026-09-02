/**
 * Derivación de `tipoReceptorFe` cuando el cliente no lo tiene cargado
 * explícitamente (clients.tipo_receptor_fe IS NULL).
 *
 * Tabla confirmada (D3):
 *   - tax_id_type='ruc'                                    → '01'
 *   - tax_id_type='cedula' | 'pasaporte'                   → '02'
 *   - tax_id_type='extranjero' o id_extranjero presente    → '04'
 *   - Sin match                                            → error
 *
 * '03' (gobierno) NUNCA se infiere — requiere captura manual en clients.
 */

import { TIPO_RECEPTOR_FE, type TipoReceptorFe } from "@/lib/finanzas/efactura/types";
import type { EfacturaBundleClient } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";

export function deriveTipoReceptorFe(
  client: EfacturaBundleClient
): TipoReceptorFe {
  // 1. Valor explícito en BD gana siempre (Fase 1A).
  if (client.tipo_receptor_fe) {
    return client.tipo_receptor_fe as TipoReceptorFe;
  }

  // 2. Extranjero gana sobre tax_id_type panameño (el campo
  // id_extranjero solo se llena para receptores no-residentes).
  if (client.id_extranjero || client.tax_id_type === "extranjero") {
    return TIPO_RECEPTOR_FE.EXTRANJERO;
  }

  // 3. Por tipo de documento de identidad.
  switch (client.tax_id_type) {
    case "ruc":
      return TIPO_RECEPTOR_FE.CONTRIBUYENTE;
    case "cedula":
    case "pasaporte":
      return TIPO_RECEPTOR_FE.CONSUMIDOR_FINAL;
    default:
      // El mensaje llega a la pantalla de la abogada cuando falla una emisión,
      // así que nombra el CAMPO DE LA FICHA que hay que completar, no la columna
      // de la base. Decirle "cargá clients.tipo_receptor_fe" a quien está
      // tratando de facturar no le dice dónde hacer clic.
      throw new Error(
        `No se puede determinar el tipo de receptor del cliente ` +
          `${client.client_number} "${client.name}": su documento de identidad no permite ` +
          `deducirlo. Abra la ficha del cliente y complete el campo ` +
          `"Tipo de receptor FE" antes de emitir.`
      );
  }
}

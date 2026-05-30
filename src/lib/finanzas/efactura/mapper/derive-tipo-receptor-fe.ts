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
      throw new Error(
        `[efactura/mapper] No se puede derivar tipoReceptorFe del cliente ` +
          `${client.client_number} "${client.name}" (tax_id_type=${client.tax_id_type ?? "null"}). ` +
          `Cargá clients.tipo_receptor_fe manualmente.`
      );
  }
}

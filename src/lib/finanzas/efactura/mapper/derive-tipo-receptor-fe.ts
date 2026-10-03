/**
 * Derivación de `tipoReceptorFe` cuando el cliente no lo tiene cargado
 * explícitamente (clients.tipo_receptor_fe IS NULL).
 *
 * Tabla confirmada (D3):
 *   - tax_id_type='ruc'                                    → '01'
 *   - tax_id_type='cedula' | 'pasaporte'                   → '02'
 *   - tax_id_type='extranjero' o id_extranjero presente    → '04'
 *   - Sin tipo de documento (03/10/2026, caso CLI-036 de producción: persona
 *     natural, sin tipo de receptor y sin DV, con una factura ya autorizada):
 *       persona_juridica                                   → '01'
 *       persona_natural CON dígito verificador             → '01'
 *       persona_natural SIN dígito verificador             → '02' (la DGI acepta
 *                                                             la cédula del consumidor final)
 *   - Sin match                                            → error
 *
 * '03' (gobierno) NUNCA se infiere — requiere captura manual en clients.
 *
 * 🔒 `tipoReceptorEfectivo` es la ÚNICA derivación: la usan el mapper (lo que
 * viaja), el gate fiscal y las validaciones previas. Antes el gate exigía el
 * tipo explícito mientras el mapper lo deducía: un cliente sin tipo nunca
 * llegaba al PAC y la factura quedaba «no emitida» sin aviso.
 */

import { TIPO_RECEPTOR_FE, type TipoReceptorFe } from "@/lib/finanzas/efactura/types";
import type { EfacturaBundleClient } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";

/** Los campos de la ficha que deciden el tipo de receptor. */
export interface ClienteParaTipoReceptor {
  tipo_receptor_fe?: string | null;
  id_extranjero?: string | null;
  tax_id_type?: string | null;
  client_type?: string | null;
  digito_verificador?: string | null;
}

/** El tipo de receptor que se manda, o `null` si la ficha no alcanza para saberlo. */
export function tipoReceptorEfectivo(client: ClienteParaTipoReceptor): TipoReceptorFe | null {
  // 1. Valor explícito en BD gana siempre (Fase 1A).
  const explicito = String(client.tipo_receptor_fe ?? "").trim();
  if (explicito) {
    return explicito as TipoReceptorFe;
  }

  // 2. Extranjero gana sobre tax_id_type panameño (el campo
  // id_extranjero solo se llena para receptores no-residentes).
  if (String(client.id_extranjero ?? "").trim() || client.tax_id_type === "extranjero") {
    return TIPO_RECEPTOR_FE.EXTRANJERO;
  }

  // 3. Por tipo de documento de identidad.
  switch (client.tax_id_type) {
    case "ruc":
      return TIPO_RECEPTOR_FE.CONTRIBUYENTE;
    case "cedula":
    case "pasaporte":
      return TIPO_RECEPTOR_FE.CONSUMIDOR_FINAL;
  }

  // 4. Sin tipo de documento: por el tipo de cliente (03/10/2026).
  if (client.client_type === "persona_juridica") return TIPO_RECEPTOR_FE.CONTRIBUYENTE;
  if (client.client_type === "persona_natural") {
    return String(client.digito_verificador ?? "").trim()
      ? TIPO_RECEPTOR_FE.CONTRIBUYENTE
      : TIPO_RECEPTOR_FE.CONSUMIDOR_FINAL;
  }
  return null;
}

export function deriveTipoReceptorFe(
  client: EfacturaBundleClient
): TipoReceptorFe {
  const tipo = tipoReceptorEfectivo(client);
  if (tipo) return tipo;
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

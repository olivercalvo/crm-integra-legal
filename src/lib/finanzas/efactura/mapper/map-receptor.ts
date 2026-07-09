/**
 * Construye el bloque `informacionReceptor` (GDatRecRequest) desde el
 * cliente del CRM (con campos Fase 1A poblados).
 *
 * Reglas (D3, D4 confirmadas):
 *   - tipoReceptorFe: usa clients.tipo_receptor_fe si está; sino derive().
 *   - tipoContribuyente del receptor: persona_natural=1, persona_juridica=2.
 *     Si client_type IS NULL → error.
 *   - tipoReceptorFe='01' (contribuyente RUC): se requiere datosRucReceptor.
 *   - tipoReceptorFe='04' (extranjero): se requiere grupoIdentificacionExtranjera.
 *   - tipoReceptorFe='02' (consumidor final): solo datos identificatorios
 *     mínimos; no requiere datosRucReceptor.
 *   - tipoReceptorFe='03' (gobierno): el cliente debe tener RUC; usamos
 *     la misma estructura que '01'.
 *   - paisReceptor: para 01/02/03 (domésticos) se envía SIEMPRE 'PA'
 *     (catálogo countries del PAC: {codigo:'PA', nombre:'Panamá'}). El XSD
 *     DGI exige cPaisRec al final de gDatRec — sin él, rechazo 0100
 *     "incomplete content". Para 04 se usa el código del cliente extranjero.
 */
// Catálogo PAC /api/v1/Catalogs/countries — confirmado contra sandbox 2026-06-03.
const CODIGO_PAIS_PANAMA = "PA";

import type {
  InformacionReceptor,
  RucReceptor,
  UbicacionReceptor,
  IdentificacionExtranjera,
} from "@/lib/finanzas/efactura/types";
import { TIPO_CONTRIBUYENTE, TIPO_RECEPTOR_FE } from "@/lib/finanzas/efactura/types";
import type { EfacturaBundleClient } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";
import { deriveTipoReceptorFe } from "./derive-tipo-receptor-fe";

export function mapReceptor(client: EfacturaBundleClient): InformacionReceptor {
  const tipoReceptorFe = deriveTipoReceptorFe(client);

  // tipoContribuyente solo aplica a receptores '01' y '03' (con RUC).
  // Para '02' (consumidor final) y '04' (extranjero) no es requerido,
  // pero el swagger lo marca como integer no nullable cuando hay
  // datosRucReceptor. Por eso solo lo armamos cuando corresponde.
  const ubicacion: UbicacionReceptor | undefined =
    client.codigo_ubicacion ||
    client.corregimiento ||
    client.distrito ||
    client.provincia
      ? {
          codigoUbicacion: client.codigo_ubicacion ?? undefined,
          corregimiento: client.corregimiento ?? undefined,
          distrito: client.distrito ?? undefined,
          provincia: client.provincia ?? undefined,
        }
      : undefined;

  const receptor: InformacionReceptor = {
    tipoReceptorFe,
    nombreRazonReceptor: client.name,
    direccionReceptor: client.address ?? undefined,
    ubicacionReceptor: ubicacion,
    telefonoContactoReceptor: client.phone ?? undefined,
    correoElectronicoReceptor: client.email ?? undefined,
    // Alias defensivo con el misspelling DGI ("Recepctor"): mismo valor bajo
    // ambas claves, igual que totalGrabado/totalGravado.
    correoElectronicoRecepctor: client.email ?? undefined,
  };

  if (
    tipoReceptorFe === TIPO_RECEPTOR_FE.CONTRIBUYENTE ||
    tipoReceptorFe === TIPO_RECEPTOR_FE.GOBIERNO
  ) {
    receptor.datosRucReceptor = buildRucReceptor(client);
  }

  if (
    tipoReceptorFe === TIPO_RECEPTOR_FE.CONTRIBUYENTE ||
    tipoReceptorFe === TIPO_RECEPTOR_FE.CONSUMIDOR_FINAL ||
    tipoReceptorFe === TIPO_RECEPTOR_FE.GOBIERNO
  ) {
    receptor.paisReceptor = CODIGO_PAIS_PANAMA;
  }

  if (tipoReceptorFe === TIPO_RECEPTOR_FE.EXTRANJERO) {
    receptor.grupoIdentificacionExtranjera = buildIdExtranjera(client);
    if (client.pais_receptor) {
      receptor.paisReceptor = client.pais_receptor;
    }
  }

  return receptor;
}

function buildRucReceptor(client: EfacturaBundleClient): RucReceptor {
  if (!client.client_type) {
    throw new Error(
      `[efactura/mapper] Cliente ${client.client_number} "${client.name}" ` +
        `no tiene client_type. Requerido para tipoContribuyente del receptor.`
    );
  }
  const tipoContribuyente =
    client.client_type === "persona_natural"
      ? TIPO_CONTRIBUYENTE.NATURAL
      : TIPO_CONTRIBUYENTE.JURIDICA;

  const ruc = client.tax_id ?? client.ruc;
  if (!ruc) {
    throw new Error(
      `[efactura/mapper] Cliente ${client.client_number} "${client.name}" ` +
        `no tiene tax_id ni ruc. Requerido para receptor con RUC.`
    );
  }

  if (!client.digito_verificador) {
    throw new Error(
      `[efactura/mapper] Cliente ${client.client_number} "${client.name}" ` +
        `no tiene digito_verificador. Requerido para receptor con RUC.`
    );
  }

  return {
    tipoContribuyente,
    rucReceptor: ruc,
    digitoVerificador: client.digito_verificador,
  };
}

function buildIdExtranjera(
  client: EfacturaBundleClient
): IdentificacionExtranjera {
  const numero = client.id_extranjero ?? client.tax_id;
  if (!numero) {
    throw new Error(
      `[efactura/mapper] Cliente extranjero ${client.client_number} ` +
        `"${client.name}" no tiene id_extranjero ni tax_id.`
    );
  }
  return {
    pasaportNumeroIdentificacionExtranjera: numero,
    paisExtranjero: client.pais_receptor ?? undefined,
  };
}

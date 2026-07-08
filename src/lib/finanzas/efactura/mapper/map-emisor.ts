/**
 * Construye el bloque `informacionEmisor` (GEmisRequest) desde EmisorConfig.
 * Lógica pura sin lectura de BD ni env (la lectura vive en
 * `loadEmisorConfig()`).
 */

import type { InformacionEmisor } from "@/lib/finanzas/efactura/types";
import type { EmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";

export function mapEmisor(config: EmisorConfig): InformacionEmisor {
  return {
    datosRucEmisor: {
      tipoContribuyente: config.tipoContribuyente,
      ruc: config.ruc,
      digitoVerificador: config.digitoVerificador,
    },
    nombreORazonSocial: config.nombreORazonSocial,
    codigoSucursal: config.codigoSucursal,
    direccionSucursal: config.direccionSucursal,
    ubicacionEmisor: {
      codigoUbicacion: config.ubicacion.codigoUbicacion,
      corregimiento: config.ubicacion.corregimiento,
      distrito: config.ubicacion.distrito,
      provincia: config.ubicacion.provincia,
    },
    telefonoSucursal: config.telefonoSucursal,
    direccionCorreoElectronico: config.direccionCorreoElectronico,
  };
}

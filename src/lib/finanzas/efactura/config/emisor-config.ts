/**
 * Configuración del emisor (Integra Legal) para llamadas a eFactura PTY.
 *
 * Fuente: variables de entorno EFACTURA_EMISOR_*. La validación se hace
 * en `loadEmisorConfig()` y rompe explícitamente si falta cualquier
 * requerido o si los placeholders de CPBS quedaron en 0.
 *
 * Las credenciales de la API (token / cliente HTTP) NO viven acá — son
 * responsabilidad del transport layer (Fase 3).
 */

import type { TipoContribuyente } from "@/lib/finanzas/efactura/types";

export interface EmisorUbicacion {
  codigoUbicacion: string;
  corregimiento: string;
  distrito: string;
  provincia: string;
}

export interface EmisorConfig {
  // Identidad fiscal
  ruc: string;
  digitoVerificador: string;
  tipoContribuyente: TipoContribuyente;   // típicamente 2 (jurídica) para el bufete
  nombreORazonSocial: string;

  // Sucursal
  codigoSucursal: string;                 // ej '0000'
  direccionSucursal: string;
  ubicacion: EmisorUbicacion;
  telefonoSucursal?: string;
  direccionCorreoElectronico?: string;

  // Defaults estructurales DGI (todos sobrescribibles por factura en el futuro)
  defaultTipoOperacion: 1 | 2;
  defaultDestinoOperacion: 1 | 2;
  defaultFormatoGeneracionCafe: 1 | 2 | 3;
  defaultManeraEntregaCafe: 1 | 2 | 3;
  defaultEnvioContenedorReceptor: 1 | 2;
  defaultProcesoGeneracionFe: 1 | 2 | 3;
  defaultTipoTransaccionVenta: 1 | 2 | 3 | 4;
  defaultTipoSucursal: 1 | 2;

  // Forma de pago default (placeholder hasta confirmar code DGI)
  defaultFormaPago: string;

  // Código CPBS de servicios legales (placeholder hasta confirmar code DGI).
  // El loader VALIDA que ambos sean != 0 para evitar enviar PDFs con un
  // código inválido a producción.
  cpbsServiciosLegalesHon: number;
  cpbsServiciosLegalesRei: number;
}

/**
 * Carga la configuración del emisor desde variables de entorno.
 * Lanza Error con mensaje explícito si falta cualquier requerido o si los
 * códigos CPBS están en 0.
 *
 * @param env Map de variables (default: process.env). Aceptar inyección
 *            facilita testing.
 */
export function loadEmisorConfig(
  env: Record<string, string | undefined> = process.env
): EmisorConfig {
  const required = (key: string): string => {
    const v = env[key];
    if (v === undefined || v === null || String(v).trim() === "") {
      throw new Error(
        `[efactura/emisor-config] Falta variable de entorno requerida: ${key}`
      );
    }
    return String(v).trim();
  };

  const optional = (key: string): string | undefined => {
    const v = env[key];
    if (v === undefined || v === null) return undefined;
    const t = String(v).trim();
    return t.length === 0 ? undefined : t;
  };

  const intRequired = (key: string): number => {
    const raw = required(key);
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(
        `[efactura/emisor-config] ${key} debe ser un entero, recibido: ${raw}`
      );
    }
    return n;
  };

  const tipoContribuyenteRaw = intRequired("EFACTURA_EMISOR_TIPO_CONTRIBUYENTE");
  if (tipoContribuyenteRaw !== 1 && tipoContribuyenteRaw !== 2) {
    throw new Error(
      `[efactura/emisor-config] EFACTURA_EMISOR_TIPO_CONTRIBUYENTE debe ser 1 (natural) o 2 (jurídica), recibido: ${tipoContribuyenteRaw}`
    );
  }

  const cpbsHon = intRequired("EFACTURA_EMISOR_CPBS_HON");
  const cpbsRei = intRequired("EFACTURA_EMISOR_CPBS_REI");
  if (cpbsHon === 0 || cpbsRei === 0) {
    throw new Error(
      `[efactura/emisor-config] Los códigos CPBS no pueden ser 0 (placeholders). HON=${cpbsHon}, REI=${cpbsRei}.`
    );
  }

  return {
    ruc: required("EFACTURA_EMISOR_RUC"),
    digitoVerificador: required("EFACTURA_EMISOR_DV"),
    tipoContribuyente: tipoContribuyenteRaw as TipoContribuyente,
    nombreORazonSocial: required("EFACTURA_EMISOR_RAZON_SOCIAL"),

    codigoSucursal: required("EFACTURA_EMISOR_SUCURSAL"),
    direccionSucursal: required("EFACTURA_EMISOR_DIRECCION"),
    ubicacion: {
      codigoUbicacion: required("EFACTURA_EMISOR_UBICACION_CODIGO"),
      corregimiento: required("EFACTURA_EMISOR_CORREGIMIENTO"),
      distrito: required("EFACTURA_EMISOR_DISTRITO"),
      provincia: required("EFACTURA_EMISOR_PROVINCIA"),
    },
    telefonoSucursal: optional("EFACTURA_EMISOR_TELEFONO"),
    direccionCorreoElectronico: optional("EFACTURA_EMISOR_EMAIL"),

    defaultTipoOperacion: 1,
    defaultDestinoOperacion: 1,
    defaultFormatoGeneracionCafe: 1,
    defaultManeraEntregaCafe: 1,
    defaultEnvioContenedorReceptor: 2,
    defaultProcesoGeneracionFe: 1,
    defaultTipoTransaccionVenta: 1,
    defaultTipoSucursal: 1,

    defaultFormaPago: optional("EFACTURA_EMISOR_FORMA_PAGO_DEFAULT") ?? "03",

    cpbsServiciosLegalesHon: cpbsHon,
    cpbsServiciosLegalesRei: cpbsRei,
  };
}

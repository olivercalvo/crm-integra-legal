/**
 * Catálogos y enumeraciones del contrato eFactura PTY.
 *
 * Valores con código DGI fijo (strings). Centralizar acá evita "magic
 * strings" repartidos por el mapper.
 */

// ---------------------------------------------------------------------------
// ITBMS — tasa decimal del CRM ↔ código DGI del PAC
// ---------------------------------------------------------------------------

/**
 * Mapeo tasa decimal (invoice_lines.tax_rate) → tasaITBMSAplicable del PAC.
 * Tasas vigentes en Panamá: 0% (exento), 7% (estándar), 10% (bienes
 * suntuarios), 15% (tabaco/alcohol). Si llega una tasa fuera de esta tabla
 * el mapper rompe con error explícito (no inferimos).
 *
 * Las claves son las tasas como string con 4 decimales (precisión del
 * NUMERIC(6,4) en BD) para evitar comparaciones de floats.
 */
export const ITBMS_RATE_TO_CODE = {
  "0.0000": "00",
  "0.0700": "01",
  "0.1000": "02",
  "0.1500": "03",
} as const;

export type ItbmsCode =
  (typeof ITBMS_RATE_TO_CODE)[keyof typeof ITBMS_RATE_TO_CODE];

// ---------------------------------------------------------------------------
// tipoReceptorFe — taxonomía DGI del receptor
// ---------------------------------------------------------------------------

export const TIPO_RECEPTOR_FE = {
  CONTRIBUYENTE: "01",      // Empresa con RUC
  CONSUMIDOR_FINAL: "02",   // Persona natural (cédula/pasaporte)
  GOBIERNO: "03",           // Entidad gubernamental (manual)
  EXTRANJERO: "04",         // Receptor extranjero
} as const;

export type TipoReceptorFe =
  (typeof TIPO_RECEPTOR_FE)[keyof typeof TIPO_RECEPTOR_FE];

// ---------------------------------------------------------------------------
// tipoContribuyente — clasificación PAC del receptor/emisor
// ---------------------------------------------------------------------------

export const TIPO_CONTRIBUYENTE = {
  NATURAL: 1,
  JURIDICA: 2,
} as const;

export type TipoContribuyente =
  (typeof TIPO_CONTRIBUYENTE)[keyof typeof TIPO_CONTRIBUYENTE];

// ---------------------------------------------------------------------------
// tiempoPago — modalidad de pago en GTotRequest
// ---------------------------------------------------------------------------

export const TIEMPO_PAGO = {
  CONTADO: 1,
  CREDITO: 2,
  MIXTO: 3,
} as const;

export type TiempoPago = (typeof TIEMPO_PAGO)[keyof typeof TIEMPO_PAGO];

// ---------------------------------------------------------------------------
// tipoDocumento (subset usado en Fase 2)
// ---------------------------------------------------------------------------

export const TIPO_DOCUMENTO = {
  FACTURA_OPERACION_INTERNA: "01",
  IMPORTACION: "02",
  EXPORTACION: "03",
  NOTA_CREDITO: "04",
  NOTA_DEBITO: "05",
} as const;

export type TipoDocumento =
  (typeof TIPO_DOCUMENTO)[keyof typeof TIPO_DOCUMENTO];

// ---------------------------------------------------------------------------
// tipoEmision
// ---------------------------------------------------------------------------

export const TIPO_EMISION = {
  NORMAL: "01",
  CONTINGENCIA: "02",
} as const;

export type TipoEmision = (typeof TIPO_EMISION)[keyof typeof TIPO_EMISION];

// ---------------------------------------------------------------------------
// Ambiente PAC
// ---------------------------------------------------------------------------

export const I_AMB = {
  PRODUCCION: 1,
  PRUEBAS: 2,
} as const;

export type IAmb = (typeof I_AMB)[keyof typeof I_AMB];

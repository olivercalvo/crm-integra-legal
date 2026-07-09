/**
 * Reglas de los campos fiscales de cliente para facturación electrónica (FE)
 * ante la DGI de Panamá. Módulo PURO (sin I/O) para poder validar la misma
 * lógica en el form (cliente) y en la API (servidor) desde una sola fuente.
 *
 * Campos:
 *   - tipo_receptor_fe: 01 contribuyente · 02 consumidor final · 03 gobierno ·
 *     04 extranjero. Determina qué exige la DGI del receptor.
 *   - digito_verificador (DV): dígito verificador del RUC que asigna la DGI.
 *     Obligatorio SOLO para 01 y 03 (Ficha Técnica DGI B4023: obligatorio si
 *     el tipo de receptor es 01 o 03). Para 02/04 no aplica.
 */

export type TipoReceptorFe = "01" | "02" | "03" | "04";

export const TIPO_RECEPTOR_FE_OPTIONS: { value: TipoReceptorFe; label: string }[] = [
  { value: "01", label: "01 - Contribuyente" },
  { value: "02", label: "02 - Consumidor final" },
  { value: "03", label: "03 - Gobierno" },
  { value: "04", label: "04 - Extranjero" },
];

const VALID_TIPOS = new Set<string>(["01", "02", "03", "04"]);

export function isTipoReceptorFe(v: unknown): v is TipoReceptorFe {
  return typeof v === "string" && VALID_TIPOS.has(v);
}

/**
 * El DV es obligatorio solo para receptores con RUC contribuyente: 01
 * (contribuyente) y 03 (gobierno). 02 (consumidor final, cédula) y 04
 * (extranjero) NO lo requieren.
 */
export function tipoRequiresDV(tipo: string | null | undefined): boolean {
  return tipo === "01" || tipo === "03";
}

/**
 * Default de UI (editable) para tipo_receptor_fe a partir de client_type.
 * - persona_juridica → 01 (siempre contribuyente con RUC).
 * - persona_natural  → "" (la abogada elige: puede ser 01 si tiene RUC, o 02
 *   consumidor final). NO forzamos 02 porque una persona natural puede ser
 *   contribuyente.
 */
export function suggestTipoReceptorFe(
  clientType: string | null | undefined
): TipoReceptorFe | "" {
  if (clientType === "persona_juridica") return "01";
  return "";
}

export interface FiscalFieldsInput {
  tipo_receptor_fe?: string | null;
  digito_verificador?: string | null;
}

/**
 * Valida coherencia de los campos fiscales. Retorna un mapa de errores por
 * campo (vacío = todo ok). Se usa tanto en el form (antes de guardar) como en
 * la API (antes de persistir), para no crear un cliente que después falle al
 * facturar.
 */
export function validateFiscalFields(
  input: FiscalFieldsInput
): Record<string, string> {
  const errors: Record<string, string> = {};
  const tipo = (input.tipo_receptor_fe ?? "").trim();
  const dv = (input.digito_verificador ?? "").trim();

  if (tipo && !VALID_TIPOS.has(tipo)) {
    errors.tipo_receptor_fe = "Tipo de receptor FE inválido.";
  }
  if (dv && !/^\d{1,2}$/.test(dv)) {
    errors.digito_verificador = "El dígito verificador debe ser 1 o 2 dígitos.";
  } else if (tipoRequiresDV(tipo) && !dv) {
    errors.digito_verificador =
      "El dígito verificador es obligatorio para contribuyentes (01) y gobierno (03).";
  }
  return errors;
}

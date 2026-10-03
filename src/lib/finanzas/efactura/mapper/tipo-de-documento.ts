/**
 * Qué `tipoDocumento` (B06) le corresponde a una NOTA del CRM.
 *
 * Ficha técnica para PAC V1.00 y prueba en sandbox del 03/10/2026
 * (`docs/efactura/prueba-tipos-05-06-07.txt`):
 *
 *   | Nota              | Referencia a una FE (CUFE) | B06 |
 *   |-------------------|----------------------------|-----|
 *   | crédito           | sí                         | 04  |
 *   | crédito           | no                         | 06  |
 *   | débito            | sí                         | 05  |
 *   | débito            | no                         | 07  |
 *
 * 🔴 Las dos reglas que rechaza la DGI, y que esta función hace imposibles:
 *   · 04/05 sin CUFE → `1705`;
 *   · 06/07 con CUFE → `1706`.
 * Por eso el tipo sale de si HAY referencia, no de un parámetro aparte.
 *
 * La factura de honorarios y la de reembolso siguen en `tipoDocumentoDeKind`.
 */
import { TIPO_DOCUMENTO, type TipoDocumento } from "@/lib/finanzas/efactura/types/catalogs";

export function tipoDocumentoDeNota(clase: "credito" | "debito", conReferenciaAFe: boolean): TipoDocumento {
  if (clase === "credito") {
    return conReferenciaAFe ? TIPO_DOCUMENTO.NOTA_CREDITO : TIPO_DOCUMENTO.NOTA_CREDITO_GENERICA;
  }
  return conReferenciaAFe ? TIPO_DOCUMENTO.NOTA_DEBITO : TIPO_DOCUMENTO.NOTA_DEBITO_GENERICA;
}

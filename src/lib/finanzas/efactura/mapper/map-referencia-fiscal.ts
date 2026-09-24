/**
 * `documentosFiscalesReferenciados` — el bloque con el que una nota de crédito
 * dice QUÉ factura corrige.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 `informacionReferencia` VA DOS VECES, UNA DENTRO DE LA OTRA
 * ═════════════════════════════════════════════════════════════════════════════
 * No se decidió leyendo: el swagger de ideati no tiene un solo `required`, ni
 * un `enum`, ni descripciones, y ya había demostrado que no alcanza. El
 * 24/09/2026 se mandó la MISMA nota de crédito al sandbox con las dos formas:
 *
 *   anidada (la del swagger) → ✅ `0260 Autorizado el uso de la FE`
 *   plana   (la de las notas) → ❌ `0100 The element 'gDFRefNum' … has
 *                                  incomplete content. List of possible
 *                                  elements expected: 'gDFRefFE,
 *                                  gDFRefFacPap, gDFRefFacIE'`
 *
 * El propio rechazo nombra los tres hermanos que el wrapper espera. El anidado
 * no es una rareza del swagger: es lo que pide el XSD de la DGI.
 *
 * 🔒 La salida de este módulo está congelada contra
 * `__tests__/referencia-fiscal-esperada.json` —el bloque que autorizó— y el
 * contra-ejemplo plano, con su código de rechazo, está en
 * `referencia-fiscal-rechazada.json`. Evidencia completa en
 * `docs/efactura/prueba9c-referencia.txt`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Dos detalles que costaron un rechazo cada uno
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 `fechaEmisionDocumentoReferenciado` LLEVA ZONA HORARIA. El primer intento
 *    la mandó pelada (`2026-09-24T00:00:00`) y rebotó con `0100 … datatype
 *    'fechaTZ' … Pattern constraint failed`. Es el mismo formato que
 *    `fechaEmision`, y `toPanamaIso` ya lo produce.
 *
 * ⚠️ La DGI NO valida `nombreRazonSocialEmisor` contra el RUC: la prueba
 *    autorizó con el nombre equivocado ahí. O sea que un error en ese campo no
 *    lo atrapa el PAC, lo tiene que atrapar el código — y por eso el nombre
 *    sale del EMISOR (`EFACTURA_EMISOR_RAZON_SOCIAL`), que es quien emitió la
 *    factura referenciada, y nunca del cliente. Es el error fácil: la NC es
 *    "del cliente", pero la factura que referencia la emitimos nosotros.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 REFERENCIAR UNA FACTURA EN PAPEL NO ESTÁ DISPONIBLE
 * ─────────────────────────────────────────────────────────────────────────────
 * El wrapper tiene tres hermanos: por CUFE (`informacionReferencia`), por
 * factura en papel (`informacionReferenciaFacturaPapel`) y por impresora fiscal
 * (`informacionReferenciaImpresoraFiscal`). Sólo se construye el primero.
 *
 * Medido el 24/09/2026: mandar el de PAPEL hace que el PAC conteste `[0000]
 * Object reference not set to an instance of an object` — un
 * `NullReferenceException` de .NET, no una validación de negocio. Pasa igual
 * con `tipoDocumento` 04 y 06, así que lo que rompe es el bloque de papel y no
 * el tipo de documento. La pregunta está en `task_plan.md`, en espera de que el
 * bufete confirme si existe alguna factura en papel que acreditar.
 *
 * Mientras tanto, una factura sin CUFE no se envía a la DGI: se pide el CUFE
 * (caso B) y, si no lo hay, la pantalla lo dice y no deja emitir la NC fiscal.
 */

import type { EmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import { toPanamaIso } from "./format-decimals";

/** El RUC del emisor del documento referenciado, en sus tres campos separados. */
export interface RucEmisorReferenciado {
  /** 1 natural | 2 jurídica. Numérico, no string. */
  tipoRuc: number;
  ruc: string;
  /**
   * ⚠️ Separado del RUC, SIEMPRE. Misma regla que en proveedores: el RUC y el
   * DV no se concatenan nunca.
   */
  digitoVerificador: string;
}

/**
 * El wrapper `gDFRefNumRequest`. Tiene tres hermanos y se manda exactamente
 * uno; hoy sólo se construye el de CUFE (ver el encabezado).
 */
export interface WrapperDeReferencia {
  informacionReferencia: { cufeReferenciado: string };
}

export interface DocumentoFiscalReferenciado {
  rucEmisorDocumentoReferenciado: RucEmisorReferenciado;
  nombreRazonSocialEmisor: string;
  /** ISO con huso de Panamá. Sin el offset, la DGI rechaza con `0100`. */
  fechaEmisionDocumentoReferenciado: string;
  /** 🔴 El wrapper. Adentro va OTRO `informacionReferencia`. */
  informacionReferencia: WrapperDeReferencia;
}

/**
 * Lo único del emisor que este bloque necesita. Se pide el subconjunto y no el
 * `EmisorConfig` entero para que el congelamiento se pueda probar sin tener que
 * levantar las 16 variables de entorno: un test que necesita el entorno no se
 * corre, y un congelamiento que no se corre no congela nada.
 */
export type EmisorDeLaReferencia = Pick<
  EmisorConfig,
  "tipoContribuyente" | "ruc" | "digitoVerificador" | "nombreORazonSocial"
>;

export interface ReferenciaAFacturaElectronica {
  /** `invoices.dgi_cufe` de la factura que la nota de crédito corrige. */
  cufe: string;
  /** `invoices.issue_date`, `YYYY-MM-DD`. */
  fechaEmision: string;
}

/**
 * Arma el bloque `documentosFiscalesReferenciados` de una nota de crédito.
 *
 * Es un array porque el contrato lo es, pero una NC del CRM corrige UNA
 * factura: `credit_notes.invoice_id` es una sola columna, no una tabla de
 * cruce. Se devuelve un array de un elemento y no se generaliza hasta que
 * exista el caso.
 *
 * @param emisor  El bufete. La factura referenciada la emitimos nosotros, así
 *                que el "emisor del documento referenciado" somos nosotros.
 */
export function construirReferenciaFiscal(
  referencia: ReferenciaAFacturaElectronica,
  emisor: EmisorDeLaReferencia
): DocumentoFiscalReferenciado[] {
  const cufe = referencia.cufe.trim();
  if (cufe.length === 0) {
    throw new Error(
      "[efactura/referencia] La nota de crédito necesita el CUFE de la factura que corrige. " +
        "Si la factura se emitió en el portal, hay que cargar su CUFE primero."
    );
  }

  return [
    {
      rucEmisorDocumentoReferenciado: {
        tipoRuc: emisor.tipoContribuyente,
        ruc: emisor.ruc,
        digitoVerificador: emisor.digitoVerificador,
      },
      // ⚠️ El EMISOR, no el cliente. La DGI no lo valida: lo valida esta línea.
      nombreRazonSocialEmisor: emisor.nombreORazonSocial,
      fechaEmisionDocumentoReferenciado: toPanamaIso(referencia.fechaEmision),
      informacionReferencia: {
        // 🔴 El anidado. Aplanar esto es un rechazo `0100` sobre una factura real.
        informacionReferencia: { cufeReferenciado: cufe },
      },
    },
  ];
}

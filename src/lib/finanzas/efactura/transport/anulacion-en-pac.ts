// Server-only: usa el transporte que manda el API Key al PAC.
// NO importar desde componentes cliente.
//
/**
 * LAS DOS LLAMADAS DE LA ANULACIÓN ANTE LA DGI.
 *
 *   1. `anularEnPac(cufe, motivo)`      → POST /api/v1/InvoiceEvents/CreateCancellation
 *   2. `consultarEstadoEnPac(cufe)`     → GET  /api/v1/Invoices/Authorization/{cufe}
 *
 * La segunda existe por D3: **el reintento después de un timeout SIEMPRE
 * consulta el estado del documento antes de volver a llamar a
 * CreateCancellation.** Si el primer POST llegó a la DGI y la respuesta se
 * perdió en el camino, reintentar a ciegas es pedir la anulación de algo que ya
 * está anulado — y como no sabemos si el endpoint es idempotente (prueba de
 * sandbox (a)), no sabemos qué pasa si lo hacemos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 NO SABEMOS QUÉ CAMPO DICE "ESTE DOCUMENTO ESTÁ ANULADO"
 * ─────────────────────────────────────────────────────────────────────────────
 * `InvoiceReceptionResponse` —lo que devuelve el GET— tiene `autorizada`,
 * `protocoloAutorizacion`, `fechaAutorizacion`, `cufe`… y también `deletedDate`
 * y `deletedBy`. El swagger **no describe ni uno solo de esos campos**: no hay
 * una sola `description` en el esquema.
 *
 * `deletedDate` es la hipótesis obvia. También es exactamente el tipo de
 * hipótesis que se vuelve un hecho por repetición: alguien la escribe, el
 * siguiente la lee ya sin el condicional, y seis meses después el reintento
 * decide sobre un campo que en realidad marcaba otra cosa (un borrado lógico
 * del PAC, por ejemplo, que no es lo mismo que una anulación ante la DGI).
 *
 * Por eso `leerEstadoDelDocumento` devuelve `anulado: null` mientras
 * `MARCADOR_DE_ANULACION_CONFIRMADO` sea `false`, y expone aparte lo que la
 * hipótesis diría (`anuladoSegunHipotesis`) junto con el payload crudo. La
 * prueba de sandbox (b) —"consultar el documento anulado y registrar qué campo
 * y qué valor muestran que está anulado"— es la que cierra esto, y lo cierra
 * cambiando una constante o reemplazando el lector, en su propio commit.
 *
 * Consecuencia buscada, no accidental: **mientras esto no esté confirmado, el
 * reintento automático no existe.** `anulado: null` significa que el
 * orquestador no puede decidir solo y tiene que mostrarle el caso a una
 * persona. Es más lento y es correcto: la alternativa es adivinar sobre un
 * documento fiscal.
 */

import { get, post } from "@/lib/finanzas/efactura/transport/efactura-client";

const RUTA_ANULAR = "/api/v1/InvoiceEvents/CreateCancellation";
const RUTA_ESTADO = "/api/v1/Invoices/Authorization";

/**
 * 🔴 Lo flipa la prueba de sandbox (b), no una lectura del swagger.
 * Mientras sea `false`, `leerEstadoDelDocumento` no afirma que un documento
 * esté anulado: devuelve `null` y el caso escala a una persona.
 */
export const MARCADOR_DE_ANULACION_CONFIRMADO = false;

/** El body que pide `CancellationRequest`. Dos campos, y son estos. */
export interface PedidoDeAnulacion {
  cufe: string;
  cancellationReason: string;
}

/**
 * Manda la anulación al PAC. Devuelve el cuerpo CRUDO: clasificarlo es trabajo
 * de `clasificar-respuesta-de-anulacion.ts`, que es puro y se puede probar.
 *
 * Los errores de red y los HTTP no-2xx salen como `throw` desde el transporte,
 * igual que en la emisión. El orquestador los trata como "no sé si llegó".
 */
export async function anularEnPac(pedido: PedidoDeAnulacion): Promise<unknown> {
  return post(RUTA_ANULAR, pedido);
}

/** Consulta el estado del documento por CUFE. Devuelve el cuerpo crudo. */
export async function consultarEstadoEnPac(cufe: string): Promise<unknown> {
  return get(`${RUTA_ESTADO}/${encodeURIComponent(cufe)}`);
}

export interface EstadoDelDocumentoEnPac {
  cufe: string | null;
  /** `null` cuando el PAC no lo trajo. */
  autorizada: boolean | null;
  /**
   * 🔴 `null` = **no se pudo determinar**, no "no está anulado". Mientras
   * `MARCADOR_DE_ANULACION_CONFIRMADO` sea `false`, siempre es `null`.
   */
  anulado: boolean | null;
  /**
   * Lo que diría la hipótesis de `deletedDate`. Se expone para poder compararla
   * contra una respuesta real en la prueba (b), NO para decidir con ella.
   */
  anuladoSegunHipotesis: boolean;
  /** El campo candidato, tal cual vino. */
  deletedDate: string | null;
  deletedBy: string | null;
  fechaAutorizacion: string | null;
  protocoloAutorizacion: string | null;
  /** El payload completo: es la evidencia que la prueba (b) tiene que registrar. */
  crudo: unknown;
}

/** Lector PURO del cuerpo del GET. Sin red: se puede probar con un fixture. */
export function leerEstadoDelDocumento(crudo: unknown): EstadoDelDocumentoEnPac {
  const o = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;

  const cadena = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  };

  const deletedDate = cadena(o.deletedDate);
  const anuladoSegunHipotesis = deletedDate !== null;

  return {
    cufe: cadena(o.cufe),
    autorizada: typeof o.autorizada === "boolean" ? o.autorizada : null,
    // 🔴 Acá está el candado. Ver el encabezado.
    anulado: MARCADOR_DE_ANULACION_CONFIRMADO ? anuladoSegunHipotesis : null,
    anuladoSegunHipotesis,
    deletedDate,
    deletedBy: cadena(o.deletedBy),
    fechaAutorizacion: cadena(o.fechaAutorizacion),
    protocoloAutorizacion: cadena(o.protocoloAutorizacion),
    crudo,
  };
}

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
 * 🔴 EL GET NO DICE SI EL DOCUMENTO ESTÁ ANULADO. MEDIDO, NO SUPUESTO.
 * ─────────────────────────────────────────────────────────────────────────────
 * `InvoiceReceptionResponse` —lo que devuelve el GET— tiene `autorizada`,
 * `protocoloAutorizacion`, `fechaAutorizacion`, `cufe`… y también `deletedDate`
 * y `deletedBy`. El swagger **no describe ni uno solo de esos campos**: no hay
 * una sola `description` en el esquema.
 *
 * `deletedDate` era la hipótesis obvia. **Y es falsa.**
 *
 * Prueba de sandbox (b), 23/09/2026: se consultó el documento
 * `FE0920000025046169-3-2021-…905584` antes y después de pedir su anulación, y
 * el PAC devolvió **exactamente el mismo payload** — `autorizada: true`,
 * `deletedDate: null`, `deletedBy: null`, `updatedDate: null`. **Ningún campo
 * cambió**, con el evento de anulación ya existente (la llamada a
 * `CreateCancellation` de esa misma corrida devolvió `0622 — Ya existe un
 * evento de anulación para esta FE`).
 *
 * O sea que este endpoint responde por la AUTORIZACIÓN del documento, no por su
 * vigencia. Lo único que informa una anulación es el propio `0622`.
 *
 * Consecuencias, las dos importantes:
 *
 *   1. **La "consulta de estado antes de reintentar" que pide D3 no se puede
 *      hacer con la API que existe.** No es que falte implementarla: no hay a
 *      qué preguntarle.
 *   2. **El reintento se apoya en `0622`, no en el GET.** Volver a llamar a
 *      `CreateCancellation` es seguro —es estable, prueba (a)— y su respuesta
 *      distingue "ya estaba anulado" de "se anuló ahora" de "lo rechazó".
 *
 * `leerEstadoDelDocumento` se conserva porque `autorizada` y `fechaAutorizacion`
 * siguen siendo útiles, y porque guardar el payload crudo es lo que permitió
 * llegar a esta conclusión. Pero `anulado` es **siempre `null`**, y ahora eso
 * no es prudencia provisional: es el resultado.
 */

import { get, post } from "@/lib/finanzas/efactura/transport/efactura-client";

const RUTA_ANULAR = "/api/v1/InvoiceEvents/CreateCancellation";
const RUTA_ESTADO = "/api/v1/Invoices/Authorization";

/**
 * 🔴 SE QUEDA EN `false` PARA SIEMPRE, y ahora por un motivo medido.
 *
 * La prueba de sandbox (b) del 23/09/2026 mostró que el GET **no refleja la
 * anulación**: mismo payload antes y después, `deletedDate` nulo en los dos.
 * No hay marcador que confirmar. Ponerlo en `true` afirmaría, sobre un
 * documento fiscal, algo que el PAC no dice.
 *
 * Queda como constante y no como un `false` suelto porque es el lugar donde
 * está escrito el hallazgo: si mañana ideati agrega un campo de vigencia, acá
 * se ve qué había que cambiar y por qué.
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

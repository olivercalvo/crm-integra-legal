import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DOCUMENTOS DE PRUEBA — la marca que leen los reportes (094, 05/10/2026).
 *
 * `de_prueba` vive en cada DOCUMENTO (`invoices`, `credit_notes`, `payments`,
 * `client_payments`, `expenses`). La del cliente (`clients.es_de_prueba`) sólo
 * hace nacer de prueba lo NUEVO, y por eso ningún reporte filtra por el
 * cliente. FAC-HON-000463 es real ante la DGI aunque su cliente se llame
 * 0TEST-FE-002; desde el 07/10/2026 ese cliente no se marca (marcado, la 463 no
 * se podía cobrar ni acreditar) y su factura de sandbox se marca por número. Propuesta: docs/finanzas/propuesta-corte-quickbooks.md §9.
 *
 * Toda consulta de un reporte, una antigüedad, el ITBMS, Pendientes DGI, los
 * avisos y los selectores de documentos abiertos agrega:
 *
 *     .eq(DE_PRUEBA, false)
 *
 * 🔒 `documentos-de-prueba-filtrados.test.ts` recorre esas fuentes y falla si una
 * consulta de una tabla marcada no lo hace. Una consulta que a propósito ve
 * también las de prueba (el detalle de un documento, un listado con su badge,
 * una validación) se declara con un comentario `de-prueba-ok: <motivo>`.
 *
 * El LIBRO no necesita filtro: un documento de prueba no tiene asiento. La 094
 * no deja marcar un documento con asiento, y la 095 no deja postear uno marcado.
 */

/** La columna. Una sola constante para que el test pueda buscarla. */
export const DE_PRUEBA = "de_prueba";

/** Texto del badge en listados y detalle. */
export const ETIQUETA_DE_PRUEBA = "Prueba";

/** Banda del detalle de un documento marcado. */
export const AVISO_DE_PRUEBA =
  "Documento de prueba: no cuenta en el libro, las ventas, el ITBMS, la antigüedad ni Pendientes DGI.";

// ---------------------------------------------------------------------------
// Antes del número: un documento de prueba no se emite ni se contabiliza.
// ---------------------------------------------------------------------------
// La base (095) rechaza el asiento de un documento de prueba; acá se corta
// ANTES de tomar el correlativo, para no dejar un hueco (SOP-031) y para decir
// por qué en palabras. Un documento NUEVO de un cliente de prueba nace de
// prueba (094), así que el control es el del cliente.

type Db = SupabaseClient;

export function mensajeDeClienteDePrueba(numero: string): string {
  return (
    `El cliente ${numero} está marcado de prueba: sus documentos no se emiten ni se registran en el libro. ` +
    `Si es un cliente real, hay que desmarcarlo primero.`
  );
}

export function mensajeDeDocumentoDePrueba(numero: string | null): string {
  return (
    `${numero ? `El documento ${numero}` : "Este documento"} está marcado de prueba: no se emite ni se registra en el libro.`
  );
}

/** El número del cliente si está marcado de prueba; null si es real (o no existe). */
export async function clienteDePrueba(db: Db, tenantId: string, clientId: string): Promise<string | null> {
  const { data } = await db
    .from("clients")
    .select("client_number, es_de_prueba")
    .eq("tenant_id", tenantId)
    .eq("id", clientId)
    .maybeSingle();
  return data && data.es_de_prueba === true ? String(data.client_number ?? "") : null;
}

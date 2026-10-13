/**
 * EL ANCLA EXTERNA DE LA CADENA (R-1b, migración `075`). Módulo PURO.
 *
 * Al cerrar un período la base graba (en la misma transacción) el número y el
 * hash del último asiento. Esa huella sale de la base por dos caminos: el
 * respaldo diario (`tablas/accounting_chain_anchors.json`) y la constancia PDF
 * del cierre. Compararla contra la cadena (`verify_chain_anchors`) detecta una
 * reescritura completa, que la cadena sola no puede delatar.
 */

export interface Ancla {
  entry_number: number;
  hash: string;
}

export interface AnclaGuardada extends Ancla {
  id: string;
  period_id: string | null;
  year: number | null;
  month: number | null;
  origen: "cierre" | "inicial";
  anchored_at: string;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** «3f9a1c2e…88c21e0b»: lo que se lee en voz alta o se compara a ojo. */
export function huellaCorta(hash: string): string {
  return hash.length >= 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

export type ResultadoDeArchivo =
  | { ok: true; anclas: Ancla[]; ignoradas: number }
  | { ok: false; mensaje: string };

/**
 * Lee las anclas de un archivo traído de AFUERA: el JSON de la tabla en el
 * respaldo (un array de filas, de TODOS los bufetes) o una lista armada a mano
 * desde las constancias. Se quedan las del bufete de quien verifica; una fila
 * sin `tenant_id` se acepta (es una lista a mano). Nunca lanza.
 */
export function anclasDesdeArchivo(contenido: unknown, tenantId: string): ResultadoDeArchivo {
  let datos = contenido;
  if (typeof contenido === "string") {
    try {
      datos = JSON.parse(contenido);
    } catch {
      return { ok: false, mensaje: "El archivo no es un JSON válido." };
    }
  }
  if (!Array.isArray(datos)) {
    return { ok: false, mensaje: "El archivo tiene que ser la lista de anclas (un array JSON)." };
  }
  const anclas: Ancla[] = [];
  let ignoradas = 0;
  for (const fila of datos) {
    const f = fila as Record<string, unknown>;
    if (f?.tenant_id !== undefined && f.tenant_id !== tenantId) {
      ignoradas++;
      continue;
    }
    const nro = Number(f?.entry_number);
    const hash = String(f?.hash ?? "").trim().toLowerCase();
    if (!Number.isInteger(nro) || nro < 0 || !HASH_RE.test(hash)) {
      return { ok: false, mensaje: "Hay una fila sin número de asiento o sin hash válido (64 caracteres hexadecimales)." };
    }
    anclas.push({ entry_number: nro, hash });
  }
  if (anclas.length === 0) {
    return { ok: false, mensaje: "El archivo no tiene anclas de este bufete." };
  }
  return { ok: true, anclas, ignoradas };
}

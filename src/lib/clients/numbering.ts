/**
 * Asignación atómica de client_number CLI-NNN.
 *
 * Reemplaza el algoritmo viejo "ORDER BY client_number DESC LIMIT 1 + regex
 * /CLI-(\d+)/ + max+1" que falló en producción cuando una fila con prefijo
 * lex-mayor (TEST-FE-002) "ganaba" el ORDER BY, el regex no matcheaba y el
 * fallback caía a CLI-001 colisionando con la fila existente.
 *
 * Mecánica: misma RPC SECURITY DEFINER que usan facturas y cotizaciones
 * (public.get_next_sequence_number) sobre la tabla numbering_sequences con
 * sequence_type='client'. SELECT FOR UPDATE serializa concurrencia y la
 * comparación es numérica (INT), por lo que CLI-1000 ordena correctamente.
 *
 * Pre-requisito: la migración sql/pending/021_client_numbering_sequence.sql
 * debe estar aplicada (DROP+ADD del CHECK de sequence_type + INSERT de la
 * fila per-tenant con last_number seedeado desde MAX(suffix) actual).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export const CLIENT_SEQUENCE_TYPE = "client" as const;
export const CLIENT_NUMBER_PREFIX = "CLI" as const;
export const CLIENT_NUMBER_PAD = 3;

/** CLI-076. Acepta INT, pad mínimo 3 (CLI-001, CLI-1000 OK). */
export function formatClientNumber(n: number): string {
  return `${CLIENT_NUMBER_PREFIX}-${String(n).padStart(CLIENT_NUMBER_PAD, "0")}`;
}

/**
 * Consume la secuencia y devuelve el client_number formateado.
 *
 * Atomicidad: la RPC hace SELECT ... FOR UPDATE + UPDATE en una transacción
 * server-side. Dos requests concurrentes obtienen números distintos.
 *
 * Errores:
 *   - Si la fila numbering_sequences (tenant_id, 'client') no existe, la
 *     RPC lanza no_data_found. El caller debe propagar como 500 (es un
 *     misconfig — la migración 021 debe estar aplicada).
 *   - El número queda consumido al volver de la RPC. Si la INSERT en
 *     clients falla luego, se genera un gap. Aceptable (igual que invoices
 *     y quotes).
 */
export async function allocateClientNumber(
  db: DB,
  tenantId: string
): Promise<string> {
  const { data, error } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: CLIENT_SEQUENCE_TYPE,
  });

  if (error || typeof data !== "number") {
    const msg = error?.message ?? "No se pudo asignar el número de cliente";
    throw new Error(`allocateClientNumber: ${msg}`);
  }

  return formatClientNumber(data);
}

/**
 * Lee el SIGUIENTE número sin consumir la secuencia. Útil para el endpoint
 * GET /api/clients que sugiere el próximo CLI-NNN en la UI del form.
 *
 * No bloquea — si dos sesiones preview-an y luego una crea, la otra ve un
 * número desactualizado, pero la creación real usa allocateClientNumber()
 * que consume atómicamente. Mismo patrón que previewNextInvoiceNumber.
 */
export async function previewNextClientNumber(
  db: DB,
  tenantId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("numbering_sequences")
    .select("last_number")
    .eq("tenant_id", tenantId)
    .eq("sequence_type", CLIENT_SEQUENCE_TYPE)
    .maybeSingle();

  if (error || !data) return null;

  const next = (data.last_number as number) + 1;
  return formatClientNumber(next);
}

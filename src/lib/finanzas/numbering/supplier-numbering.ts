/**
 * Asignación atómica de `supplier_number` PRV-NNN.
 *
 * Es la "pestaña de número proveedor para tener la secuencia" que pidió Josuarth.
 * Usa la MISMA RPC `get_next_sequence_number` que clientes, facturas y
 * cotizaciones —`SELECT ... FOR UPDATE` server-side— en vez de un
 * `MAX(numero) + 1`, que ya falló una vez en producción con `client_number`.
 *
 * Pre-requisito: `sql/pending/033_proveedores_entidad.sql` aplicada (suma
 * 'supplier' al CHECK de `numbering_sequences` y siembra la fila por bufete).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export const SUPPLIER_SEQUENCE_TYPE = "supplier" as const;
export const SUPPLIER_NUMBER_PREFIX = "PRV" as const;
export const SUPPLIER_NUMBER_PAD = 3;

/** PRV-007. Pad mínimo 3; PRV-1000 sigue funcionando. */
export function formatSupplierNumber(n: number): string {
  return `${SUPPLIER_NUMBER_PREFIX}-${String(n).padStart(SUPPLIER_NUMBER_PAD, "0")}`;
}

/**
 * Consume la secuencia y devuelve el número formateado.
 *
 * Si la INSERT posterior falla queda un hueco en la numeración. Es aceptable y
 * es el mismo comportamiento que clientes y facturas: un hueco se explica, un
 * número repetido no.
 */
export async function allocateSupplierNumber(db: DB, tenantId: string): Promise<string> {
  const { data, error } = await db.rpc("get_next_sequence_number", {
    p_tenant_id: tenantId,
    p_sequence_type: SUPPLIER_SEQUENCE_TYPE,
  });

  if (error || typeof data !== "number") {
    const msg = error?.message ?? "No se pudo asignar el número de proveedor";
    throw new Error(`allocateSupplierNumber: ${msg}`);
  }
  return formatSupplierNumber(data);
}

/** El próximo número SIN consumir la secuencia, para mostrarlo en el form. */
export async function previewNextSupplierNumber(
  db: DB,
  tenantId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("numbering_sequences")
    .select("last_number")
    .eq("tenant_id", tenantId)
    .eq("sequence_type", SUPPLIER_SEQUENCE_TYPE)
    .maybeSingle();

  if (error || !data) return null;
  return formatSupplierNumber((data.last_number as number) + 1);
}

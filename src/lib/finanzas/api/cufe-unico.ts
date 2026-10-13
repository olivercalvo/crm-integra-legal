/**
 * UN CUFE, UNA FACTURA (`092`).
 *
 * Un documento autorizado por la DGI entra al CRM una sola vez, venga por donde
 * venga: lo que devolvió el PAC (051), lo que se cargó a mano (caso B y la
 * tarjeta DGI vieja) o una factura emitida fuera. La base lo sostiene con el
 * índice único `invoices_cufe_unico`; esto existe para decirlo en el campo,
 * nombrando la factura que ya lo tiene, en vez de un error de índice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";

type DB = SupabaseClient;

/** La factura que ya tiene ese CUFE, si alguna. Facturas de todos los orígenes. */
export async function facturaConElCufe(
  db: DB,
  tenantId: string,
  cufe: string,
  excepto?: string
): Promise<string | null> {
  const { data, error } = await db
    .from("invoices")
    .select("id, invoice_number, dgi_cufe")
    .eq("tenant_id", tenantId)
    .ilike("dgi_cufe", cufe.trim());
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  const otra = ((data ?? []) as { id: string; invoice_number: string; dgi_cufe: string | null }[]).find(
    (f) => f.id !== excepto && (f.dgi_cufe ?? "").trim().toUpperCase() === cufe.trim().toUpperCase()
  );
  return otra?.invoice_number ?? null;
}

export function mensajeDeCufeRepetido(numero: string): string {
  return (
    `Ese CUFE ya está registrado en la factura ${numero}. ` +
    "Un documento autorizado por la DGI entra al CRM una sola vez."
  );
}


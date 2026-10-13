import type { SupabaseClient } from "@supabase/supabase-js";

/** El asiento de un documento (factura/ND, compra, gasto de trámite), si lo tiene. */
export interface AsientoDelDocumento {
  id: string;
  entryNumber: number;
  reference: string | null;
}

/**
 * Busca por (`source_type`, `source_id`): el mismo par que hace único el
 * asiento de un documento (034). `factura` cubre también la ND (077).
 */
export async function cargarAsientoDelDocumento(
  db: SupabaseClient,
  tenantId: string,
  sourceType: "factura" | "gasto" | "gasto_tramite",
  sourceId: string
): Promise<AsientoDelDocumento | null> {
  const { data } = await db
    .from("journal_entries")
    .select("id, entry_number, reference")
    .eq("tenant_id", tenantId)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (!data) return null;
  const r = data as { id: string; entry_number: number; reference: string | null };
  return { id: r.id, entryNumber: Number(r.entry_number), reference: r.reference };
}

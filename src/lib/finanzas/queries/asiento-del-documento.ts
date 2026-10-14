import type { SupabaseClient } from "@supabase/supabase-js";

/** El asiento de un documento (factura/ND, compra, gasto de trámite), si lo tiene. */
export interface AsientoDelDocumento {
  id: string;
  entryNumber: number;
  reference: string | null;
  /** La fecha de registro del asiento (AAAA-MM-DD). */
  fecha: string;
}

/**
 * Busca por (`source_type`, `source_id`): el mismo par que hace único el
 * asiento de un documento (034). `factura` cubre también la ND (077).
 *
 * 103: una compra CORREGIDA tiene varios asientos `gasto` (uno por versión,
 * cada uno reversado por el siguiente). Se devuelve el VIGENTE: el que nadie
 * reversó. Sin correcciones hay uno solo, como siempre.
 */
export async function cargarAsientoDelDocumento(
  db: SupabaseClient,
  tenantId: string,
  sourceType: "factura" | "gasto" | "gasto_tramite",
  sourceId: string
): Promise<AsientoDelDocumento | null> {
  const { data } = await db
    .from("journal_entries")
    .select("id, entry_number, reference, transaction_date")
    .eq("tenant_id", tenantId)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("entry_number", { ascending: false });
  type Fila = { id: string; entry_number: number; reference: string | null; transaction_date: string };
  const filas: Fila[] = Array.isArray(data) ? (data as Fila[]) : data ? [data as unknown as Fila] : [];
  if (filas.length === 0) return null;
  let elegido = filas[0];
  if (filas.length > 1) {
    const { data: rev } = await db
      .from("journal_entries")
      .select("reverses_entry_id")
      .eq("tenant_id", tenantId)
      .in("reverses_entry_id", filas.map((f) => f.id));
    const reversados = new Set(((rev ?? []) as { reverses_entry_id: string }[]).map((r) => r.reverses_entry_id));
    elegido = filas.find((f) => !reversados.has(f.id)) ?? filas[0];
  }
  return {
    id: elegido.id,
    entryNumber: Number(elegido.entry_number),
    reference: elegido.reference,
    fecha: String(elegido.transaction_date).slice(0, 10),
  };
}

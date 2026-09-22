/**
 * UN ASIENTO DEL LIBRO, con todo lo que su pantalla de detalle necesita.
 *
 * Hasta el Bloque 7 no había forma de abrir un asiento: la carga tenía
 * formulario y el listado era el Diario General. Clonar y reversar necesitan un
 * lugar donde pararse, y ese lugar es `/finanzas/asientos/[id]`.
 *
 * 🔴 **Los DOS lados de la reversión** (D6). Un asiento puede estar en
 * cualquiera de las dos puntas, y la pantalla tiene que decir las dos:
 *
 *   · `reversa`    — el asiento que ESTE corrige (`reverses_entry_id`).
 *   · `reversadoPor` — el asiento que corrige a este (el que lo apunta).
 *
 * Sin el segundo, alguien podría reversar dos veces lo mismo sin enterarse; con
 * él, la pantalla apaga el botón y dice por qué.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export interface LineaDeAsiento {
  line_order: number;
  account_code: string;
  account_name: string;
  descripcion: string | null;
  debit: number;
  credit: number;
  /** 054: nombre de la ficha del tercero de la línea, si lo tiene. */
  tercero: string | null;
  /** `"cliente:<uuid>"` / `"proveedor:<uuid>"`, para precargar el clon. */
  terceroClave: string | null;
}

export interface AsientoVecino {
  id: string;
  entry_number: number;
  transaction_date: string;
}

export interface AsientoDelLibro {
  id: string;
  entry_number: number;
  transaction_date: string;
  record_date: string;
  description: string;
  source_type: string;
  source_id: string | null;
  reference: string | null;
  reversal_reason: string | null;
  created_at: string;
  lineas: LineaDeAsiento[];
  total: number;
  /** El asiento que ESTE reversa, si es una reversión. */
  reversa: AsientoVecino | null;
  /** El asiento que reversa a este, si ya fue corregido. */
  reversadoPor: AsientoVecino | null;
}

type FilaLinea = {
  line_order: number;
  debit: number | string;
  credit: number | string;
  line_description: string | null;
  client_id: string | null;
  supplier_id: string | null;
  clients: { name: string } | null;
  suppliers: { legal_name: string } | null;
  chart_of_accounts: { code: string; name: string };
};

export async function getAsientoDelLibro(
  db: DB,
  tenantId: string,
  id: string
): Promise<AsientoDelLibro | null> {
  const { data: cab, error } = await db
    .from("journal_entries")
    .select(
      "id, entry_number, transaction_date, record_date, description, source_type, " +
        "source_id, reference, reversal_reason, reverses_entry_id, created_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("[finanzas/queries] getAsientoDelLibro failed", error);
  if (!cab) return null;

  const cabecera = cab as unknown as Record<string, unknown>;

  const { data: lineas, error: errLin } = await db
    .from("journal_entry_lines")
    .select(
      "line_order, debit, credit, line_description, client_id, supplier_id, " +
        "clients(name), suppliers(legal_name), chart_of_accounts!inner(code, name)"
    )
    .eq("tenant_id", tenantId)
    .eq("entry_id", id)
    .order("line_order");

  if (errLin) console.error("[finanzas/queries] getAsientoDelLibro(lineas) failed", errLin);

  const filas = (lineas ?? []) as unknown as FilaLinea[];

  // Los dos vecinos, en dos consultas cortas. No se embeben por FK: el
  // self-join de `journal_entries` por nombre de constraint da PGRST200 (pasó
  // el 21/09 con la reversión del gasto de trámite).
  const reversaId = (cabecera.reverses_entry_id as string | null) ?? null;
  const [reversa, reversadoPor] = await Promise.all([
    reversaId
      ? db
          .from("journal_entries")
          .select("id, entry_number, transaction_date")
          .eq("tenant_id", tenantId)
          .eq("id", reversaId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("journal_entries")
      .select("id, entry_number, transaction_date")
      .eq("tenant_id", tenantId)
      .eq("reverses_entry_id", id)
      .maybeSingle(),
  ]);

  const vecino = (d: unknown): AsientoVecino | null => {
    if (!d) return null;
    const v = d as { id: string; entry_number: number; transaction_date: string };
    return {
      id: v.id,
      entry_number: Number(v.entry_number),
      transaction_date: String(v.transaction_date).slice(0, 10),
    };
  };

  const lineasOrdenadas: LineaDeAsiento[] = filas.map((l) => ({
    line_order: l.line_order,
    account_code: l.chart_of_accounts.code,
    account_name: l.chart_of_accounts.name,
    descripcion: l.line_description,
    debit: Number(l.debit ?? 0),
    credit: Number(l.credit ?? 0),
    tercero: l.clients?.name ?? l.suppliers?.legal_name ?? null,
    terceroClave: l.client_id
      ? `cliente:${l.client_id}`
      : l.supplier_id
        ? `proveedor:${l.supplier_id}`
        : null,
  }));

  return {
    id: String(cabecera.id),
    entry_number: Number(cabecera.entry_number),
    transaction_date: String(cabecera.transaction_date).slice(0, 10),
    record_date: String(cabecera.record_date).slice(0, 10),
    description: String(cabecera.description ?? ""),
    source_type: String(cabecera.source_type),
    source_id: (cabecera.source_id as string | null) ?? null,
    reference: (cabecera.reference as string | null) ?? null,
    reversal_reason: (cabecera.reversal_reason as string | null) ?? null,
    created_at: String(cabecera.created_at),
    lineas: lineasOrdenadas,
    total: Math.round(lineasOrdenadas.reduce((s, l) => s + l.debit, 0) * 100) / 100,
    reversa: vecino(reversa.data),
    reversadoPor: vecino(reversadoPor.data),
  };
}

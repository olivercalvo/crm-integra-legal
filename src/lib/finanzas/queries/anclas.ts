/**
 * Lecturas de las anclas de la cadena (075). Sólo lectura: las anclas las
 * graba la base al cerrar un período, nunca la app.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnclaGuardada } from "@/lib/finanzas/contabilidad/anclas";

type DB = SupabaseClient;

const COLS = "id, period_id, year, month, entry_number, hash, origen, anchored_at";

function normalizar(f: Record<string, unknown>): AnclaGuardada {
  return {
    id: String(f.id),
    period_id: (f.period_id as string | null) ?? null,
    year: f.year === null || f.year === undefined ? null : Number(f.year),
    month: f.month === null || f.month === undefined ? null : Number(f.month),
    entry_number: Number(f.entry_number),
    hash: String(f.hash),
    origen: f.origen as AnclaGuardada["origen"],
    anchored_at: String(f.anchored_at),
  };
}

/** Las anclas del bufete, de la más nueva a la más vieja. */
export async function listarAnclas(db: DB, tenantId: string): Promise<AnclaGuardada[]> {
  const { data, error } = await db
    .from("accounting_chain_anchors")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .order("anchored_at", { ascending: false });
  if (error) {
    console.error("[finanzas/anclas] listarAnclas failed", error);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(normalizar);
}

export async function getAncla(db: DB, tenantId: string, id: string): Promise<AnclaGuardada | null> {
  const { data } = await db
    .from("accounting_chain_anchors")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? normalizar(data as Record<string, unknown>) : null;
}

/** El ancla del último cierre de un período (un período puede cerrarse más de una vez). */
export async function anclaDelUltimoCierre(db: DB, tenantId: string, periodId: string): Promise<AnclaGuardada | null> {
  const { data } = await db
    .from("accounting_chain_anchors")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .eq("period_id", periodId)
    .order("anchored_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? normalizar(data as Record<string, unknown>) : null;
}

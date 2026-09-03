/**
 * LECTURA DE LOS PERÍODOS CONTABLES.
 *
 * `accounting_periods` existe desde la `023`; hasta hoy **ninguna pantalla la
 * leía**. Este archivo es el primer consumidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodoRow } from "@/lib/finanzas/contabilidad/periodos";

type DB = SupabaseClient;

/**
 * Los períodos del bufete, con cuántos asientos tiene cada uno.
 *
 * El conteo de asientos NO es decorativo: es lo que hace que cerrar un período
 * sea una decisión informada. Cerrar un mes con 40 asientos y cerrar uno vacío
 * son dos cosas distintas, y la segunda casi siempre es un error de tipeo en el
 * año.
 *
 * Se cuenta por `period_id`, que es la FK real, y no recalculando el mes desde
 * `transaction_date`: el período de un asiento lo resolvió el RPC al postearlo, y
 * volver a deducirlo acá podría dar otro resultado si alguna vez cambia esa
 * lógica.
 */
export async function listarPeriodos(
  db: DB,
  tenantId: string
): Promise<PeriodoRow[]> {
  const { data, error } = await db
    .from("accounting_periods")
    .select("id, year, month, status, closed_at, closed_by")
    .eq("tenant_id", tenantId)
    .order("year", { ascending: false })
    .order("month", { ascending: true });

  if (error) {
    console.error("[finanzas/queries] listarPeriodos failed", error);
    throw new Error("No se pudieron leer los períodos contables");
  }

  const filas = (data ?? []) as {
    id: string;
    year: number;
    month: number;
    status: "abierto" | "cerrado";
    closed_at: string | null;
    closed_by: string | null;
  }[];

  if (filas.length === 0) return [];

  const [conteos, nombres] = await Promise.all([
    contarAsientosPorPeriodo(db, tenantId),
    nombresDeUsuarios(db, filas.map((f) => f.closed_by)),
  ]);

  return filas.map((f) => ({
    ...f,
    closed_by_name: f.closed_by ? nombres.get(f.closed_by) ?? null : null,
    asientos: conteos.get(f.id) ?? 0,
  }));
}

/** Mapa `period_id` → cantidad de asientos. */
async function contarAsientosPorPeriodo(
  db: DB,
  tenantId: string
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("journal_entries")
    .select("period_id")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[finanzas/queries] contarAsientosPorPeriodo failed", error);
    // Se devuelve vacío en vez de romper la pantalla: sin el conteo la pantalla
    // sigue sirviendo, y el cierre lo valida igual el servidor.
    return new Map();
  }

  const m = new Map<string, number>();
  for (const r of (data ?? []) as { period_id: string }[]) {
    m.set(r.period_id, (m.get(r.period_id) ?? 0) + 1);
  }
  return m;
}

/** Mapa `user_id` → nombre, para mostrar quién cerró. */
async function nombresDeUsuarios(
  db: DB,
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter((i): i is string => Boolean(i))));
  if (unicos.length === 0) return new Map();

  const { data, error } = await db.from("users").select("id, full_name").in("id", unicos);
  if (error) {
    console.error("[finanzas/queries] nombresDeUsuarios failed", error);
    return new Map();
  }
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[]).map((u) => [
      u.id,
      u.full_name ?? "—",
    ])
  );
}

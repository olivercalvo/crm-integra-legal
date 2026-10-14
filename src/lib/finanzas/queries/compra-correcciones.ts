/**
 * Historial de versiones de una compra contabilizada (103).
 *
 * La versión 1 es el asiento ORIGINAL de la compra (el primer `gasto` del
 * libro). Cada fila de `compra_correcciones` es una versión más: el motivo, el
 * usuario, la fecha, el asiento nuevo, la reversión del anterior y qué cambió.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cambiosDeLaCorreccion, type FotoDeCompra } from "@/lib/finanzas/contabilidad/correccion-de-compra";

type DB = SupabaseClient;

export interface VersionDeCompra {
  version: number;
  asientoNumero: number | null;
  asientoFecha: string | null;
  /** La reversión que la dejó sin efecto, si la hubo. */
  reversadaPor: number | null;
  usuario: string | null;
  /** Cuándo se grabó (timestamptz). */
  el: string;
  /** null en la versión 1 (el alta). */
  motivo: string | null;
  cambios: string[];
  vigente: boolean;
}

export async function listarVersionesDeCompra(db: DB, tenantId: string, compraId: string): Promise<VersionDeCompra[]> {
  const [asientos, correcciones] = await Promise.all([
    db.from("journal_entries")
      .select("id, entry_number, transaction_date, created_at, created_by")
      .eq("tenant_id", tenantId).eq("source_type", "gasto").eq("source_id", compraId)
      .order("entry_number"),
    db.from("compra_correcciones")
      .select("version, entry_id, entry_anterior_id, reversal_entry_id, motivo, anterior, nueva, created_at, " +
        "usuario:users!compra_correcciones_created_by_fkey(full_name)")
      .eq("tenant_id", tenantId).eq("business_expense_id", compraId)
      .order("version"),
  ]);
  if (asientos.error) console.error("[finanzas/queries] listarVersionesDeCompra(asientos)", asientos.error);
  if (correcciones.error) console.error("[finanzas/queries] listarVersionesDeCompra(correcciones)", correcciones.error);
  type Asiento = { id: string; entry_number: number; transaction_date: string; created_at: string; created_by: string | null };
  type Correccion = {
    version: number; entry_id: string; entry_anterior_id: string; reversal_entry_id: string; motivo: string;
    anterior: FotoDeCompra; nueva: FotoDeCompra; created_at: string; usuario: { full_name: string } | null;
  };
  const lista = (asientos.data ?? []) as unknown as Asiento[];
  const corr = (correcciones.data ?? []) as unknown as Correccion[];
  if (lista.length === 0) return [];
  const porId = new Map(lista.map((a) => [a.id, a]));

  // La reversión de cada asiento corregido.
  const revIds = corr.map((c) => c.reversal_entry_id);
  const numeros = new Map<string, number>();
  if (revIds.length > 0) {
    const { data } = await db.from("journal_entries").select("id, entry_number").eq("tenant_id", tenantId).in("id", revIds);
    for (const r of (data ?? []) as { id: string; entry_number: number }[]) numeros.set(r.id, Number(r.entry_number));
  }
  const reversadoPor = new Map(corr.map((c) => [c.entry_anterior_id, numeros.get(c.reversal_entry_id) ?? null]));

  // Nombres de proveedor para «qué cambió».
  const ids = Array.from(new Set(corr.flatMap((c) => [c.anterior?.supplier_id, c.nueva?.supplier_id]).filter((x): x is string => !!x)));
  const nombres = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await db.from("suppliers").select("id, legal_name, trade_name").eq("tenant_id", tenantId).in("id", ids);
    for (const p of (data ?? []) as { id: string; legal_name: string; trade_name: string | null }[]) {
      nombres.set(p.id, p.trade_name?.trim() || p.legal_name);
    }
  }
  const nombre = (id: string | null | undefined) => (id ? nombres.get(id) ?? "otro proveedor" : "(sin proveedor)");

  // journal_entries.created_by no tiene FK: el nombre se busca aparte.
  const usuarios = new Map<string, string>();
  const uids = Array.from(new Set(lista.map((a) => a.created_by).filter((x): x is string => !!x)));
  if (uids.length > 0) {
    const { data } = await db.from("users").select("id, full_name").in("id", uids);
    for (const u of (data ?? []) as { id: string; full_name: string }[]) usuarios.set(u.id, u.full_name);
  }

  const original = corr.length > 0 ? porId.get(corr[0].entry_anterior_id) ?? lista[0] : lista[0];
  const versiones: VersionDeCompra[] = [{
    version: 1,
    asientoNumero: Number(original.entry_number),
    asientoFecha: String(original.transaction_date).slice(0, 10),
    reversadaPor: reversadoPor.get(original.id) ?? null,
    usuario: original.created_by ? usuarios.get(original.created_by) ?? null : null,
    el: original.created_at,
    motivo: null,
    cambios: [],
    vigente: false,
  }];
  for (const c of corr) {
    const a = porId.get(c.entry_id);
    versiones.push({
      version: c.version,
      asientoNumero: a ? Number(a.entry_number) : null,
      asientoFecha: a ? String(a.transaction_date).slice(0, 10) : null,
      reversadaPor: reversadoPor.get(c.entry_id) ?? null,
      usuario: c.usuario?.full_name ?? null,
      el: c.created_at,
      motivo: c.motivo,
      cambios: cambiosDeLaCorreccion(c.anterior ?? {}, c.nueva ?? {}, nombre),
      vigente: false,
    });
  }
  versiones[versiones.length - 1].vigente = versiones[versiones.length - 1].reversadaPor === null;
  return versiones;
}

/**
 * Server queries para observation_templates (Sprint QUOTES-POLISH).
 *
 * Patrón consistente con queries/catalogs.ts: admin client (bypass RLS) +
 * filter manual por tenant_id. Se invocan desde server components o route
 * handlers; nunca desde client components directamente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ObservationTemplate } from "@/lib/finanzas/types/observation-template";

type DB = SupabaseClient;

/**
 * Plantillas activas del tenant, ordenadas por sort_order (NULLS LAST) y
 * luego por name. Usado por el dropdown del form de cotización.
 */
export async function listObservationTemplatesActive(
  db: DB,
  tenantId: string
): Promise<ObservationTemplate[]> {
  const { data, error } = await db
    .from("observation_templates")
    .select("id, name, content, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("[finanzas/queries] listObservationTemplatesActive failed", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    content: row.content as string,
    sort_order: (row.sort_order as number | null) ?? null,
  }));
}

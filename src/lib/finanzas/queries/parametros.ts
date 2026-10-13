/**
 * Parámetros contables del bufete (migración `078`). Hoy: la tasa de ISR del
 * Estado de Resultado.
 *
 * 🔴 Leer NUNCA rompe un reporte: si la tabla no existe todavía (la 078 sin
 * aplicar), si el bufete no tiene fila o si la consulta falla, la tasa es el
 * `DEFAULT_ISR_RATE` de siempre (0). Un Estado de Resultado que no carga por un
 * parámetro es peor que uno con la tasa por defecto, y la línea del impuesto
 * dice qué tasa usó.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ISR_RATE } from "@/lib/finanzas/reports/accounting-reports";

type DB = SupabaseClient;

export async function getTasaIsr(db: DB, tenantId: string): Promise<number> {
  const { data, error } = await db
    .from("finanzas_parametros")
    .select("isr_rate")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    console.error("[finanzas/parametros] getTasaIsr failed, se usa la tasa por defecto", error);
    return DEFAULT_ISR_RATE;
  }
  const rate = Number((data as { isr_rate?: number | string } | null)?.isr_rate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_ISR_RATE;
}

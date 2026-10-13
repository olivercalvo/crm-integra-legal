import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * EL SALDO INICIAL DE LAS CUENTAS, CON APERTURA (100, 07/10/2026).
 *
 * Hasta que el bufete registra su asiento de apertura, los reportes arrancan de
 * `chart_of_accounts.saldo_inicial`. Desde la PRIMERA apertura (vigente o
 * reversada) ese número deja de sumar en todos lados: los saldos al corte están
 * en el libro, y sumar los dos los contaría dos veces. No vuelve a contar si la
 * apertura se reversa: entre la reversión y la apertura nueva el saldo es el del
 * libro (y la reversión lleva la misma fecha que la apertura, 101).
 *
 * 🔒 Una sola regla para las tres fuentes que lo leen (contable, Mayor y
 * antigüedad). `apertura-registrada.test.ts` falla si alguna vuelve a leer
 * `saldo_inicial` sin pasar por acá.
 */
export async function aperturaRegistrada(db: SupabaseClient, tenantId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from("aperturas").select("id").eq("tenant_id", tenantId).limit(1);
    // Antes de la 100 la tabla no existe: no hay apertura.
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/** El `saldo_inicial` que cuenta: 0 desde que hay apertura. */
export function saldoInicialEfectivo(valor: number | string | null | undefined, conApertura: boolean): number {
  if (conApertura) return 0;
  return Math.round((Number(valor ?? 0) + Number.EPSILON) * 100) / 100;
}

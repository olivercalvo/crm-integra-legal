/**
 * FUENTE DE DATOS de los reportes contables (Balance General y Estado de
 * Resultado). Paso 2 del plan contable — ver docs/finanzas/roadmap-contable.md §10.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ES EL ÚNICO ARCHIVO A CAMBIAR EN EL PASO 3
 * ─────────────────────────────────────────────────────────────────────────────
 * Hoy el saldo de cada cuenta ES su `saldo_inicial` (el puente que armó el
 * Paso 1a: el saldo de apertura vive como columna en chart_of_accounts).
 *
 * Cuando exista el motor de posteo del ledger, el saldo pasa a ser
 * `saldo_inicial + Σ movimientos de journal_entry_lines` para el período. Ese
 * cambio se hace acá dentro: `ReportAccount` no cambia de forma, así que
 * `accounting-reports.ts` (armado puro) y las páginas de UI quedan intactas.
 *
 * Cuando eso pase, además, el saldo de apertura debería convertirse en un
 * asiento de apertura (`source_type='manual'`) y esta función dejaría de leer
 * `saldo_inicial` para leerlo del ledger como cualquier otro movimiento.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportAccount } from "@/lib/finanzas/reports/accounting-reports";

type DB = SupabaseClient;

/** Solo estas columnas hacen falta para reportar. */
const SELECT_COLS = "code, name, account_type, subcategoria, saldo_inicial";

/**
 * Trae las cuentas ACTIVAS del tenant con su saldo para reportar.
 *
 * Filtra `active = true` a propósito: las 34 cuentas viejas de QuickBooks
 * quedaron desactivadas cuando se cargó el plan de 62 cuentas de Josuar, y
 * traerlas ensuciaría los reportes con renglones en 0 que él no reconoce.
 *
 * `saldo_inicial` es `numeric` en BD: se fuerza a number porque PostgREST puede
 * devolverlo como string y una suma con strings concatena en vez de sumar.
 */
export async function loadReportAccounts(
  db: DB,
  tenantId: string
): Promise<ReportAccount[]> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("code");

  if (error) {
    console.error("[finanzas/reports] loadReportAccounts failed", error);
    throw new Error("No se pudieron leer las cuentas del plan contable");
  }

  return (data ?? []).map((raw) => {
    const r = raw as unknown as {
      code: string;
      name: string;
      account_type: ReportAccount["account_type"];
      subcategoria: ReportAccount["subcategoria"];
      saldo_inicial: number | string | null;
    };
    return {
      code: r.code,
      name: r.name,
      account_type: r.account_type,
      subcategoria: r.subcategoria,
      // Paso 3: acá se suma el movimiento del ledger.
      saldo: Number(r.saldo_inicial ?? 0),
    };
  });
}

/**
 * Server queries del Plan de Cuentas (chart_of_accounts).
 *
 * Patrón consistente con el resto de /finanzas: admin client (bypass RLS) +
 * filter manual por tenant_id. Se invocan desde server components o route
 * handlers, nunca desde client components directamente.
 *
 * NOTA: `queries/catalogs.ts` ya expone `listAccountsActive()` (solo activas,
 * campos mínimos) para los comboboxes de facturas/cotizaciones. Este módulo es
 * para la PANTALLA DE GESTIÓN: trae activas + inactivas y todos los campos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountType,
  ChartAccountRow,
} from "@/lib/finanzas/types/chart-of-account";
import type { ExistingAccountInfo } from "@/lib/finanzas/import/chart-of-accounts-mapping";

type DB = SupabaseClient;

const SELECT_COLS =
  "id, code, name, account_type, subcategoria, saldo_inicial, account_name_qb, description, is_trust_pass_through, is_system, active";

/**
 * Normaliza una fila cruda a ChartAccountRow. `saldo_inicial` es numeric en BD:
 * PostgREST lo devuelve como number, pero lo forzamos igual para que la UI
 * pueda hacer aritmética/toFixed sin defenderse de un string.
 */
function toRow(raw: Record<string, unknown>): ChartAccountRow {
  return {
    ...(raw as unknown as ChartAccountRow),
    saldo_inicial: Number(raw.saldo_inicial ?? 0),
  };
}

/**
 * Lista TODAS las cuentas del tenant (activas e inactivas), ordenadas por
 * código. La agrupación por tipo la hace la UI con ACCOUNT_TYPE_ORDER.
 */
export async function listChartAccounts(
  db: DB,
  tenantId: string
): Promise<ChartAccountRow[]> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .order("code");

  if (error) {
    console.error("[finanzas/queries] listChartAccounts failed", error);
    return [];
  }
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

/** Detalle de una cuenta por id (con tenant guard). null si no existe. */
export async function getChartAccountById(
  db: DB,
  tenantId: string,
  id: string
): Promise<ChartAccountRow | null> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/queries] getChartAccountById failed", error);
    return null;
  }
  return data ? toRow(data as Record<string, unknown>) : null;
}

/**
 * Busca VARIAS cuentas por código en una sola query. La usa la carga masiva
 * para decidir, por fila, si toca crear o actualizar — sin hacer un round trip
 * por fila.
 *
 * Devuelve un Map código → info. Incluye `description` y `active` porque el
 * commit los tiene que REENVIAR en el update: el PATCH es reemplazo total y
 * omitirlos borraría la descripción y podría reactivar una cuenta desactivada.
 */
export async function findChartAccountsByCodes(
  db: DB,
  tenantId: string,
  codes: string[]
): Promise<Map<string, ExistingAccountInfo>> {
  const result = new Map<string, ExistingAccountInfo>();
  if (codes.length === 0) return result;

  // Chunk para no armar una URL gigante con `in.(...)` si algún día llegan
  // cientos de códigos (PostgREST los manda en la query string).
  const CHUNK = 200;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const slice = codes.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("chart_of_accounts")
      .select("id, code, description, active, is_system")
      .eq("tenant_id", tenantId)
      .in("code", slice);

    if (error) {
      console.error("[finanzas/queries] findChartAccountsByCodes failed", error);
      throw error;
    }

    for (const row of data ?? []) {
      const r = row as {
        id: string;
        code: string;
        description: string | null;
        active: boolean;
        is_system: boolean;
      };
      result.set(r.code, {
        id: r.id,
        description: r.description ?? null,
        active: r.active === true,
        is_system: r.is_system === true,
      });
    }
  }

  return result;
}

/**
 * Busca una cuenta por código dentro del tenant. Se usa para el chequeo de
 * unicidad antes de insertar/cambiar el código. Devuelve los campos mínimos
 * necesarios para el guard (id + is_system).
 */
export async function findChartAccountByCode(
  db: DB,
  tenantId: string,
  code: string
): Promise<{ id: string; code: string; account_type: AccountType; is_system: boolean } | null> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("id, code, account_type, is_system")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/queries] findChartAccountByCode failed", error);
    return null;
  }
  return (data as { id: string; code: string; account_type: AccountType; is_system: boolean } | null) ?? null;
}

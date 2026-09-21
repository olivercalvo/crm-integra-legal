/**
 * Lecturas de `supplier_payments` (Bloque 3, 048) para la sección "Pagos" del
 * detalle de la compra y para la reversión. Espejo de `queries/payments.ts`
 * del lado cobro, sin N:M: un pago es de UNA compra.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AsientoDeCobro, ReversionDeCobro } from "@/lib/finanzas/types/payment";
import type { SupplierPaymentForExpense, SupplierPaymentRow } from "@/lib/finanzas/types/supplier-payment";
import { cargarAsientosPorOrigen } from "@/lib/finanzas/queries/payments";
import { SOURCE_TYPE_PAGO_PROVEEDOR } from "@/lib/finanzas/contabilidad/asiento-tesoreria";

type DB = SupabaseClient;

function num(v: number | string | null | undefined): number {
  return v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);
}

const COLS =
  "id, business_expense_id, kind, payment_number, payment_date, amount, method, " +
  "payment_account_code, reference, notes, status, created_at, created_by";

type Raw = Omit<SupplierPaymentRow, "amount"> & { amount: number | string };

function aFila(r: Raw): SupplierPaymentRow {
  return { ...r, amount: num(r.amount) };
}

export async function getSupplierPayment(
  db: DB,
  tenantId: string,
  id: string
): Promise<SupplierPaymentRow | null> {
  const { data, error } = await db
    .from("supplier_payments")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? aFila(data as unknown as Raw) : null;
}

/** El asiento de UN pago a proveedor, o null si no está en el libro. */
export async function getAsientoDePagoProveedor(
  db: DB,
  tenantId: string,
  pagoId: string
): Promise<AsientoDeCobro | null> {
  const mapa = await cargarAsientosPorOrigen(db, tenantId, SOURCE_TYPE_PAGO_PROVEEDOR, [pagoId]);
  return mapa.get(pagoId) ?? null;
}

/**
 * Los pagos de una compra, más nuevos primero, con su asiento (para ofrecer
 * Reversar), su reversión si la hay (para dibujarlos tachados), el nombre del
 * banco y quién los registró. Los saldos heredados salen con `asiento: null`
 * y `kind: 'migrated_balance'`: la pantalla los muestra como lo que son.
 */
export async function getSupplierPaymentsForExpense(
  db: DB,
  tenantId: string,
  expenseId: string
): Promise<SupplierPaymentForExpense[]> {
  const { data, error } = await db
    .from("supplier_payments")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .eq("business_expense_id", expenseId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[finanzas/queries] getSupplierPaymentsForExpense failed", error);
    return [];
  }
  const filas = ((data ?? []) as unknown as Raw[]).map(aFila);
  if (filas.length === 0) return [];

  const ids = filas.map((f) => f.id);
  const [asientos, { data: espejos }, { data: bancos }, userMap] = await Promise.all([
    cargarAsientosPorOrigen(db, tenantId, SOURCE_TYPE_PAGO_PROVEEDOR, ids),
    // El espejo de un pago reversado: source_type 'reversion' con el mismo source_id.
    db
      .from("journal_entries")
      .select("source_id, entry_number, transaction_date, reversal_reason, created_by, reverses_entry_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("source_type", "reversion")
      .in("source_id", ids),
    db
      .from("chart_of_accounts")
      .select("code, name")
      .eq("tenant_id", tenantId)
      .in("code", Array.from(new Set(filas.map((f) => f.payment_account_code).filter((c): c is string => !!c)))),
    nombresDeUsuarios(db, filas.map((f) => f.created_by)),
  ]);

  type Espejo = {
    source_id: string;
    entry_number: number;
    transaction_date: string;
    reversal_reason: string | null;
    created_by: string | null;
    reverses_entry_id: string | null;
    created_at: string;
  };
  const espejoPorPago = new Map<string, Espejo>();
  for (const e of (espejos ?? []) as Espejo[]) espejoPorPago.set(e.source_id, e);
  // El número del asiento original reversado viene del mapa de asientos.
  const bancoPorCodigo = new Map(((bancos ?? []) as { code: string; name: string }[]).map((b) => [b.code, b.name]));

  const reversores = await nombresDeUsuarios(
    db,
    Array.from(espejoPorPago.values()).map((e) => e.created_by)
  );

  return filas.map((f) => {
    const espejo = espejoPorPago.get(f.id);
    const asiento = asientos.get(f.id) ?? null;
    const reversion: ReversionDeCobro | null =
      espejo && f.status === "anulado"
        ? {
            entry_number: Number(espejo.entry_number),
            reversed_entry_number: asiento?.entry_number ?? 0,
            reason: espejo.reversal_reason ?? "",
            reversed_at: espejo.created_at,
            reversed_by_name: espejo.created_by ? reversores[espejo.created_by] ?? null : null,
          }
        : null;
    return {
      ...f,
      created_by_name: f.created_by ? userMap[f.created_by] ?? null : null,
      bank_name: f.payment_account_code ? bancoPorCodigo.get(f.payment_account_code) ?? null : null,
      // Un pago anulado ya no se reversa: su asiento no se ofrece.
      asiento: f.status === "anulado" ? null : asiento,
      reversion,
    };
  });
}

async function nombresDeUsuarios(db: DB, ids: (string | null)[]): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(ids.filter((id): id is string => !!id)));
  const mapa: Record<string, string> = {};
  if (unicos.length === 0) return mapa;
  const { data } = await db.from("users").select("id, full_name").in("id", unicos);
  for (const u of data ?? []) mapa[u.id as string] = (u.full_name as string) ?? "";
  return mapa;
}

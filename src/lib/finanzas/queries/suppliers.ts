/**
 * Queries server-side de proveedores.
 * Patrón del repo: admin client (bypass RLS) + filtro manual por `tenant_id`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupplierListItem, SupplierRow } from "@/lib/finanzas/types/supplier";

type DB = SupabaseClient;

const COLS =
  "id, tenant_id, supplier_number, legal_name, trade_name, ruc, dv, address, phone, email, payment_terms_days, active, notes, created_by, created_at, updated_at";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ListSuppliersParams {
  /** null = todos; true/false filtra por activo. */
  active?: boolean | null;
  /** Busca en razón social, razón comercial y RUC. */
  search?: string | null;
}

/**
 * Listado con el resumen de gastos de cada proveedor.
 *
 * Los totales se agregan en la app y no en SQL a propósito: son pocos
 * proveedores y así el listado no depende de una vista que después haya que
 * mantener en dos bases.
 */
export async function listSuppliers(
  db: DB,
  tenantId: string,
  params: ListSuppliersParams = {}
): Promise<SupplierListItem[]> {
  let q = db.from("suppliers").select(COLS).eq("tenant_id", tenantId);

  if (params.active === true) q = q.eq("active", true);
  if (params.active === false) q = q.eq("active", false);

  const term = params.search?.trim();
  if (term) {
    const like = `%${term}%`;
    q = q.or(`legal_name.ilike.${like},trade_name.ilike.${like},ruc.ilike.${like}`);
  }

  const { data, error } = await q.order("supplier_number");
  if (error) {
    console.error("[finanzas/suppliers] listSuppliers failed", error);
    throw new Error("No se pudieron leer los proveedores");
  }

  const filas = (data ?? []) as unknown as SupplierRow[];
  if (filas.length === 0) return [];

  const { data: gastos } = await db
    .from("business_expenses")
    .select("supplier_id, total, status")
    .eq("tenant_id", tenantId)
    .not("supplier_id", "is", null);

  const resumen = new Map<string, { count: number; pending: number }>();
  for (const g of (gastos ?? []) as {
    supplier_id: string;
    total: number | string;
    status: string;
  }[]) {
    const r = resumen.get(g.supplier_id) ?? { count: 0, pending: 0 };
    r.count += 1;
    if (g.status === "pendiente_pago") r.pending += Number(g.total);
    resumen.set(g.supplier_id, r);
  }

  return filas.map((s) => {
    const r = resumen.get(s.id);
    return {
      ...s,
      expense_count: r?.count ?? 0,
      pending_total: round2(r?.pending ?? 0),
    };
  });
}

export async function getSupplier(
  db: DB,
  tenantId: string,
  id: string
): Promise<SupplierRow | null> {
  const { data, error } = await db
    .from("suppliers")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/suppliers] getSupplier failed", error);
    return null;
  }
  return (data as unknown as SupplierRow) ?? null;
}

/** Opciones para el selector del formulario de gastos. Solo los activos. */
export interface SupplierOption {
  id: string;
  supplier_number: string;
  legal_name: string;
  trade_name: string | null;
  payment_terms_days: number;
}

export async function listSupplierOptions(
  db: DB,
  tenantId: string
): Promise<SupplierOption[]> {
  const { data, error } = await db
    .from("suppliers")
    .select("id, supplier_number, legal_name, trade_name, payment_terms_days")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("legal_name");

  if (error) {
    console.error("[finanzas/suppliers] listSupplierOptions failed", error);
    return [];
  }
  return (data ?? []) as unknown as SupplierOption[];
}

/**
 * Proveedores que comparten RUC con otro.
 *
 * La base NO tiene UNIQUE sobre el RUC —un UNIQUE haría fallar la migración en
 * producción si dos nombres lo compartieran— así que el duplicado se detecta acá
 * y se avisa en pantalla. Unirlos es decisión de una persona.
 */
export async function proveedoresConRucRepetido(
  db: DB,
  tenantId: string
): Promise<Map<string, string[]>> {
  const { data } = await db
    .from("suppliers")
    .select("id, ruc, supplier_number")
    .eq("tenant_id", tenantId)
    .not("ruc", "is", null);

  const porRuc = new Map<string, { id: string; supplier_number: string }[]>();
  for (const s of (data ?? []) as { id: string; ruc: string; supplier_number: string }[]) {
    const clave = s.ruc.trim().toLowerCase();
    if (!clave) continue;
    porRuc.set(clave, [...(porRuc.get(clave) ?? []), s]);
  }

  const repetidos = new Map<string, string[]>();
  porRuc.forEach((grupo) => {
    if (grupo.length < 2) return;
    for (const s of grupo) {
      repetidos.set(
        s.id,
        grupo.filter((o: { id: string }) => o.id !== s.id).map((o: { supplier_number: string }) => o.supplier_number)
      );
    }
  });
  return repetidos;
}

/**
 * Junta lo que hace falta para armar el asiento de una compra.
 *
 * Dos consultas y un cruce: `expense_lines.chart_account_code` es un **FK
 * LÓGICO** (sin constraint, igual que lo era en `business_expenses`), así que
 * PostgREST no puede seguirlo con un embed. Se leen las cuentas aparte.
 *
 * ⚠️ `active` y `account_type` se leen **en el momento de registrar**, no se
 * cachean: una cuenta que se desactivó ayer tiene que rechazar hoy.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountType } from "@/lib/finanzas/types/chart-of-account";
import { esTipoValidoParaGasto } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import type {
  CompraParaAsiento,
  LineaCompraParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-compra";

type DB = SupabaseClient;

interface FilaLinea {
  line_order: number;
  description: string;
  amount: number | string | null;
  tax_amount: number | string | null;
  chart_account_code: string | null;
}

function num(v: number | string | null): number {
  return v === null ? 0 : typeof v === "number" ? v : Number(v);
}

/**
 * Devuelve la compra lista para `construirAsientoDeCompra()`, o `null` si no
 * existe.
 *
 * 🔑 **`cuenta_valida` usa el MISMO predicado que el selector y que
 * `validarCuentaDeGasto`**: existe + `active` + un tipo que puede recibir un
 * desembolso (`esTipoValidoParaGasto`). Los tres salen de
 * `cuentas-de-gasto.ts`, así que no pueden divergir — que es exactamente el bug
 * que apareció el 03/09, cuando el selector filtraba `account_type='expense'` y
 * no se podía comprar una computadora.
 */
export async function cargarCompraParaAsiento(
  db: DB,
  tenantId: string,
  compraId: string
): Promise<CompraParaAsiento | null> {
  const { data: be, error: errBe } = await db
    .from("business_expenses")
    .select("id, expense_date, description, total, supplier_name")
    .eq("tenant_id", tenantId)
    .eq("id", compraId)
    .maybeSingle();

  if (errBe) throw errBe;
  if (!be) return null;

  const { data: filas, error: errLin } = await db
    .from("expense_lines")
    .select("line_order, description, amount, tax_amount, chart_account_code")
    .eq("tenant_id", tenantId)
    .eq("business_expense_id", compraId)
    .order("line_order", { ascending: true });

  if (errLin) throw errLin;
  const crudas = (filas ?? []) as unknown as FilaLinea[];

  const codigos = Array.from(
    new Set(crudas.map((l) => l.chart_account_code).filter((x): x is string => !!x))
  );

  /** Las cuentas que pasan el predicado completo, no solo las que existen. */
  const validas = new Set<string>();
  if (codigos.length > 0) {
    const { data: cta, error: errCta } = await db
      .from("chart_of_accounts")
      .select("code, active, account_type")
      .eq("tenant_id", tenantId)
      .in("code", codigos);
    if (errCta) throw errCta;
    for (const c of (cta ?? []) as {
      code: string;
      active: boolean;
      account_type: AccountType;
    }[]) {
      if (c.active && esTipoValidoParaGasto(c.account_type)) validas.add(c.code);
    }
  }

  const lineas: LineaCompraParaAsiento[] = crudas.map((l) => ({
    line_order: l.line_order,
    description: l.description,
    amount: num(l.amount),
    tax_amount: num(l.tax_amount),
    chart_account_code: l.chart_account_code,
    cuenta_valida: l.chart_account_code !== null && validas.has(l.chart_account_code),
  }));

  const row = be as unknown as {
    id: string;
    expense_date: string;
    description: string;
    total: number | string;
    supplier_name: string | null;
  };

  return {
    id: row.id,
    expense_date: row.expense_date,
    description: row.description,
    total: num(row.total),
    supplier_name: row.supplier_name,
    lineas,
  };
}

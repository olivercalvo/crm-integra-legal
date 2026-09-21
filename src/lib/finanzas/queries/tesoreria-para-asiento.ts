/**
 * Junta lo que hace falta para armar los asientos de tesorería.
 *
 * ⚠️ `payment_account_code` es un **FK LÓGICO** en las dos tablas
 * (`payments` y `business_expenses`), igual que `expense_lines.
 * chart_account_code`: `chart_of_accounts` tiene clave compuesta
 * `(tenant_id, code)` y PostgREST no la sigue. Se lee la cuenta aparte y se
 * cruza acá.
 *
 * 🔴 Estas funciones leen **`payments`**, la tabla del módulo FINANZAS. NO leen
 * `client_payments`, que es el cobro a nivel caso del módulo Legal y **no va al
 * libro contable**. Ver el encabezado de `asiento-tesoreria.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  esCuentaDeBancoValida,
  type CobroParaAsiento,
  type PagoProveedorParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-tesoreria";

type DB = SupabaseClient;

function num(v: number | string | null | undefined): number {
  return v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);
}

/** Lee la cuenta del plan y contesta si sirve como banco. */
async function bancoValido(
  db: DB,
  tenantId: string,
  code: string | null
): Promise<boolean> {
  if (!code) return false;
  const { data } = await db
    .from("chart_of_accounts")
    .select("code, name, account_type, active")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();
  return esCuentaDeBancoValida(
    data as { code: string; name: string; account_type: string; active: boolean } | null
  );
}

/**
 * El cobro, con las facturas a las que se aplicó.
 *
 * Los números de factura son para la DESCRIPCIÓN del asiento, no para el
 * cálculo: el monto del asiento es `payments.amount`, no la suma de las
 * aplicaciones. Son iguales hoy porque `createPayment` aplica el total a una
 * sola factura, pero si algún día un cobro queda parcialmente sin aplicar
 * (`amount_unapplied > 0`), el asiento tiene que seguir reflejando **la plata
 * que entró al banco**, no la parte que se imputó.
 */
export async function cargarCobroParaAsiento(
  db: DB,
  tenantId: string,
  paymentId: string
): Promise<CobroParaAsiento | null> {
  const { data: pay, error } = await db
    .from("payments")
    .select(
      "id, payment_number, payment_date, amount, payment_account_code, client:clients!payments_client_id_fkey(name)"
    )
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) throw error;
  if (!pay) return null;

  const row = pay as unknown as {
    id: string;
    payment_number: string | null;
    payment_date: string;
    amount: number | string;
    payment_account_code: string | null;
    client?: { name?: string } | { name?: string }[] | null;
  };

  const { data: apps, error: errApps } = await db
    .from("payment_applications")
    .select("invoice:invoices!payment_applications_invoice_id_fkey(invoice_number)")
    .eq("tenant_id", tenantId)
    .eq("payment_id", paymentId);
  if (errApps) throw errApps;

  const facturas = ((apps ?? []) as unknown as {
    invoice?: { invoice_number?: string } | { invoice_number?: string }[] | null;
  }[])
    .map((a) => {
      const inv = Array.isArray(a.invoice) ? a.invoice[0] : a.invoice;
      return inv?.invoice_number ?? null;
    })
    .filter((n): n is string => !!n);

  const cli = Array.isArray(row.client) ? row.client[0] : row.client;

  return {
    id: row.id,
    payment_number: row.payment_number ?? null,
    payment_date: row.payment_date,
    amount: num(row.amount),
    client_name: cli?.name ?? null,
    facturas,
    payment_account_code: row.payment_account_code,
    banco_valido: await bancoValido(db, tenantId, row.payment_account_code),
  };
}

/**
 * El pago a proveedor YA INSERTADO (`supplier_payments`, 048), releído con su
 * compra, para armar su asiento. Simétrico de `cargarCobroParaAsiento`: se
 * llama después del INSERT y antes del posteo; si el posteo falla,
 * `createSupplierPayment` hace el DELETE compensatorio.
 *
 * El banco sale del PAGO (`supplier_payments.payment_account_code`).
 * `business_expenses` no tiene esa columna (FND-009).
 */
export async function cargarPagoProveedorParaAsiento(
  db: DB,
  tenantId: string,
  pagoId: string
): Promise<PagoProveedorParaAsiento | null> {
  const { data: pago, error } = await db
    .from("supplier_payments")
    .select(
      "id, payment_number, payment_date, amount, payment_account_code, business_expense_id, " +
        "compra:business_expenses!supplier_payments_business_expense_id_fkey(id, description, supplier_name, supplier_invoice_number)"
    )
    .eq("tenant_id", tenantId)
    .eq("id", pagoId)
    .maybeSingle();

  if (error) throw error;
  if (!pago) return null;

  type Compra = { id: string; description: string; supplier_name: string | null; supplier_invoice_number: string | null };
  const row = pago as unknown as {
    id: string;
    payment_number: string | null;
    payment_date: string;
    amount: number | string;
    payment_account_code: string | null;
    business_expense_id: string;
    compra?: Compra | Compra[] | null;
  };
  const compra = Array.isArray(row.compra) ? row.compra[0] : row.compra;

  return {
    pago_id: row.id,
    payment_number: row.payment_number ?? null,
    compra_id: row.business_expense_id,
    compra_description: compra?.description ?? "",
    supplier_name: compra?.supplier_name ?? null,
    supplier_invoice_number: compra?.supplier_invoice_number ?? null,
    payment_date: row.payment_date,
    amount: num(row.amount),
    payment_account_code: row.payment_account_code,
    banco_valido: await bancoValido(db, tenantId, row.payment_account_code),
  };
}

/**
 * Las cuentas que la pantalla ofrece como banco.
 *
 * ⚠️ Es una LISTA, no un guard, y tienen sesgos opuestos (SOP-024 regla 3): esto
 * es opinado y corto —los activos activos que parecen caja o banco— mientras que
 * `esCuentaDeBancoValida` acepta cualquier activo activo. La discrepancia es
 * deliberada: una cuenta de activo que no esté en la lista igual pasa el guard
 * si alguien la manda a propósito, y eso solo se puede expresar si las dos no se
 * derivan una de la otra.
 */
export async function listarCuentasDeBanco(
  db: DB,
  tenantId: string
): Promise<{ code: string; name: string }[]> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, name, account_type, active")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("account_type", "asset")
    .order("code");
  if (error) throw error;

  return ((data ?? []) as { code: string; name: string }[]).filter((c) =>
    /banco|caja|efectivo/i.test(c.name)
  );
}

/**
 * LECTURAS del módulo de notas de crédito (E8, 01/10/2026): las facturas y las
 * compras ABIERTAS que una NC puede corregir, los listados y el saldo a favor
 * de una NC sin documento. Sólo lectura, con la sesión (RLS).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceKind } from "@/lib/finanzas/types/invoice";
import type { LineaDeCompraParaNc } from "@/lib/finanzas/contabilidad/asiento-nota-credito-compra";
import { cuentasDeTasas } from "@/lib/finanzas/queries/factura-para-asiento";
import { esTipoValidoParaGasto } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";
import { DE_PRUEBA } from "@/lib/finanzas/documentos-de-prueba";

type DB = SupabaseClient;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// ─────────────────────────────────────────────────────────────────────────────
// VENTA
// ─────────────────────────────────────────────────────────────────────────────

export interface LineaDeFacturaParaNc {
  id: string;
  line_order: number;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;
  tax_code_id: string | null;
  /** Cantidad ya acreditada por NC vigentes. */
  acreditado: number;
}

export interface FacturaAbiertaParaNc {
  id: string;
  invoice_number: string;
  invoice_kind: InvoiceKind;
  client_id: string;
  issue_date: string;
  /** Fecha de REGISTRO: la NC no puede registrarse antes. */
  accounting_date: string;
  balance_due: number;
  grand_total: number;
  lineas: LineaDeFacturaParaNc[];
}

/**
 * Las facturas que una NC puede corregir: emitidas, con saldo, y que no estén
 * a medio anular ante la DGI (estado intermedio D4, `fe_estado = 'canceled'`).
 * Con sus líneas y lo que cada una ya tiene acreditado, que es la MISMA cuenta
 * que hace el servidor (`acreditadoPorLineaDeFactura`).
 */
export async function facturasAbiertasParaNc(
  db: DB,
  tenantId: string,
  opciones: { invoiceId?: string | null } = {}
): Promise<FacturaAbiertaParaNc[]> {
  let q = db
    .from("invoices")
    .select("id, invoice_number, invoice_kind, client_id, issue_date, accounting_date, balance_due, grand_total, fe_estado")
    .eq("tenant_id", tenantId)
    .eq(DE_PRUEBA, false)
    .in("status", ["emitida", "parcialmente_pagada"])
    .gt("balance_due", 0.005)
    .order("issue_date", { ascending: true });
  if (opciones.invoiceId) q = q.eq("id", opciones.invoiceId);
  const { data, error } = await q;
  if (error) {
    console.error("[finanzas/notas-credito] facturasAbiertasParaNc failed", error);
    return [];
  }
  const facturas = ((data ?? []) as Record<string, unknown>[]).filter((f) => f.fe_estado !== "canceled");
  if (facturas.length === 0) return [];
  const ids = facturas.map((f) => String(f.id));

  const [{ data: lns }, { data: previas }] = await Promise.all([
    db
      .from("invoice_lines")
      .select("id, invoice_id, line_order, service_id, description, quantity, unit_price, tax_code, tax_rate, tax_code_id")
      .eq("tenant_id", tenantId)
      .in("invoice_id", ids)
      .order("line_order", { ascending: true }),
    db
      .from("credit_note_lines")
      .select("invoice_line_id, quantity, credit_notes!inner(invoice_id, status)")
      .eq("tenant_id", tenantId)
      .in("credit_notes.invoice_id", ids)
      .eq("credit_notes.status", "emitida"),
  ]);

  const acreditado = new Map<string, number>();
  for (const p of (previas ?? []) as { invoice_line_id: string | null; quantity: number | string }[]) {
    if (!p.invoice_line_id) continue;
    acreditado.set(p.invoice_line_id, (acreditado.get(p.invoice_line_id) ?? 0) + num(p.quantity));
  }
  const porFactura = new Map<string, LineaDeFacturaParaNc[]>();
  for (const l of (lns ?? []) as Record<string, unknown>[]) {
    const lista = porFactura.get(String(l.invoice_id)) ?? [];
    lista.push({
      id: String(l.id),
      line_order: num(l.line_order),
      service_id: (l.service_id as string | null) ?? null,
      description: String(l.description ?? ""),
      quantity: num(l.quantity),
      unit_price: num(l.unit_price),
      tax_code: String(l.tax_code ?? ""),
      tax_rate: num(l.tax_rate),
      tax_code_id: (l.tax_code_id as string | null) ?? null,
      acreditado: acreditado.get(String(l.id)) ?? 0,
    });
    porFactura.set(String(l.invoice_id), lista);
  }

  return facturas.map((f) => ({
    id: String(f.id),
    invoice_number: String(f.invoice_number ?? ""),
    invoice_kind: f.invoice_kind as InvoiceKind,
    client_id: String(f.client_id),
    issue_date: String(f.issue_date),
    accounting_date: String(f.accounting_date ?? f.issue_date),
    balance_due: num(f.balance_due),
    grand_total: num(f.grand_total),
    lineas: porFactura.get(String(f.id)) ?? [],
  }));
}

export interface NotaDeCreditoEnListado {
  id: string;
  credit_note_number: string;
  issue_date: string;
  accounting_date: string;
  status: string;
  fe_estado: string;
  grand_total: number;
  reason: string;
  client_name: string;
  invoice_id: string | null;
  invoice_number: string | null;
}

export async function listarNotasDeCredito(db: DB, tenantId: string): Promise<NotaDeCreditoEnListado[]> {
  // de-prueba-ok: listado de NC: las de prueba se ven con su badge
  const { data, error } = await db
    .from("credit_notes")
    .select(
      "id, credit_note_number, issue_date, accounting_date, status, fe_estado, grand_total, reason, invoice_id, " +
        "invoice:invoices!credit_notes_invoice_id_fkey(invoice_number), client:clients!credit_notes_client_id_fkey(name)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[finanzas/notas-credito] listarNotasDeCredito failed", error);
    return [];
  }
  type Uno<T> = T | T[] | null | undefined;
  const uno = <T,>(x: Uno<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    credit_note_number: String(r.credit_note_number),
    issue_date: String(r.issue_date),
    accounting_date: String(r.accounting_date ?? r.issue_date),
    status: String(r.status),
    fe_estado: String(r.fe_estado ?? "no_emitida"),
    grand_total: num(r.grand_total),
    reason: String(r.reason ?? ""),
    client_name: uno(r.client as Uno<{ name: string }>)?.name ?? "",
    invoice_id: (r.invoice_id as string | null) ?? null,
    invoice_number: uno(r.invoice as Uno<{ invoice_number: string }>)?.invoice_number ?? null,
  }));
}

export interface AplicacionDeNc {
  documento_id: string;
  documento_numero: string;
  amount_applied: number;
  created_at: string;
}

/**
 * El saldo a favor de una NC SIN documento (E8): su total menos lo aplicado.
 * Una NC con factura (o con compra) la acredita entera y no tiene saldo.
 */
export async function saldoDeNotaDeCredito(
  db: DB,
  tenantId: string,
  ncId: string,
  tipo: "venta" | "compra"
): Promise<{ aplicaciones: AplicacionDeNc[]; aplicado: number }> {
  const tabla = tipo === "venta" ? "credit_note_applications" : "supplier_credit_note_applications";
  const doc =
    tipo === "venta"
      ? "documento:invoices(id, invoice_number)"
      : "documento:business_expenses(id, description, purchase_number)";
  // de-prueba-ok: saldo de UNA nota de crédito, en su detalle
  const { data, error } = await db
    .from(tabla)
    .select(`amount_applied, created_at, ${doc}`)
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", ncId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[finanzas/notas-credito] saldoDeNotaDeCredito failed", error);
    return { aplicaciones: [], aplicado: 0 };
  }
  const aplicaciones = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const d = (Array.isArray(r.documento) ? r.documento[0] : r.documento) as Record<string, unknown> | null;
    return {
      documento_id: String(d?.id ?? ""),
      documento_numero: String(d?.invoice_number ?? d?.purchase_number ?? d?.description ?? ""),
      amount_applied: num(r.amount_applied),
      created_at: String(r.created_at),
    };
  });
  return { aplicaciones, aplicado: Math.round(aplicaciones.reduce((s, a) => s + a.amount_applied, 0) * 100) / 100 };
}

/** Facturas de un cliente con saldo, para aplicarles el saldo de una NC. */
export async function facturasConSaldoDelCliente(
  db: DB,
  tenantId: string,
  clientId: string
): Promise<{ id: string; numero: string; saldo: number }[]> {
  const { data } = await db
    .from("invoices")
    .select("id, invoice_number, balance_due")
    .eq("tenant_id", tenantId)
    .eq(DE_PRUEBA, false)
    .eq("client_id", clientId)
    .in("status", ["emitida", "parcialmente_pagada"])
    .gt("balance_due", 0.005)
    .order("issue_date", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
    id: String(f.id),
    numero: String(f.invoice_number),
    saldo: num(f.balance_due),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPRA
// ─────────────────────────────────────────────────────────────────────────────

export interface CompraAbiertaParaNc {
  id: string;
  numero: string;
  description: string;
  supplier_id: string;
  supplier_name: string | null;
  balance_due: number;
  lineas: LineaDeCompraParaNc[];
}

/**
 * Las compras que una NC de proveedor puede corregir: en el libro, con saldo y
 * con proveedor (E3: 200001 nunca sin tercero). Con sus líneas y lo que cada
 * una ya tiene acreditado por NC vigentes.
 */
export async function comprasAbiertasParaNc(
  db: DB,
  tenantId: string,
  opciones: { compraId?: string | null } = {}
): Promise<CompraAbiertaParaNc[]> {
  let q = db
    .from("business_expenses")
    .select("id, purchase_number, description, supplier_id, supplier_name, balance_due")
    .eq("tenant_id", tenantId)
    .not("supplier_id", "is", null)
    .neq("status", "pagado")
    .gt("balance_due", 0.005)
    .order("expense_date", { ascending: true });
  if (opciones.compraId) q = q.eq("id", opciones.compraId);
  const { data, error } = await q;
  if (error) {
    console.error("[finanzas/notas-credito] comprasAbiertasParaNc failed", error);
    return [];
  }
  const compras = (data ?? []) as Record<string, unknown>[];
  if (compras.length === 0) return [];
  const ids = compras.map((c) => String(c.id));

  const [{ data: asientos }, { data: lns }] = await Promise.all([
    db.from("journal_entries").select("source_id").eq("tenant_id", tenantId).eq("source_type", "gasto").in("source_id", ids),
    db
      .from("expense_lines")
      .select("id, business_expense_id, line_order, description, chart_account_code, amount, tax_rate, tax_amount, tax_code_id")
      .eq("tenant_id", tenantId)
      .in("business_expense_id", ids)
      .order("line_order", { ascending: true }),
  ]);
  const enElLibro = new Set(((asientos ?? []) as { source_id: string }[]).map((a) => a.source_id));
  const lineas = (lns ?? []) as Record<string, unknown>[];

  const lineIds = lineas.map((l) => String(l.id));
  const acreditado = new Map<string, { base: number; itbms: number }>();
  if (lineIds.length > 0) {
    const { data: ncl } = await db
      .from("supplier_credit_note_lines")
      .select("expense_line_id, amount, tax_amount, nota:supplier_credit_notes!inner(status)")
      .eq("tenant_id", tenantId)
      .in("expense_line_id", lineIds);
    for (const r of (ncl ?? []) as unknown as {
      expense_line_id: string;
      amount: number | string;
      tax_amount: number | string;
      nota: { status: string } | { status: string }[] | null;
    }[]) {
      const nota = Array.isArray(r.nota) ? r.nota[0] : r.nota;
      if (nota?.status !== "emitida") continue;
      const a = acreditado.get(r.expense_line_id) ?? { base: 0, itbms: 0 };
      a.base += num(r.amount);
      a.itbms += num(r.tax_amount);
      acreditado.set(r.expense_line_id, a);
    }
  }

  const tasas = await cuentasDeTasas(db, tenantId, lineas.map((l) => (l.tax_code_id as string | null) ?? null));
  const codigos = Array.from(new Set(lineas.map((l) => l.chart_account_code).filter((x): x is string => !!x)));
  const validas = new Set<string>();
  if (codigos.length > 0) {
    const { data: cta } = await db
      .from("chart_of_accounts")
      .select("code, active, account_type")
      .eq("tenant_id", tenantId)
      .in("code", codigos);
    for (const c of (cta ?? []) as { code: string; active: boolean; account_type: AccountType }[]) {
      if (c.active && esTipoValidoParaGasto(c.account_type)) validas.add(c.code);
    }
  }

  const porCompra = new Map<string, LineaDeCompraParaNc[]>();
  for (const l of lineas) {
    const tc = (l.tax_code_id as string | null) ?? null;
    const lista = porCompra.get(String(l.business_expense_id)) ?? [];
    lista.push({
      id: String(l.id),
      line_order: num(l.line_order),
      description: String(l.description ?? ""),
      chart_account_code: (l.chart_account_code as string | null) ?? null,
      amount: num(l.amount),
      tax_rate: num(l.tax_rate),
      tax_amount: num(l.tax_amount),
      tax_account: tc ? tasas.get(tc)?.account_code ?? null : null,
      tax_code: tc ? tasas.get(tc)?.code ?? null : null,
      tax_code_id: tc,
      acreditado_base: acreditado.get(String(l.id))?.base ?? 0,
      acreditado_itbms: acreditado.get(String(l.id))?.itbms ?? 0,
      cuenta_valida: l.chart_account_code !== null && validas.has(String(l.chart_account_code)),
    });
    porCompra.set(String(l.business_expense_id), lista);
  }

  return compras
    .filter((c) => enElLibro.has(String(c.id)))
    .map((c) => ({
      id: String(c.id),
      numero: String(c.purchase_number ?? ""),
      description: String(c.description ?? ""),
      supplier_id: String(c.supplier_id),
      supplier_name: (c.supplier_name as string | null) ?? null,
      balance_due: num(c.balance_due),
      lineas: porCompra.get(String(c.id)) ?? [],
    }));
}

export interface NcDeProveedorEnListado {
  id: string;
  credit_note_number: string;
  supplier_document_number: string;
  issue_date: string;
  status: string;
  grand_total: number;
  reason: string;
  supplier_name: string;
  business_expense_id: string | null;
  compra: string | null;
}

export async function listarNcDeProveedor(db: DB, tenantId: string): Promise<NcDeProveedorEnListado[]> {
  const { data, error } = await db
    .from("supplier_credit_notes")
    .select(
      "id, credit_note_number, supplier_document_number, issue_date, status, grand_total, reason, business_expense_id, " +
        "compra:business_expenses!supplier_credit_notes_business_expense_id_fkey(description, purchase_number), " +
        "proveedor:suppliers!supplier_credit_notes_supplier_id_fkey(legal_name, trade_name)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[finanzas/notas-credito] listarNcDeProveedor failed", error);
    return [];
  }
  type Uno<T> = T | T[] | null | undefined;
  const uno = <T,>(x: Uno<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const compra = uno(r.compra as Uno<{ description: string; purchase_number: string | null }>);
    const prov = uno(r.proveedor as Uno<{ legal_name: string; trade_name: string | null }>);
    return {
      id: String(r.id),
      credit_note_number: String(r.credit_note_number),
      supplier_document_number: String(r.supplier_document_number ?? ""),
      issue_date: String(r.issue_date),
      status: String(r.status),
      grand_total: num(r.grand_total),
      reason: String(r.reason ?? ""),
      supplier_name: prov ? prov.trade_name?.trim() || prov.legal_name : "",
      business_expense_id: (r.business_expense_id as string | null) ?? null,
      compra: compra ? compra.purchase_number || compra.description : null,
    };
  });
}

/** Compras de un proveedor con saldo y en el libro, para aplicarles el saldo de una NC. */
export async function comprasConSaldoDelProveedor(
  db: DB,
  tenantId: string,
  supplierId: string
): Promise<{ id: string; numero: string; saldo: number }[]> {
  const todas = await comprasAbiertasParaNc(db, tenantId);
  return todas
    .filter((c) => c.supplier_id === supplierId)
    .map((c) => ({ id: c.id, numero: c.numero || c.description, saldo: c.balance_due }));
}

/**
 * Datos del PDF del RECIBO DE CAJA (Bloque 2, 21/09/2026). Espejo de
 * `invoice-pdf-data.ts`:
 *
 *   fetchReceiptPdfBundle  → lee el cobro, su cliente, las facturas a las que se
 *                            aplicó, el banco, el asiento y la reversión si la hay.
 *   buildReceiptPdfPayload → lo que afecta VISUALMENTE al PDF (para el hash).
 *   buildReceiptDocumentProps → lo que dibuja `ReceiptDocument`.
 *
 * Un cobro reversado sigue teniendo recibo: el PDF sale con la banda
 * "REVERSADO" y el asiento espejo. Las facturas de un cobro reversado ya no
 * están en `payment_applications` (la 046 las borra): se leen de
 * `payment_reversals`, la foto de lo que se deshizo.
 *
 * 🔴 RUC y DV van en DOS campos, nunca concatenados (CLAUDE.md §5). Del cliente
 * el DV se llama `clients.digito_verificador`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReceiptPdfPayload } from "@/lib/finanzas/api/receipt-pdf-hash";
import type { ReceiptDocumentProps } from "@/lib/finanzas/pdf/ReceiptDocument";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/finanzas/types/payment";
import { SOURCE_TYPE_COBRO } from "@/lib/finanzas/contabilidad/asiento-tesoreria";

type DB = SupabaseClient;

type Uno<T> = T | T[] | null | undefined;
const uno = <T,>(x: Uno<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);

export interface ReceiptPdfBundle {
  payment: {
    id: string;
    payment_number: string;
    payment_date: string;
    amount: number;
    method: PaymentMethod;
    reference: string | null;
    notes: string | null;
    status: string;
    payment_account_code: string | null;
    created_by_name: string | null;
  };
  client: {
    name: string;
    client_number: string;
    tax_id: string | null;
    tax_id_type: string | null;
    digito_verificador: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  /** Las facturas aplicadas (una hoy; el modelo admite varias). */
  aplicaciones: {
    invoice_id: string;
    invoice_number: string;
    issue_date: string;
    grand_total: number;
    amount_applied: number;
    /** Saldo de la factura HOY (no al momento del cobro): null si está reversado. */
    balance_due: number | null;
  }[];
  banco: { code: string; name: string } | null;
  asiento: { entry_number: number; transaction_date: string } | null;
  reversion: { entry_number: number; reversed_at: string; reason: string } | null;
}

export async function fetchReceiptPdfBundle(
  db: DB,
  tenantId: string,
  paymentId: string
): Promise<ReceiptPdfBundle | null> {
  const { data: p, error } = await db
    .from("payments")
    .select(
      `
        id, payment_number, payment_date, amount, method, reference, notes, status,
        payment_account_code, created_by,
        client:clients!payments_client_id_fkey(
          name, client_number, tax_id, tax_id_type, ruc, digito_verificador, email, phone, address
        )
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/pdf] fetchReceiptPdfBundle failed", error);
    return null;
  }
  if (!p) return null;
  // Sin número no hay recibo: es un cobro anterior a la 047 en una base donde
  // no corrió el backfill. No se inventa un número.
  if (typeof p.payment_number !== "string" || !p.payment_number) return null;

  type Cliente = {
    name: string; client_number: string; tax_id: string | null; tax_id_type: string | null;
    ruc: string | null; digito_verificador: string | null; email: string | null; phone: string | null; address: string | null;
  };
  const c = uno(p.client as Uno<Cliente>);

  const [{ data: apps }, { data: revs }, { data: je }, banco, creador] = await Promise.all([
    db
      .from("payment_applications")
      .select("invoice_id, amount_applied, invoice:invoices!payment_applications_invoice_id_fkey(invoice_number, issue_date, grand_total, balance_due)")
      .eq("tenant_id", tenantId)
      .eq("payment_id", paymentId),
    db
      .from("payment_reversals")
      .select(
        "invoice_id, amount_applied, reason, reversed_at, " +
          "invoice:invoices!payment_reversals_invoice_id_fkey(invoice_number, issue_date, grand_total), " +
          "reversal:journal_entries!payment_reversals_reversal_entry_id_fkey(entry_number)"
      )
      .eq("tenant_id", tenantId)
      .eq("payment_id", paymentId),
    db
      .from("journal_entries")
      .select("entry_number, transaction_date")
      .eq("tenant_id", tenantId)
      .eq("source_type", SOURCE_TYPE_COBRO)
      .eq("source_id", paymentId)
      .maybeSingle(),
    p.payment_account_code
      ? db
          .from("chart_of_accounts")
          .select("code, name")
          .eq("tenant_id", tenantId)
          .eq("code", p.payment_account_code)
          .maybeSingle()
          .then((r) => (r.data as { code: string; name: string } | null) ?? null)
      : Promise.resolve(null),
    p.created_by
      ? db
          .from("users")
          .select("full_name")
          .eq("id", p.created_by)
          .maybeSingle()
          .then((r) => ((r.data?.full_name as string | null) ?? null))
      : Promise.resolve(null),
  ]);

  type Inv = { invoice_number: string; issue_date: string; grand_total: string | number; balance_due?: string | number };
  type App = { invoice_id: string; amount_applied: string | number; invoice: Uno<Inv> };
  type Rev = App & { reason: string; reversed_at: string; reversal: Uno<{ entry_number: number }> };

  const aplicaciones: ReceiptPdfBundle["aplicaciones"] = ((apps ?? []) as unknown as App[]).map((a) => {
    const inv = uno(a.invoice);
    return {
      invoice_id: a.invoice_id,
      invoice_number: inv?.invoice_number ?? "",
      issue_date: inv?.issue_date ?? "",
      grand_total: num(inv?.grand_total),
      amount_applied: num(a.amount_applied),
      balance_due: inv?.balance_due === undefined ? null : num(inv.balance_due),
    };
  });

  let reversion: ReceiptPdfBundle["reversion"] = null;
  for (const r of (revs ?? []) as unknown as Rev[]) {
    const inv = uno(r.invoice);
    aplicaciones.push({
      invoice_id: r.invoice_id,
      invoice_number: inv?.invoice_number ?? "",
      issue_date: inv?.issue_date ?? "",
      grand_total: num(inv?.grand_total),
      amount_applied: num(r.amount_applied),
      balance_due: null,
    });
    if (!reversion) {
      reversion = {
        entry_number: Number(uno(r.reversal)?.entry_number ?? 0),
        reversed_at: r.reversed_at,
        reason: r.reason,
      };
    }
  }
  aplicaciones.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number));

  return {
    payment: {
      id: p.id as string,
      payment_number: p.payment_number,
      payment_date: p.payment_date as string,
      amount: num(p.amount as string | number),
      method: p.method as PaymentMethod,
      reference: (p.reference as string | null) ?? null,
      notes: (p.notes as string | null) ?? null,
      status: p.status as string,
      payment_account_code: (p.payment_account_code as string | null) ?? null,
      created_by_name: creador,
    },
    client: {
      name: c?.name ?? "",
      client_number: c?.client_number ?? "",
      tax_id: c?.tax_id ?? c?.ruc ?? null,
      tax_id_type: c?.tax_id_type ?? null,
      digito_verificador: c?.digito_verificador ?? null,
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      address: c?.address ?? null,
    },
    aplicaciones,
    banco,
    asiento: je
      ? { entry_number: Number(je.entry_number), transaction_date: je.transaction_date as string }
      : null,
    reversion,
  };
}

/** Lo que afecta al PDF. NO entra el saldo actual de la factura (cambia con cada cobro y no es parte del recibo). */
export function buildReceiptPdfPayload(b: ReceiptPdfBundle): ReceiptPdfPayload {
  return {
    payment_number: b.payment.payment_number,
    payment_date: b.payment.payment_date,
    amount: b.payment.amount,
    method: b.payment.method,
    reference: b.payment.reference,
    notes: b.payment.notes,
    status: b.payment.status,
    client: {
      name: b.client.name,
      client_number: b.client.client_number,
      tax_id: b.client.tax_id,
      tax_id_type: b.client.tax_id_type,
      digito_verificador: b.client.digito_verificador,
    },
    aplicaciones: b.aplicaciones.map((a) => ({
      invoice_number: a.invoice_number,
      issue_date: a.issue_date,
      grand_total: a.grand_total,
      amount_applied: a.amount_applied,
    })),
    banco: b.banco ? { code: b.banco.code, name: b.banco.name } : null,
    asiento: b.asiento ? b.asiento.entry_number : null,
    reversion: b.reversion
      ? { entry_number: b.reversion.entry_number, reversed_at: b.reversion.reversed_at, reason: b.reversion.reason }
      : null,
  };
}

export function buildReceiptDocumentProps(
  b: ReceiptPdfBundle,
  opts: { generated_at: Date; generated_by_name: string | null }
): ReceiptDocumentProps {
  const d = opts.generated_at;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    payment_number: b.payment.payment_number,
    payment_date: b.payment.payment_date,
    amount: b.payment.amount,
    method_label: PAYMENT_METHOD_LABEL[b.payment.method] ?? b.payment.method,
    reference: b.payment.reference,
    notes: b.payment.notes,
    reversado: b.payment.status === "anulado" || !!b.reversion,
    client: b.client,
    aplicaciones: b.aplicaciones,
    banco: b.banco,
    asiento: b.asiento,
    reversion: b.reversion,
    registrado_por: b.payment.created_by_name,
    generated_at_label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    generated_by_label: opts.generated_by_name ?? "",
  };
}

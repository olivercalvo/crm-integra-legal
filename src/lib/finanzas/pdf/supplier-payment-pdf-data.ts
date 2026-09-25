/**
 * Datos del PDF del COMPROBANTE DE EGRESO (Bloque 3, 21/09/2026). Espejo de
 * `receipt-pdf-data.ts`:
 *
 *   fetchSupplierPaymentPdfBundle → lee el pago, su compra, el proveedor, el
 *                                   banco, el asiento y la reversión si la hay.
 *   buildSupplierPaymentPdfPayload → lo que afecta VISUALMENTE al PDF (hash).
 *   buildSupplierPaymentDocumentProps → lo que dibuja `SupplierPaymentDocument`.
 *
 * Un pago reversado sigue teniendo comprobante: sale con la banda "REVERSADO"
 * y el asiento espejo. La reversión se lee del asiento `reversion` que lleva
 * el mismo `source_id` (el pago), como hace `getSupplierPaymentsForExpense`.
 *
 * 🔴 UN SALDO HEREDADO NO TIENE COMPROBANTE. `kind = 'migrated_balance'` es
 * una compra que ya estaba marcada como pagada antes de la 048: no hay pago
 * registrado, ni número, ni banco, ni asiento. Emitirle un "comprobante de
 * egreso" sería documentar una salida de plata que el sistema no vio. Esta
 * función lo devuelve como `{ motivo: "saldo-heredado" }` para que la ruta
 * responda 409 y la pantalla no ofrezca el botón (decisión de Oliver, 21/09).
 *
 * 🔴 RUC y DV van en DOS campos, nunca concatenados (CLAUDE.md §5). Del
 * proveedor se llaman `suppliers.ruc` y `suppliers.dv`. Si la compra no tiene
 * ficha de proveedor, vale el texto libre (`supplier_name`, `supplier_ruc`) y
 * el DV va vacío: no se inventa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupplierPaymentPdfPayload } from "@/lib/finanzas/api/supplier-payment-pdf-hash";
import type { SupplierPaymentDocumentProps } from "@/lib/finanzas/pdf/SupplierPaymentDocument";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/finanzas/types/payment";
import { SOURCE_TYPE_PAGO_PROVEEDOR } from "@/lib/finanzas/contabilidad/asiento-tesoreria";

type DB = SupabaseClient;

type Uno<T> = T | T[] | null | undefined;
const uno = <T,>(x: Uno<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);

export interface SupplierPaymentPdfBundle {
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
  proveedor: {
    name: string;
    supplier_number: string | null;
    ruc: string | null;
    dv: string | null;
    email: string | null;
    phone: string | null;
  };
  /** A qué documento va el pago (049). Cambia los rótulos del comprobante. */
  documento_kind: "compra" | "tramite";
  compra: {
    id: string;
    description: string;
    expense_date: string;
    supplier_invoice_number: string | null;
    total: number;
    /** Saldo de la compra HOY (no al momento del pago): informativo, no entra al hash. */
    saldo_actual: number;
  };
  banco: { code: string; name: string } | null;
  asiento: { entry_number: number; transaction_date: string } | null;
  reversion: { entry_number: number; reversed_at: string; reason: string } | null;
}

export type SupplierPaymentPdfLookup =
  | { ok: true; bundle: SupplierPaymentPdfBundle }
  | { ok: false; motivo: "no-existe" | "saldo-heredado" };

export async function fetchSupplierPaymentPdfBundle(
  db: DB,
  tenantId: string,
  paymentId: string
): Promise<SupplierPaymentPdfLookup> {
  const { data: p, error } = await db
    .from("supplier_payments")
    .select(
      `
        id, kind, payment_number, payment_date, amount, method, reference, notes, status,
        payment_account_code, created_by, business_expense_id, expense_id,
        compra:business_expenses!supplier_payments_business_expense_id_fkey(
          id, description, expense_date, supplier_invoice_number, total, amount_paid,
          supplier_name, supplier_ruc,
          supplier:suppliers!business_expenses_supplier_id_fkey(
            supplier_number, legal_name, trade_name, ruc, dv, email, phone
          )
        ),
        tramite:expenses!supplier_payments_expense_id_fkey(
          id, concept, date, amount, amount_paid,
          supplier:suppliers!expenses_supplier_id_fkey(
            supplier_number, legal_name, trade_name, ruc, dv, email, phone
          )
        )
      `
    )
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/pdf] fetchSupplierPaymentPdfBundle failed", error);
    return { ok: false, motivo: "no-existe" };
  }
  if (!p) return { ok: false, motivo: "no-existe" };
  if (p.kind === "migrated_balance") return { ok: false, motivo: "saldo-heredado" };
  // Sin número no hay comprobante (el CHECK de la 048 lo exige para un pago;
  // acá es defensa en profundidad, no un caso esperado).
  if (typeof p.payment_number !== "string" || !p.payment_number) return { ok: false, motivo: "no-existe" };

  type Proveedor = {
    supplier_number: string; legal_name: string; trade_name: string | null;
    ruc: string | null; dv: string | null; email: string | null; phone: string | null;
  };
  type Compra = {
    id: string; description: string; expense_date: string; supplier_invoice_number: string | null;
    total: string | number; amount_paid: string | number | null;
    supplier_name: string | null; supplier_ruc: string | null; supplier: Uno<Proveedor>;
  };
  // Arco exclusivo (049): el pago es de una compra O de un gasto de trámite.
  // Para el comprobante los dos se presentan igual: descripción, fecha, total.
  type Tramite = {
    id: string; concept: string; date: string; amount: string | number; amount_paid: string | number | null;
    supplier: Uno<Proveedor>;
  };
  const compraRaw = uno(p.compra as Uno<Compra>);
  const tramiteRaw = uno(p.tramite as Uno<Tramite>);
  const compra: Compra | null = compraRaw
    ? compraRaw
    : tramiteRaw
      ? {
          id: tramiteRaw.id,
          description: tramiteRaw.concept,
          expense_date: tramiteRaw.date,
          supplier_invoice_number: null,
          total: tramiteRaw.amount,
          amount_paid: tramiteRaw.amount_paid,
          supplier_name: null,
          supplier_ruc: null,
          supplier: tramiteRaw.supplier,
        }
      : null;
  if (!compra) return { ok: false, motivo: "no-existe" };
  const prov = uno(compra.supplier);

  const [{ data: je }, { data: espejo }, banco, creador] = await Promise.all([
    db
      .from("journal_entries")
      .select("entry_number, transaction_date")
      .eq("tenant_id", tenantId)
      .eq("source_type", SOURCE_TYPE_PAGO_PROVEEDOR)
      .eq("source_id", paymentId)
      .maybeSingle(),
    db
      .from("journal_entries")
      .select("entry_number, reversal_reason, created_at")
      .eq("tenant_id", tenantId)
      .eq("source_type", "reversion")
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

  const total = num(compra.total);
  const reversion: SupplierPaymentPdfBundle["reversion"] =
    espejo && p.status === "anulado"
      ? {
          entry_number: Number(espejo.entry_number),
          reversed_at: espejo.created_at as string,
          reason: (espejo.reversal_reason as string | null) ?? "",
        }
      : null;

  return {
    ok: true,
    bundle: {
      documento_kind: compraRaw ? "compra" : "tramite",
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
      proveedor: prov
        ? {
            name: prov.trade_name?.trim() || prov.legal_name,
            supplier_number: prov.supplier_number,
            ruc: prov.ruc,
            dv: prov.dv,
            email: prov.email,
            phone: prov.phone,
          }
        : {
            // Sin ficha ni texto libre: se dice, no se deja en blanco (D2 de
            // Oliver: el aviso de que falta la ficha tiene que ser visible).
            name: compra.supplier_name ?? "(sin proveedor: cargue la ficha para los anexos de renta)",
            supplier_number: null,
            ruc: compra.supplier_ruc,
            dv: null,
            email: null,
            phone: null,
          },
      compra: {
        id: compra.id,
        description: compra.description,
        expense_date: compra.expense_date,
        supplier_invoice_number: compra.supplier_invoice_number,
        total,
        saldo_actual: Math.round((total - num(compra.amount_paid)) * 100) / 100,
      },
      banco,
      asiento: je
        ? { entry_number: Number(je.entry_number), transaction_date: je.transaction_date as string }
        : null,
      reversion,
    },
  };
}

/** Lo que afecta al PDF. NO entra el saldo actual de la compra. */
export function buildSupplierPaymentPdfPayload(b: SupplierPaymentPdfBundle): SupplierPaymentPdfPayload {
  return {
    payment_number: b.payment.payment_number,
    payment_date: b.payment.payment_date,
    amount: b.payment.amount,
    method: b.payment.method,
    reference: b.payment.reference,
    notes: b.payment.notes,
    status: b.payment.status,
    documento_kind: b.documento_kind,
    proveedor: {
      name: b.proveedor.name,
      supplier_number: b.proveedor.supplier_number,
      ruc: b.proveedor.ruc,
      dv: b.proveedor.dv,
    },
    compra: {
      description: b.compra.description,
      expense_date: b.compra.expense_date,
      supplier_invoice_number: b.compra.supplier_invoice_number,
      total: b.compra.total,
    },
    banco: b.banco ? { code: b.banco.code, name: b.banco.name } : null,
    asiento: b.asiento ? b.asiento.entry_number : null,
    reversion: b.reversion
      ? { entry_number: b.reversion.entry_number, reversed_at: b.reversion.reversed_at, reason: b.reversion.reason }
      : null,
  };
}

export function buildSupplierPaymentDocumentProps(
  b: SupplierPaymentPdfBundle,
  opts: { generated_at: Date; generated_by_name: string | null }
): SupplierPaymentDocumentProps {
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
    documento_kind: b.documento_kind,
    proveedor: b.proveedor,
    compra: {
      description: b.compra.description,
      expense_date: b.compra.expense_date,
      supplier_invoice_number: b.compra.supplier_invoice_number,
      total: b.compra.total,
    },
    banco: b.banco,
    asiento: b.asiento,
    reversion: b.reversion,
    registrado_por: b.payment.created_by_name,
    generated_at_label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    generated_by_label: opts.generated_by_name ?? "",
  };
}

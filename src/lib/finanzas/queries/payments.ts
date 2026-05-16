/**
 * Queries server-side para payments. Patrón consistente con el resto del
 * módulo: admin client + filtro manual por tenant_id.
 *
 * MVP: getPaymentsForInvoice — devuelve todos los pagos que se aplicaron
 * a la factura indicada, con monto aplicado + datos del usuario que lo
 * registró. Como el sprint usa 1 pago = 1 application, el monto aplicado
 * coincide con payment.amount.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentForInvoice } from "@/lib/finanzas/types/payment";

type DB = SupabaseClient;

/**
 * Lista los pagos aplicados a una factura específica, ordenados por
 * payment_date descendente (más recientes primero).
 *
 * Excluye pagos con status='anulado' del listado por ruido visual. Los
 * 'registrado' y 'conciliado' se muestran (registrado es el default;
 * conciliado vendría de un sprint futuro de bancarización).
 */
export async function getPaymentsForInvoice(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<PaymentForInvoice[]> {
  const { data, error } = await db
    .from("payment_applications")
    .select(
      `
        amount_applied,
        payment:payments!payment_applications_payment_id_fkey(
          id, payment_number, client_id, payment_date, amount, amount_unapplied,
          currency, method, reference, status, notes, created_at, created_by
        )
      `
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);

  if (error) {
    console.error("[finanzas/queries] getPaymentsForInvoice failed", error);
    return [];
  }

  type Row = {
    amount_applied: string | number;
    payment: {
      id: string;
      payment_number: string | null;
      client_id: string;
      payment_date: string;
      amount: string | number;
      amount_unapplied: string | number;
      currency: string;
      method: string;
      reference: string | null;
      status: string;
      notes: string | null;
      created_at: string;
      created_by: string | null;
    } | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  // Excluir anulados (presentación). Mantener registrado + conciliado.
  const filtered = rows.filter(
    (r) => r.payment && r.payment.status !== "anulado"
  );

  // Hidratar created_by → full_name con un solo lookup
  const userIds = Array.from(
    new Set(
      filtered
        .map((r) => r.payment?.created_by)
        .filter((id): id is string => !!id)
    )
  );
  const userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await db
      .from("users")
      .select("id, full_name")
      .in("id", userIds);
    for (const u of users ?? []) {
      userMap[u.id as string] = (u.full_name as string) ?? "";
    }
  }

  const result: PaymentForInvoice[] = filtered
    .map((r) => {
      const p = r.payment!;
      return {
        id: p.id,
        payment_number: p.payment_number,
        client_id: p.client_id,
        payment_date: p.payment_date,
        amount: p.amount,
        amount_unapplied: p.amount_unapplied,
        currency: p.currency,
        // cast: la BD garantiza el dominio vía CHECK
        method: p.method as PaymentForInvoice["method"],
        reference: p.reference,
        status: p.status as PaymentForInvoice["status"],
        notes: p.notes,
        created_at: p.created_at,
        created_by: p.created_by,
        amount_applied: r.amount_applied,
        created_by_name: p.created_by ? userMap[p.created_by] ?? null : null,
      };
    })
    .sort((a, b) => (a.payment_date < b.payment_date ? 1 : -1));

  return result;
}

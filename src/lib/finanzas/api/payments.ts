/**
 * Helpers server-side para mutaciones de pagos. Llamados desde route
 * handlers `/api/finanzas/invoices/[id]/payments` y `/api/finanzas/payments/[id]`.
 *
 * MVP del Sprint 2C: 1 pago = 1 application contra UNA factura. La
 * estructura DB (payments + payment_applications N:M) soporta multi-factura
 * pero la UI no la expone. Si en el futuro se necesita, se construye una
 * pantalla específica sin tocar schema.
 *
 * Cap de monto: createPayment hace lookup de invoices.balance_due y rechaza
 * si amount > balance_due. Defensa server-side complementaria al cap
 * client-side (D9 del sprint).
 *
 * Eliminación: deletePayment borra el payment entero. T6 (no_delete) valida
 * que status='registrado'. CASCADE de payment_applications limpia la fila
 * asociada, y T7a recalcula invoices.amount_paid + status (puede revertir
 * 'pagada'→'emitida' / 'parc'→'emitida'; la whitelist de T2 ya lo permite).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreatePaymentInput } from "@/lib/finanzas/types/payment";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";

type DB = SupabaseClient;

/**
 * Crea un pago + lo aplica al 100% contra la factura indicada.
 *
 * Flujo (compensating delete pattern):
 *   1. Lookup invoice: validar que existe, mismo tenant, está en estado
 *      facturable (emitida / parc_pagada). Validar amount ≤ balance_due.
 *   2. INSERT payment (status='registrado', amount_unapplied=amount via T7c).
 *   3. INSERT payment_application (amount_applied=amount). T7a recalcula
 *      invoice.amount_paid + transiciona status. T7b deja amount_unapplied=0.
 *   4. Si paso 3 falla → DELETE payment compensatorio (T6 lo permite porque
 *      status='registrado' y no hay applications colgadas).
 */
export async function createPayment(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreatePaymentInput
): Promise<{ id: string }> {
  // 1. Lookup invoice + validar estado + cap por balance_due
  const { data: inv, error: errInv } = await db
    .from("invoices")
    .select("id, client_id, status, grand_total, amount_paid, balance_due")
    .eq("tenant_id", tenantId)
    .eq("id", input.invoice_id)
    .maybeSingle();

  if (errInv) {
    throw new MutationError(pgErrorToMessage(errInv), 500, errInv);
  }
  if (!inv) {
    throw new MutationError("Factura no encontrada", 404);
  }

  const status = inv.status as string;
  if (!["emitida", "parcialmente_pagada"].includes(status)) {
    throw new MutationError(
      status === "pagada"
        ? "Esta factura ya está completamente pagada."
        : `No se pueden registrar pagos a una factura en estado '${status}'.`,
      400
    );
  }

  const balanceDue = Number(inv.balance_due);
  if (input.amount > balanceDue + 0.001) {
    throw new MutationError(
      `El monto del pago (B/. ${input.amount.toFixed(2)}) excede el saldo pendiente (B/. ${balanceDue.toFixed(2)}).`,
      400
    );
  }

  // 2. INSERT payment
  const { data: payment, error: errPay } = await db
    .from("payments")
    .insert({
      tenant_id: tenantId,
      client_id: inv.client_id,
      payment_date: input.payment_date,
      amount: input.amount,
      currency: "USD",
      method: input.method,
      reference: input.reference,
      notes: input.notes,
      status: "registrado",
      created_by: userId,
    })
    .select("id")
    .single();

  if (errPay || !payment) {
    throw new MutationError(pgErrorToMessage(errPay), 400, errPay);
  }

  const paymentId = payment.id as string;

  // 3. INSERT payment_application
  const { error: errApp } = await db.from("payment_applications").insert({
    tenant_id: tenantId,
    payment_id: paymentId,
    invoice_id: input.invoice_id,
    amount_applied: input.amount,
    applied_by: userId,
    created_by: userId,
  });

  if (errApp) {
    // COMPENSATING DELETE — payment sin application no debe quedar.
    // T6 permite borrar payments en status='registrado'.
    await db
      .from("payments")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", paymentId);
    throw new MutationError(pgErrorToMessage(errApp), 400, errApp);
  }

  return { id: paymentId };
}

/**
 * Elimina un pago. T6 valida que status='registrado' (los pagos conciliados
 * o anulados NO se pueden borrar). CASCADE limpia payment_applications y
 * T7a recalcula automáticamente invoice.amount_paid + status — la factura
 * puede revertir de 'pagada'/'parc_pagada' a 'emitida' (T2 lo permite).
 */
export async function deletePayment(
  db: DB,
  tenantId: string,
  paymentId: string
): Promise<{ id: string }> {
  // Lookup para distinguir "not found" de "permission". Más diagnóstico.
  const { data: pay, error: errFetch } = await db
    .from("payments")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (errFetch) {
    throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  }
  if (!pay) {
    throw new MutationError("Pago no encontrado", 404);
  }

  const { error: errDel } = await db
    .from("payments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", paymentId);

  if (errDel) {
    throw new MutationError(pgErrorToMessage(errDel), 400, errDel);
  }

  return { id: paymentId };
}

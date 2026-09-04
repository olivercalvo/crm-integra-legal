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
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import {
  construirAsientoDeCobro,
  SOURCE_TYPE_COBRO,
} from "@/lib/finanzas/contabilidad/asiento-tesoreria";
import { cargarCobroParaAsiento } from "@/lib/finanzas/queries/tesoreria-para-asiento";

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
 *   5. POSTEAR EL ASIENTO. Si falla → mismo DELETE compensatorio.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EL BANCO ES OBLIGATORIO, Y EL SERVIDOR LO EXIGE
 * ═════════════════════════════════════════════════════════════════════════════
 * `payments.payment_account_code` (migración `041`) es NULLABLE en la base
 * porque los cobros anteriores no la tienen —nadie eligió su banco—, pero
 * **acá es obligatoria**: un cobro nuevo sin banco no se puede postear, y un
 * cobro que no se puede postear no se registra.
 *
 * El formulario también lo pide. Los dos hacen falta: el formulario guía, el
 * servidor garantiza. Un `curl` saltea la pantalla.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL ORDEN DEL DELETE COMPENSATORIO, MEDIDO CONTRA STAGING
 * ═════════════════════════════════════════════════════════════════════════════
 * Deshacer un cobro toca DOS filas (`payments` y su `payment_applications`) y
 * T7a cuelga de la segunda, así que había que saber si el orden cambia el
 * resultado. Se midió el 04/09/2026, dentro de un ROLLBACK, con la factura
 * FAC-HON-000003:
 *
 *   A) DELETE de la application y después del payment
 *        → amount_paid 100.00 → 0.00, status parcialmente_pagada → emitida ✅
 *   B) DELETE solo del payment (CASCADE se lleva la application)
 *        → amount_paid 100.00 → 0.00, status parcialmente_pagada → emitida ✅
 *
 * **Los dos dan el mismo estado final.** Se eligió **B**, y no por gusto:
 *
 *   · Es UNA sentencia en vez de dos. Este código corre cuando algo YA falló;
 *     cuantos menos pasos, menos formas de fallar a medias.
 *   · Si se borrara la application primero y el DELETE del payment fallara,
 *     quedaría **un pago sin aplicación** — que es exactamente el estado que el
 *     DELETE compensatorio original existe para impedir. B no puede producirlo.
 *   · El CASCADE está declarado en el esquema
 *     (`payment_applications_payment_id_fkey ... ON DELETE CASCADE`), así que no
 *     puede desincronizarse del código de la app.
 */
export async function createPayment(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreatePaymentInput,
  /**
   * 🔑 OBLIGATORIO, no opcional (SOP-014). Desde la `030` el RPC tiene EXECUTE
   * solo para `service_role`. Opcional sería el agujero perfecto: alguien
   * agrega un segundo llamador, no lo pasa, y esos cobros dejan de entrar al
   * libro sin que nadie se entere. Al ser obligatorio, lo impide el compilador.
   */
  ledgerDb: DB
): Promise<{ id: string }> {
  // 🔴 EL BANCO, ANTES DE TOCAR LA BASE. Se valida acá y no solo al armar el
  //    asiento para no llegar a insertar un cobro que después habría que
  //    deshacer: si falta el dato, el pedido está mal formado y se corta.
  if (!input.payment_account_code) {
    throw new MutationError(
      "Falta la cuenta bancaria donde entró el cobro. La elige quien registra: " +
        "el bufete tiene una cuenta operativa y una de saldos de clientes, y no " +
        "significan lo mismo.",
      400
    );
  }

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
      payment_account_code: input.payment_account_code,
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

  /**
   * Deshace el cobro entero. Ver el encabezado: se borra SOLO el payment y el
   * CASCADE se lleva la application; T7a devuelve la factura a su estado
   * anterior. Medido contra staging.
   */
  async function deshacerCobro(causa: MutationError): Promise<never> {
    const { error: errDel } = await db
      .from("payments")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", paymentId);
    if (errDel) {
      // No se pisa el error original: lo que hay que explicar es por qué no se
      // registró. El cobro huérfano queda en el log.
      console.error(
        "[finanzas/api] DELETE compensatorio FALLÓ para el cobro %s. Quedó registrado sin asiento.",
        paymentId,
        errDel
      );
    }
    throw causa;
  }

  if (errApp) {
    // COMPENSATING DELETE — payment sin application no debe quedar.
    // T6 permite borrar payments en status='registrado'.
    await deshacerCobro(new MutationError(pgErrorToMessage(errApp), 400, errApp));
  }

  // ---- 5) EL ASIENTO -----------------------------------------------------
  const cobro = await cargarCobroParaAsiento(ledgerDb, tenantId, paymentId);
  if (!cobro) {
    await deshacerCobro(
      new MutationError("El cobro se registró pero no se pudo releer para contabilizarlo.", 500)
    );
  }

  const armado = construirAsientoDeCobro(cobro as NonNullable<typeof cobro>);
  if (!armado.ok) {
    // 422: el cobro está bien como documento; falta o está mal el banco. El
    // mensaje ya dice cuál de las dos cosas es.
    await deshacerCobro(new MutationError(armado.mensaje, 422));
  }

  try {
    await postJournalEntry(
      ledgerDb,
      tenantId,
      (armado as { ok: true; asiento: import("@/lib/finanzas/contabilidad/posting").AsientoInput }).asiento,
      userId
    );
  } catch (err) {
    await deshacerCobro(
      err instanceof MutationError ? err : new MutationError(String(err), 500)
    );
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

  // ---- 🔴 GATE CONTABLE ---------------------------------------------------
  // Un cobro que ya está en el libro NO se borra. Mismo patrón que
  // `cancelInvoice` y que el de compras.
  //
  // Acá el daño de borrarlo sería doble, y por eso el gate importa más que en
  // las otras dos tablas: el CASCADE se lleva la `payment_application`, T7a
  // recalcula `amount_paid` y **la factura vuelve a 'emitida'**. O sea que el
  // documento diría "sin cobrar" mientras el asiento sigue diciendo que entró
  // la plata al banco. Dos verdades opuestas, y solo una de las dos se puede
  // corregir.
  //
  // Un cobro contabilizado se REVIERTE, no se borra. Que la reversión todavía
  // no exista hace el bloqueo visible en vez de silencioso — es a propósito.
  const { data: asiento } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE_COBRO)
    .eq("source_id", paymentId)
    .maybeSingle();

  if (asiento) {
    const numero = (asiento as { entry_number: number }).entry_number;
    throw new MutationError(
      `Este cobro ya está registrado en el libro contable (asiento ${numero}), ` +
        `así que no se puede borrar. Los asientos son inmutables por ley: un cobro ` +
        `contabilizado se corrige con un asiento de reversión, no borrándolo.`,
      409
    );
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

/**
 * Helpers server-side de PAGOS A PROVEEDORES (`supplier_payments`, 048 —
 * Bloque 3, 21/09/2026). Los llaman:
 *   POST   /api/finanzas/business-expenses/[id]/payments   → createSupplierPayment
 *   DELETE /api/finanzas/supplier-payments/[id]            → deleteSupplierPayment
 *   POST   /api/finanzas/supplier-payments/[id]/reverse    → reverseSupplierPayment
 *
 * Reglas de Josuarth (21/09): pago PARCIAL sí; un pago cubre UNA compra.
 * Reemplaza a `markBusinessExpenseAsPaid` (FND-009).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL MISMO ORDEN QUE EL COBRO: número → INSERT del pago → asiento → si falla,
 * DELETE compensatorio
 * ═════════════════════════════════════════════════════════════════════════════
 * Con una diferencia que lo hace más simple: no hay aplicaciones. El trigger de
 * la 048 deriva `amount_paid`, `status` y `payment_date` de la compra al
 * insertar (y al borrar) el pago; acá no se escribe nada en la compra.
 *
 * 🔴 El número (`CE-`) se toma ANTES del INSERT y si el asiento falla queda un
 * HUECO. Es la decisión consciente del recibo de caja (SOP-031), por el mismo
 * motivo: numerar después del asiento dejaría, si el UPDATE final falla, un
 * pago contabilizado sin comprobante, y eso no se puede compensar.
 *
 * 🔴 El banco vive en el PAGO. `business_expenses` NO tiene
 * `payment_account_code` (FND-009); toda columna de este archivo se verificó
 * contra information_schema el 21/09/2026.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { destinoDePago, type CreateSupplierPaymentInput } from "@/lib/finanzas/types/supplier-payment";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import {
  construirAsientoDePagoProveedor,
  SOURCE_TYPE_PAGO_PROVEEDOR,
} from "@/lib/finanzas/contabilidad/asiento-tesoreria";
import { cargarPagoProveedorParaAsiento } from "@/lib/finanzas/queries/tesoreria-para-asiento";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { allocateSupplierPaymentNumber } from "@/lib/finanzas/numbering/supplier-payment-numbering";
import { getAsientoDePagoProveedor, getSupplierPayment } from "@/lib/finanzas/queries/supplier-payments";

type DB = SupabaseClient;

/**
 * Registra un pago a una compra y postea su asiento.
 *
 *   1. Lookup de la compra: existe, mismo tenant, tiene saldo, y el monto no
 *      supera el saldo (`total − amount_paid`).
 *   1b. El número CE-, después de todas las validaciones.
 *   2. INSERT del pago (kind='payment'). El trigger de la 048 recalcula la compra.
 *   3. El asiento (DEBE 200001 / HABER banco). Si falla → DELETE del pago (el
 *      trigger devuelve la compra a como estaba).
 */
export async function createSupplierPayment(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateSupplierPaymentInput,
  /** 🔑 Obligatorio (SOP-014): el posteo va con el cliente de servicio. */
  ledgerDb: DB
): Promise<{ id: string; payment_number: string }> {
  if (!input.payment_account_code) {
    throw new MutationError(
      "Falta la cuenta bancaria de donde salió el pago. La elige quien registra: " +
        "es lo que el asiento acredita y no se puede deducir.",
      400
    );
  }

  // 1. El documento y su saldo (049: una compra O un gasto de trámite)
  const destino = destinoDePago(input);
  // Para los mensajes: "Esta compra … pagada" / "Este gasto de trámite … pagado".
  const docLabel = destino.kind === "compra" ? "compra" : "gasto de trámite";
  const docFrase = destino.kind === "compra" ? "Esta compra ya está completamente pagada." : "Este gasto de trámite ya está completamente pagado.";
  let total: number;
  let pagado: number;
  let status: string;
  if (destino.kind === "compra") {
    const { data: compra, error: errCompra } = await db
      .from("business_expenses")
      .select("id, description, status, total, amount_paid")
      .eq("tenant_id", tenantId)
      .eq("id", destino.id)
      .maybeSingle();
    if (errCompra) {
      throw new MutationError(pgErrorToMessage(errCompra), 500, errCompra);
    }
    if (!compra) {
      throw new MutationError("Compra no encontrada", 404);
    }
    total = Number(compra.total);
    pagado = Number(compra.amount_paid);
    status = String(compra.status);
  } else {
    const { data: gasto, error: errGasto } = await db
      .from("expenses")
      .select("id, concept, status, amount, amount_paid, posted_entry_id")
      .eq("tenant_id", tenantId)
      .eq("id", destino.id)
      .maybeSingle();
    if (errGasto) {
      throw new MutationError(pgErrorToMessage(errGasto), 500, errGasto);
    }
    if (!gasto) {
      throw new MutationError("Gasto de trámite no encontrado", 404);
    }
    if (gasto.status === "anulado") {
      throw new MutationError("Este gasto está anulado: no se le registran pagos.", 409);
    }
    // 🔴 Sin el asiento del gasto no hay cuenta por pagar en el libro: pagar
    //    ahora debitaría 200001 por una deuda que el mayor no tiene. Los gastos
    //    anteriores al posteo automático primero se registran en el libro.
    if (!gasto.posted_entry_id) {
      throw new MutationError(
        "Este gasto todavía no está registrado en el libro contable: regístrelo primero " +
          '(botón "Registrar en el libro contable") y después registre su pago.',
        409
      );
    }
    total = Number(gasto.amount);
    pagado = Number(gasto.amount_paid);
    status = String(gasto.status);
  }
  const saldo = Math.round((total - pagado) * 100) / 100;
  if (status === "pagado" || saldo <= 0.001) {
    throw new MutationError(docFrase, 400);
  }
  if (input.amount > saldo + 0.001) {
    throw new MutationError(
      `El monto del pago (B/. ${input.amount.toFixed(2)}) excede el saldo pendiente del ${docLabel} ` +
        `(B/. ${saldo.toFixed(2)}).`,
      400
    );
  }

  // 1b. El número, última cosa antes de escribir (un 400 no quema correlativo).
  let paymentNumber: string;
  try {
    paymentNumber = await allocateSupplierPaymentNumber(db, tenantId);
  } catch (err) {
    throw new MutationError(
      "No se pudo asignar el número del comprobante. ¿Está aplicada la migración 048 en esta base?",
      500,
      err
    );
  }

  // 2. INSERT del pago
  const { data: pago, error: errPago } = await db
    .from("supplier_payments")
    .insert({
      tenant_id: tenantId,
      // Arco exclusivo (049): uno de los dos, el otro null.
      business_expense_id: destino.kind === "compra" ? destino.id : null,
      expense_id: destino.kind === "tramite" ? destino.id : null,
      kind: "payment",
      payment_number: paymentNumber,
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
  if (errPago || !pago) {
    throw new MutationError(pgErrorToMessage(errPago), 400, errPago);
  }
  const pagoId = pago.id as string;

  /** Deshace el pago. El trigger (048/049) devuelve el documento a como estaba. */
  async function deshacerPago(causa: MutationError): Promise<never> {
    const { error: errDel } = await db
      .from("supplier_payments")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", pagoId);
    if (errDel) {
      console.error(
        "[finanzas/api] DELETE compensatorio FALLÓ para el pago a proveedor %s. Quedó registrado sin asiento.",
        pagoId,
        errDel
      );
    }
    throw causa;
  }

  // 3. El asiento
  const datos = await cargarPagoProveedorParaAsiento(ledgerDb, tenantId, pagoId);
  if (!datos) {
    await deshacerPago(
      new MutationError("El pago se registró pero no se pudo releer para contabilizarlo.", 500)
    );
  }
  const armado = construirAsientoDePagoProveedor(datos as NonNullable<typeof datos>);
  if (!armado.ok) {
    await deshacerPago(new MutationError(armado.mensaje, 422));
  }
  try {
    await postJournalEntry(
      ledgerDb,
      tenantId,
      (armado as { ok: true; asiento: import("@/lib/finanzas/contabilidad/posting").AsientoInput }).asiento,
      userId
    );
  } catch (err) {
    await deshacerPago(err instanceof MutationError ? err : new MutationError(String(err), 500));
  }

  return { id: pagoId, payment_number: paymentNumber };
}

/**
 * Elimina un pago SIN asiento (incluidos los saldos heredados de la 048: es la
 * corrección honesta si la compra en realidad nunca se pagó). Un pago con
 * asiento no se borra: 409 → reversar. Mismo gate que `deletePayment`.
 */
export async function deleteSupplierPayment(
  db: DB,
  tenantId: string,
  pagoId: string
): Promise<{ id: string }> {
  const pago = await getSupplierPayment(db, tenantId, pagoId);
  if (!pago) {
    throw new MutationError("Pago no encontrado", 404);
  }

  const { data: asiento } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE_PAGO_PROVEEDOR)
    .eq("source_id", pagoId)
    .maybeSingle();
  if (asiento) {
    const numero = (asiento as { entry_number: number }).entry_number;
    throw new MutationError(
      `Este pago ya está registrado en el libro contable (asiento ${numero}), así que no se puede ` +
        `borrar. Los asientos son inmutables por ley: un pago contabilizado se corrige con una ` +
        `reversión (botón Reversar), no borrándolo.`,
      409
    );
  }

  const { error: errDel } = await db
    .from("supplier_payments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", pagoId);
  if (errDel) {
    throw new MutationError(pgErrorToMessage(errDel), 400, errDel);
  }
  return { id: pagoId };
}

export interface ReverseSupplierPaymentResult {
  entry_id: string;
  entry_number: number;
  reversed_entry_number: number;
  transaction_date: string;
  expense: { id: string; status: string; amount_paid: number };
}

/**
 * Reversa un pago contabilizado con el RPC `reverse_supplier_payment` (048):
 * espejo + `anulado` en una transacción; el trigger devuelve la compra. Las
 * líneas las arma `construirAsientoDeReversion`, la MISMA que dibuja la vista
 * previa del diálogo; el RPC las verifica, no las recalcula.
 *
 * Un saldo heredado no se reversa (no tiene asiento): el RPC lo rechaza con
 * un mensaje que lo nombra; acá se corta antes, con 409.
 */
export async function reverseSupplierPayment(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  pagoId: string,
  reason: string
): Promise<ReverseSupplierPaymentResult> {
  const pago = await getSupplierPayment(db, tenantId, pagoId);
  if (!pago) {
    throw new MutationError("Pago no encontrado", 404);
  }
  if (pago.kind === "migrated_balance") {
    throw new MutationError(
      "Este movimiento es un saldo heredado de la migración, no un pago registrado: no tiene asiento " +
        "que reversar. Si la compra en realidad no estaba pagada, elimínelo.",
      409
    );
  }
  if (pago.status === "anulado") {
    throw new MutationError("Este pago ya está anulado.", 409);
  }

  const original = await getAsientoDePagoProveedor(db, tenantId, pagoId);
  if (!original) {
    throw new MutationError(
      "Este pago no está en el libro contable, así que no hay nada que reversar. " +
        "Un pago sin asiento se elimina con el botón Eliminar.",
      409
    );
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const armado = construirAsientoDeReversion(original, { hoy, motivo: reason, source_id: pagoId });
  if (!armado.ok) {
    throw new MutationError(armado.mensaje, 422);
  }

  const { data, error } = await ledgerDb.rpc("reverse_supplier_payment", {
    p_tenant_id: tenantId,
    p_payment_id: pagoId,
    p_reason: armado.asiento.reversal_reason,
    p_transaction_date: armado.asiento.transaction_date,
    p_description: armado.asiento.description,
    p_lines: armado.asiento.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
    })),
    p_created_by: userId,
  });
  if (error) {
    console.error("[finanzas/api] reverse_supplier_payment failed", error);
    throw new MutationError(error.message || "No se pudo reversar el pago", 422, error);
  }

  const r = data as {
    entry_id: string;
    entry_number: number;
    reversed_entry_number: number;
    transaction_date: string;
    expense: { id: string; status: string; amount_paid: number | string };
  } | null;
  if (!r || !r.entry_id) {
    throw new MutationError("El pago se reversó pero no se pudo leer el asiento resultante", 500);
  }
  return {
    entry_id: r.entry_id,
    entry_number: Number(r.entry_number),
    reversed_entry_number: Number(r.reversed_entry_number),
    transaction_date: r.transaction_date,
    expense: { ...r.expense, amount_paid: Number(r.expense.amount_paid) },
  };
}

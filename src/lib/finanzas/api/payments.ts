/**
 * Helpers server-side para mutaciones de pagos. Llamados desde route
 * handlers `/api/finanzas/invoices/[id]/payments` y `/api/finanzas/payments/[id]`.
 *
 * Desde la Parte B del Bloque 2 (21/09/2026) un cobro se aplica a UNA O
 * VARIAS facturas del mismo cliente (`applications[]`); la ruta vieja
 * `/invoices/[id]/payments` sigue como atajo de una aplicación. Josuarth: "sí
 * hace falta poder pagar varias facturas con una sola transferencia".
 *
 * Cap de monto: createPayment hace lookup de invoices.balance_due y rechaza
 * si el monto aplicado a CADA factura supera su saldo. Defensa server-side
 * complementaria al cap client-side (D9 del sprint). La suma == total la
 * verifica el validador antes de llegar acá.
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
import { getAsientoDeCobro } from "@/lib/finanzas/queries/payments";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { allocateReceiptNumber } from "@/lib/finanzas/numbering/receipt-numbering";

type DB = SupabaseClient;

/**
 * Crea un pago y lo aplica a las facturas indicadas (una o varias).
 *
 * Flujo (compensating delete pattern):
 *   1. Lookup de las facturas EN UNA consulta: todas existen, mismo tenant,
 *      MISMO cliente (un recibo es de un cliente), estado cobrable
 *      (emitida / parc_pagada), y cada monto aplicado ≤ su balance_due.
 *   1b. EL NÚMERO DE RECIBO: `get_next_sequence_number(tenant, 'payment')` →
 *      `REC-000012`. Va DESPUÉS de todas las validaciones (un pedido mal
 *      formado no consume número) y ANTES del INSERT (va dentro del mismo
 *      INSERT). Si algo falla de acá en adelante, el número queda consumido y
 *      hay un HUECO: decisión consciente, ver `numbering/receipt-numbering.ts`
 *      y SOP-031.
 *   2. INSERT payment (status='registrado', payment_number, amount_unapplied=amount via T7c).
 *   3. INSERT payment_applications, una fila por factura. T7a recalcula
 *      invoice.amount_paid + transiciona status POR FILA. T7b deja
 *      amount_unapplied=0 porque la suma == amount (lo garantiza el validador).
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
): Promise<{ id: string; payment_number: string }> {
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

  if (!input.applications || input.applications.length === 0) {
    throw new MutationError("Elija al menos una factura a la que aplicar el cobro.", 400);
  }

  // 1. Lookup de las facturas + estado + cap por balance_due, POR factura
  const ids = input.applications.map((a) => a.invoice_id);
  const { data: invs, error: errInv } = await db
    .from("invoices")
    .select("id, invoice_number, client_id, status, grand_total, amount_paid, balance_due")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  if (errInv) {
    throw new MutationError(pgErrorToMessage(errInv), 500, errInv);
  }
  type Inv = {
    id: string;
    invoice_number: string;
    client_id: string;
    status: string;
    balance_due: number | string;
  };
  const porId = new Map(((invs ?? []) as Inv[]).map((i) => [i.id, i]));
  if (porId.size !== ids.length) {
    throw new MutationError(
      ids.length === 1 ? "Factura no encontrada" : "Alguna de las facturas seleccionadas no existe.",
      404
    );
  }

  // Un recibo es de UN cliente: la plata la manda alguien.
  const clientes = new Set(Array.from(porId.values()).map((i) => i.client_id));
  if (clientes.size > 1) {
    throw new MutationError(
      "Las facturas seleccionadas son de clientes distintos. Un recibo de caja es de un solo cliente: " +
        "registre un cobro por cada cliente.",
      400
    );
  }
  const clientId = Array.from(clientes)[0];

  for (const app of input.applications) {
    const inv = porId.get(app.invoice_id)!;
    const status = inv.status;
    if (!["emitida", "parcialmente_pagada"].includes(status)) {
      throw new MutationError(
        status === "pagada"
          ? `La factura ${inv.invoice_number} ya está completamente pagada.`
          : `No se pueden registrar pagos a la factura ${inv.invoice_number} en estado '${status}'.`,
        400
      );
    }
    const balanceDue = Number(inv.balance_due);
    if (app.amount > balanceDue + 0.001) {
      throw new MutationError(
        `El monto aplicado a ${inv.invoice_number} (B/. ${app.amount.toFixed(2)}) excede su saldo pendiente ` +
          `(B/. ${balanceDue.toFixed(2)}).`,
        400
      );
    }
  }

  // 1b. EL NÚMERO DE RECIBO. Última cosa antes de escribir: todo lo que podía
  //     rechazar el pedido ya pasó, así que un 400 no quema un correlativo.
  //     De acá en adelante, una falla deja un hueco (ver el encabezado).
  let paymentNumber: string;
  try {
    paymentNumber = await allocateReceiptNumber(db, tenantId);
  } catch (err) {
    throw new MutationError(
      "No se pudo asignar el número de recibo. ¿Está aplicada la migración 047 en esta base?",
      500,
      err
    );
  }

  // 2. INSERT payment
  const { data: payment, error: errPay } = await db
    .from("payments")
    .insert({
      tenant_id: tenantId,
      payment_number: paymentNumber,
      client_id: clientId,
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

  // 3. INSERT payment_applications — una fila por factura, en UN insert.
  //    Si alguna falla (por ejemplo, el UNIQUE payment/factura), no entra ninguna.
  const { error: errApp } = await db.from("payment_applications").insert(
    input.applications.map((a) => ({
      tenant_id: tenantId,
      payment_id: paymentId,
      invoice_id: a.invoice_id,
      amount_applied: a.amount,
      applied_by: userId,
      created_by: userId,
    }))
  );

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

  return { id: paymentId, payment_number: paymentNumber };
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
  // Un cobro contabilizado se REVIERTE, no se borra: `reversePayment`, más
  // abajo. El mensaje manda ahí.
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
        `contabilizado se corrige con una reversión (botón Reversar), no borrándolo.`,
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

// ---------------------------------------------------------------------------
// REVERSAR — el cobro contabilizado se deshace con un asiento espejo
// ---------------------------------------------------------------------------

export interface ReversePaymentResult {
  entry_id: string;
  /** El asiento espejo. */
  entry_number: number;
  /** El asiento del cobro, que ahora está reversado. */
  reversed_entry_number: number;
  /** ISO `YYYY-MM-DD`: la fecha con la que quedó el espejo. */
  transaction_date: string;
  /** Cómo quedó cada factura después de que T7a recalculó. */
  invoices: { invoice_id: string; invoice_number: string; status: string; amount_paid: number }[];
}

/**
 * Reversa un cobro que ya está en el libro. Es la contracara del gate de
 * `deletePayment`: un cobro sin asiento se ELIMINA; uno con asiento se
 * REVIERTE, y esta es la única forma de hacerlo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * TRES ESCRITURAS, UNA TRANSACCIÓN: el RPC `reverse_payment` (migración `046`)
 * ═════════════════════════════════════════════════════════════════════════════
 * Postear el espejo, borrar las `payment_applications` (dispara T7a, que
 * devuelve la factura a `emitida` / `parcialmente_pagada`) y marcar el cobro
 * `anulado` van DENTRO de una función de Postgres. No se hace desde acá con
 * tres llamadas como en `emitInvoice`, porque acá el estado a medias es
 * justamente el que la reversión existe para impedir: el espejo posteado (y
 * los asientos no se borran) con la factura todavía "pagada". Si cualquier
 * paso falla, la función deshace todo, incluido el asiento y el correlativo.
 * `sql/tests/verificacion-046-reversion-cobro.sql` lo prueba forzando una
 * falla después del posteo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LAS LÍNEAS LAS ARMA `construirAsientoDeReversion`, LA MISMA DE LA PANTALLA
 * ═════════════════════════════════════════════════════════════════════════════
 * El diálogo dibuja la vista previa con esa función y este helper le manda al
 * RPC lo que esa función devuelve. Una sola implementación: lo que se ve es lo
 * que se postea. El RPC no la recalcula, la VERIFICA (rechaza cualquier línea
 * que no sea el espejo exacto del original).
 *
 * 🔑 `ledgerDb` es el cliente de SERVICIO (SOP-014): el RPC tiene EXECUTE solo
 * para service_role y confía en el `tenantId` que recibe, que sale del perfil
 * del usuario autenticado y nunca del body.
 */
export async function reversePayment(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  paymentId: string,
  reason: string
): Promise<ReversePaymentResult> {
  // 1. El cobro existe y es de este tenant. El RPC lo vuelve a chequear con
  //    candado; acá es para contestar 404 en vez de un error opaco.
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
    throw new MutationError("Cobro no encontrado", 404);
  }
  if ((pay as { status: string }).status === "anulado") {
    throw new MutationError("Este cobro ya está anulado.", 409);
  }

  // 2. Su asiento. Sin asiento no hay nada que reversar: se elimina.
  const original = await getAsientoDeCobro(db, tenantId, paymentId);
  if (!original) {
    throw new MutationError(
      "Este cobro no está en el libro contable, así que no hay nada que reversar. " +
        "Un cobro sin asiento se elimina con el botón Eliminar.",
      409
    );
  }

  // 3. El espejo, con la fecha de HOY (acta del 09/09: nunca la del original).
  //    Misma fórmula de "hoy" que el resto del módulo (UTC), y la misma que el
  //    RPC compara contra su `current_date`.
  const hoy = new Date().toISOString().slice(0, 10);
  const armado = construirAsientoDeReversion(original, {
    hoy,
    motivo: reason,
    source_id: paymentId,
  });
  if (!armado.ok) {
    throw new MutationError(armado.mensaje, 422);
  }

  // 4. El RPC: todo o nada.
  const { data, error } = await ledgerDb.rpc("reverse_payment", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
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
    console.error("[finanzas/api] reverse_payment failed", error);
    // 422 y no 500: el mensaje del RPC ya viene redactado para que lo lea un
    // humano (período cerrado, ya reversado, líneas que no son el espejo).
    throw new MutationError(error.message || "No se pudo reversar el cobro", 422, error);
  }

  const r = data as {
    entry_id: string;
    entry_number: number;
    reversed_entry_number: number;
    transaction_date: string;
    invoices: { invoice_id: string; invoice_number: string; status: string; amount_paid: number | string }[];
  } | null;
  if (!r || !r.entry_id) {
    throw new MutationError("El cobro se reversó pero no se pudo leer el asiento resultante", 500);
  }

  return {
    entry_id: r.entry_id,
    entry_number: Number(r.entry_number),
    reversed_entry_number: Number(r.reversed_entry_number),
    transaction_date: r.transaction_date,
    invoices: (r.invoices ?? []).map((i) => ({ ...i, amount_paid: Number(i.amount_paid) })),
  };
}

/**
 * Mutaciones contables del GASTO DE TRÁMITE (módulo Legal, tabla `expenses`).
 * Bloque 4, 21/09/2026.
 *
 *   postearGastoTramite → el asiento del gasto (DEBE la cuenta de cada línea /
 *   HABER 200001), UNA implementación para las dos puertas: el alta
 *   (`POST /api/expenses`, donde se postea AUTOMÁTICAMENTE desde el commit 3
 *   del Bloque 4) y el reintento manual (`POST /api/expenses/[id]/post-to-ledger`,
 *   que queda para los gastos anteriores al cambio, sin asiento).
 *
 *   reverseExpenseTramite → RPC `reverse_expense_tramite` (050): espejo del
 *   asiento `gasto_tramite` con la fecha de hoy + `expenses.status = 'anulado'`,
 *   en UNA transacción. Es la salida de la inmutabilidad de la 038: desde el
 *   posteo automático (commit 3 de este bloque) un gasto nace en el libro, y
 *   sin esto la única corrección sería un asiento manual.
 *
 * Las líneas del espejo las arma `construirAsientoDeReversion`, la MISMA
 * función que dibuja la vista previa del diálogo; el RPC las verifica, no las
 * recalcula (`reversion-una-sola-implementacion.test.ts` lo vigila).
 *
 * El `tenant_id` llega de la ruta, que lo saca del perfil autenticado (SOP-014).
 */

import { cargarInicioContable, esContabilizadoFuera, explicacionContabilizadoFuera } from "@/lib/finanzas/contabilidad/inicio-contable";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError } from "@/lib/finanzas/api/errors";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { resolverFechaDeRegistro } from "@/lib/finanzas/api/fecha-de-registro";
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import { allocatePurchaseNumber } from "@/lib/finanzas/numbering/purchase-numbering";
import { mensajeDeDocumentoDePrueba } from "@/lib/finanzas/documentos-de-prueba";
import {
  construirAsientoDeGastoTramite,
  SOURCE_TYPE_GASTO_TRAMITE,
} from "@/lib/finanzas/contabilidad/asiento-gasto-tramite";
import { getAsientoDeGastoTramite, getLineasDeGastoTramite } from "@/lib/finanzas/queries/expense-tramite";

type DB = SupabaseClient;

/** El mensaje de "ya está posteado", en UN solo lugar: lo usan las capas 2 y 3. */
function yaPosteado(numero: number | null): string {
  return numero === null
    ? "Este gasto ya está registrado en el libro contable."
    : `Este gasto ya está registrado en el libro contable (asiento ${numero}).`;
}

export interface PosteoDeGastoTramite {
  entry_id: string;
  entry_number: number | null;
  /** Cuántas líneas tiene el asiento (N débitos + 1 crédito). */
  lineas: number;
}

/**
 * Postea el asiento de un gasto de trámite. Lanza `MutationError` con el
 * status HTTP que corresponde; el `detail` de un 422 por líneas sin clasificar
 * trae `{ motivo, lineas }` para que la pantalla pueda ir a la línea.
 *
 * Tres capas contra el doble posteo (un asiento duplicado en un libro
 * inmutable no se borra):
 *   1. `expenses.posted_entry_id`, el cache: corta temprano.
 *   2. `journal_entries` por (`gasto_tramite`, id): la verdad.
 *   3. El UNIQUE de la 034: dos requests que pasaron la capa 2 a la vez; el
 *      índice frena al segundo y acá se traduce al MISMO mensaje (409).
 *
 * El cache (`posted_entry_id`) se escribe después del posteo y, si falla, NO
 * se falla la operación: el asiento ya está en el libro y eso es lo
 * irreversible; la pantalla lee la verdad contra `journal_entries`.
 *
 * `db` es el cliente de SERVICIO (postea) y `tenantId` viene del perfil del
 * usuario autenticado, nunca del request (SOP-014).
 */
export async function postearGastoTramite(
  db: DB,
  tenantId: string,
  expenseId: string,
  userId: string
): Promise<PosteoDeGastoTramite> {
  const { data: gasto, error: errGasto } = await db
    .from("expenses")
    .select(
      `id, date, accounting_date, concept, posted_entry_id, supplier_id, de_prueba,
       purchase_number, supplier_invoice_number,
       cases(case_code),
       suppliers(legal_name)`
    )
    .eq("id", expenseId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errGasto) {
    console.error("[expenses/postear] lookup failed", errGasto);
    throw new MutationError("Error interno del servidor", 500, errGasto);
  }
  if (!gasto) {
    throw new MutationError("Gasto no encontrado", 404);
  }
  // Gasto de un caso de un cliente de prueba (nace de prueba, 094): no entra al
  // libro (095). Se corta antes del número FAC-CO-.
  if ((gasto as { de_prueba?: boolean }).de_prueba === true) {
    throw new MutationError(mensajeDeDocumentoDePrueba(null), 409);
  }
  // 096: un gasto anterior al inicio contable está contabilizado FUERA. El
  // botón «Registrar en el libro contable» no aparece, y si alguien llama a la
  // ruta igual: 409. Postearlo duplicaría lo que ya está en QuickBooks.
  const inicio = await cargarInicioContable(db, tenantId);
  if (esContabilizadoFuera(String(gasto.date), inicio)) {
    throw new MutationError(`Este gasto está contabilizado fuera. ${explicacionContabilizadoFuera(inicio)}`, 409);
  }

  // ── CAPA 1: el cache ──────────────────────────────────────────────────────
  if (gasto.posted_entry_id) {
    const { data: ya } = await db
      .from("journal_entries")
      .select("entry_number")
      .eq("id", gasto.posted_entry_id)
      .maybeSingle();
    throw new MutationError(yaPosteado((ya as { entry_number: number } | null)?.entry_number ?? null), 409);
  }

  // ── CAPA 2: la verdad ─────────────────────────────────────────────────────
  const { data: asientoPrevio, error: errPrevio } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE_GASTO_TRAMITE)
    .eq("source_id", expenseId)
    .maybeSingle();

  if (errPrevio) {
    // Ante la duda NO se asume que no hay asiento: postear de más es lo único
    // que no se puede deshacer.
    console.error("[expenses/postear] asiento lookup failed", errPrevio);
    throw new MutationError(
      "No se pudo verificar si el gasto ya está en el libro. No se registró nada.",
      500,
      errPrevio
    );
  }
  if (asientoPrevio) {
    throw new MutationError(yaPosteado((asientoPrevio as { entry_number: number }).entry_number), 409);
  }

  // ── Las líneas y el armado ────────────────────────────────────────────────
  const lineas = await getLineasDeGastoTramite(db, tenantId, expenseId);
  const caso = (gasto as unknown as { cases: { case_code: string } | null }).cases;
  const prov = (gasto as unknown as { suppliers: { legal_name: string } | null }).suppliers;

  const armado = construirAsientoDeGastoTramite(
    {
      id: String(gasto.id),
      date: String(gasto.date),
      accounting_date: String((gasto as { accounting_date?: string | null }).accounting_date ?? gasto.date),
      concept: String(gasto.concept ?? ""),
      case_code: caso?.case_code ?? null,
      supplier_legal_name: prov?.legal_name ?? null,
      supplier_id: (gasto as { supplier_id?: string | null }).supplier_id ?? null,
      purchase_number: (gasto as { purchase_number?: string | null }).purchase_number ?? null,
      supplier_invoice_number:
        (gasto as { supplier_invoice_number?: string | null }).supplier_invoice_number ?? null,
    },
    lineas
  );
  if (!armado.ok) {
    // Líneas sin clasificar, con su mensaje ya redactado y los números de
    // línea adentro. 422 y no 400: el request está bien formado, lo que falta
    // es que alguien clasifique.
    throw new MutationError(armado.mensaje, 422, { motivo: armado.motivo, lineas: armado.lineasSinCuenta });
  }

  // ── EL NÚMERO FAC-CO- (071, E3) ───────────────────────────────────────────
  // Se toma DESPUÉS de armar (un gasto sin clasificar no consume número) y se
  // escribe en el gasto ANTES de postear: el trigger de la 038 lo deja pasar
  // porque todavía no hay asiento, y un reintento después de un posteo fallido
  // REUSA el número que ya tiene en vez de quemar otro.
  let numero = (gasto as { purchase_number?: string | null }).purchase_number ?? null;
  if (!numero) {
    try {
      numero = await allocatePurchaseNumber(db, tenantId);
    } catch (err) {
      throw new MutationError("No se pudo asignar el número FAC-CO- del gasto. No se registró nada.", 500, err);
    }
    const { error: errNumero } = await db
      .from("expenses")
      .update({ purchase_number: numero })
      .eq("id", expenseId)
      .eq("tenant_id", tenantId);
    if (errNumero) {
      console.error("[expenses/postear] no se pudo guardar el número", errNumero);
      throw new MutationError("No se pudo guardar el número del gasto. No se registró nada.", 500, errNumero);
    }
  }
  const asiento = { ...armado.asiento, reference: numero };

  // ── EL POSTEO ─────────────────────────────────────────────────────────────
  let entryId: string;
  try {
    entryId = await postJournalEntry(db, tenantId, asiento, userId);
  } catch (err) {
    // ── CAPA 3: el UNIQUE de la 034 ─────────────────────────────────────────
    // ⚠️ El código de Postgres viaja en `MutationError.detail`, NO en `cause`
    // (`postJournalEntry()` hace `new MutationError(msg, 422, error)`).
    const codigo =
      (err as MutationError)?.detail && typeof (err as MutationError).detail === "object"
        ? ((err as MutationError).detail as { code?: string }).code
        : (err as { code?: string })?.code;
    if (codigo === "23505") {
      const { data: ganador } = await db
        .from("journal_entries")
        .select("entry_number")
        .eq("tenant_id", tenantId)
        .eq("source_type", SOURCE_TYPE_GASTO_TRAMITE)
        .eq("source_id", expenseId)
        .maybeSingle();
      throw new MutationError(yaPosteado((ganador as { entry_number: number } | null)?.entry_number ?? null), 409);
    }
    if (err instanceof MutationError) {
      // Los mensajes del RPC ya vienen redactados en español desde la `028`
      // (período cerrado, cuenta inexistente, asiento descuadrado).
      throw err;
    }
    throw new MutationError("No se pudo registrar el asiento", 500, err);
  }

  // ── El cache. Si falla, NO se falla la operación ──────────────────────────
  const { data: creado } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("id", entryId)
    .maybeSingle();

  const { error: errCache } = await db
    .from("expenses")
    .update({ posted_entry_id: entryId })
    .eq("id", expenseId)
    .eq("tenant_id", tenantId);
  if (errCache) {
    // El trigger de la `038` deja pasar este UPDATE a propósito.
    console.error("[expenses/postear] el asiento se posteó pero el cache no se pudo escribir", {
      expenseId,
      entryId,
      error: errCache,
    });
  }

  return {
    entry_id: entryId,
    entry_number: (creado as { entry_number: number } | null)?.entry_number ?? null,
    lineas: armado.asiento.lines.length,
  };
}

export interface ReverseExpenseTramiteResult {
  entry_id: string;
  entry_number: number;
  reversed_entry_number: number;
  transaction_date: string;
  expense: { id: string; status: string };
}

export async function reverseExpenseTramite(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  expenseId: string,
  reason: string,
  /** Fecha de registro elegida. Sin ella, hoy en Panamá. */
  fechaDeRegistro?: unknown
): Promise<ReverseExpenseTramiteResult> {
  const { data: gasto, error: errGasto } = await db
    .from("expenses")
    .select("id, status, amount_paid")
    .eq("tenant_id", tenantId)
    .eq("id", expenseId)
    .maybeSingle();
  if (errGasto) {
    throw new MutationError("No se pudo leer el gasto", 500, errGasto);
  }
  if (!gasto) {
    throw new MutationError("Gasto no encontrado", 404);
  }
  if (gasto.status === "anulado") {
    throw new MutationError("Este gasto ya está anulado.", 409);
  }
  if (Number(gasto.amount_paid ?? 0) > 0) {
    throw new MutationError(
      "Este gasto tiene pagos registrados. Primero elimine (sin asiento) o reverse (con asiento) " +
        "los pagos; después se reversa el gasto.",
      409
    );
  }

  const original = await getAsientoDeGastoTramite(db, tenantId, expenseId);
  if (!original) {
    throw new MutationError(
      "Este gasto no está en el libro contable, así que no hay nada que reversar. " +
        "Un gasto sin asiento se edita o se elimina desde el caso.",
      409
    );
  }

  // Fecha de registro elegida (revisión del 28/09 y reunión del 30/09): período
  // abierto y nunca antes del original. El RPC lo vuelve a exigir.
  const fecha = await resolverFechaDeRegistro(db, tenantId, fechaDeRegistro, {
    noAntesDe: { fecha: original.transaction_date, etiqueta: `el asiento ${original.entry_number}` },
    que: "la reversión",
    campo: "fecha_registro",
  });
  const armado = construirAsientoDeReversion(original, { fecha, motivo: reason, source_id: expenseId });
  if (!armado.ok) {
    throw new MutationError(armado.mensaje, 422);
  }

  const { data, error } = await ledgerDb.rpc("reverse_expense_tramite", {
    p_tenant_id: tenantId,
    p_expense_id: expenseId,
    p_reason: armado.asiento.reversal_reason,
    p_transaction_date: armado.asiento.transaction_date,
    p_description: armado.asiento.description,
    p_lines: armado.asiento.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
      // E2: el tercero de la línea viaja al RPC (el espejo lo conserva).
      client_id: l.client_id ?? null,
      supplier_id: l.supplier_id ?? null,
    })),
    p_created_by: userId,
  });
  if (error) {
    console.error("[finanzas/api] reverse_expense_tramite failed", error);
    throw new MutationError(error.message || "No se pudo reversar el gasto", 422, error);
  }

  const r = data as {
    entry_id: string;
    entry_number: number;
    reversed_entry_number: number;
    transaction_date: string;
    expense: { id: string; status: string };
  } | null;
  if (!r || !r.entry_id) {
    throw new MutationError("El gasto se reversó pero no se pudo leer el asiento resultante", 500);
  }
  return {
    entry_id: r.entry_id,
    entry_number: Number(r.entry_number),
    reversed_entry_number: Number(r.reversed_entry_number),
    transaction_date: r.transaction_date,
    expense: r.expense,
  };
}

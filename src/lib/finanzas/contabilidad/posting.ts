/**
 * Posteo de asientos contables — envoltorio tipado del RPC `post_journal_entry`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARCHIVO NO ESCRIBE EN EL LEDGER. LLAMA AL RPC QUE LO HACE.
 * ─────────────────────────────────────────────────────────────────────────────
 * Toda la lógica —partida doble, período, correlativo sin huecos, cadena de
 * hash— vive en `sql/pending/028_fase2_motor_posteo.sql`, y no por gusto:
 *
 *   Un asiento son DOS escrituras (cabecera + líneas) y supabase-js no tiene
 *   transacciones multi-statement. Si la segunda fallara, la cabecera ya estaría
 *   escrita y NO se podría borrar: los triggers de la migración 023 rechazan el
 *   DELETE sobre `journal_entries`. Quedaría un asiento sin líneas, descuadrado
 *   y permanente, en los libros que el contador certifica ante la DGI.
 *
 * Por eso acá NO se replica ninguna validación del RPC. Duplicarla sería peor
 * que no tenerla: dos copias que se desincronizan dan la ilusión de que algo
 * está validado cuando ya no lo está. Lo único que se hace de este lado es
 * armar el payload, tipar la respuesta y traducir los errores de Postgres a
 * mensajes accionables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 SOLO SERVER-SIDE, Y EL TENANT LO PONE LA RUTA
 * ─────────────────────────────────────────────────────────────────────────────
 * Desde la migración `030`, el RPC tiene EXECUTE solo para `service_role` y es
 * SECURITY DEFINER. Dos consecuencias que NO son opcionales:
 *
 *   1. Llamar a `postJournalEntry()` desde un client component da 403. Todo el
 *      posteo va por rutas de API con el cliente de servicio.
 *
 *   2. La función **ya no corre bajo RLS**: confía en el `tenantId` que recibe.
 *      Quien la llame tiene que sacarlo del PERFIL DEL USUARIO AUTENTICADO
 *      (`getAuthenticatedContext().tenantId`) y **nunca del cuerpo del
 *      request**. Un `tenant_id` que llegue en el body es un intento de escribir
 *      en el ledger de otro bufete.
 *
 * Es la única garantía de aislamiento que se mudó de la base al código.
 *
 * ⚠️ NO EXISTE TODAVÍA EL ASIENTO DE APERTURA. `source_type: 'apertura'` ya se
 * acepta, pero generarlo desde los saldos iniciales espera la fecha de corte que
 * está pendiente de confirmación del contador (consulta 1 del task_plan): lo
 * cargado hoy es una foto de mitad de año, no una apertura al 1 de enero.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError } from "@/lib/finanzas/api/errors";

type DB = SupabaseClient;

/**
 * De dónde viene el asiento. Espeja el CHECK
 * `journal_entries_source_type_check`; si se agrega un valor, van los dos.
 *
 * ⚠️ `gasto` y `gasto_tramite` son DOS COSAS DISTINTAS, y confundirlas manda un
 * documento a la pantalla equivocada:
 *
 *   · `gasto`          → `business_expenses`, las compras del bufete.
 *                        Enlaza a `/finanzas/gastos-bufete/{id}`.
 *   · `gasto_tramite`  → `expenses`, los gastos de trámite del módulo Legal.
 *                        Enlaza a `/finanzas/gastos-tramite/{id}`.
 *
 * El mapeo vive en `reports/destino-documento.ts`. Reusar `gasto` para los dos
 * llevaría un gasto de trámite a la pantalla de compras con un id que ahí no
 * existe — el bug del 01/09/2026 que originó ese archivo.
 */
export type SourceType =
  | "factura"
  | "gasto"
  | "gasto_tramite"
  | "pago"
  | "nota_credito"
  | "manual"
  | "reversion"
  | "apertura";

export const SOURCE_TYPES: SourceType[] = [
  "factura",
  "gasto",
  "gasto_tramite",
  "pago",
  "nota_credito",
  "manual",
  "reversion",
  "apertura",
];

/**
 * Una línea del asiento.
 *
 * La cuenta se identifica por CÓDIGO, no por id: el código es la identidad
 * contable de la cuenta y es inmutable por regla de la app (ver
 * `api/chart-of-accounts.ts`). Además hace legible cualquier log.
 *
 * `debit` y `credit` son excluyentes: una línea es débito O crédito, nunca las
 * dos ni ninguna. Lo hace cumplir el RPC.
 */
export interface LineaAsiento {
  account_code: string;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface AsientoInput {
  /** Fecha de la OPERACIÓN (Art. 5.1). Define el período contable. ISO. */
  transaction_date: string;
  /** Naturaleza de la operación (Art. 5.5). Obligatoria. */
  description: string;
  source_type: SourceType;
  lines: LineaAsiento[];
  source_id?: string | null;
  source_cufe?: string | null;
  /** Solo para `source_type: 'reversion'`: el asiento que se corrige. */
  reverses_entry_id?: string | null;
  /** Solo para reversión: motivo, mínimo 3 caracteres (Art. 5.7). */
  reversal_reason?: string | null;
  /** Fecha de REGISTRO. Default: hoy (doble fecha, Art. 13a). ISO. */
  record_date?: string | null;
}

/**
 * Postea un asiento. Devuelve el id del asiento creado.
 *
 * Lanza `MutationError` con un mensaje ya en español si el RPC rechaza: el
 * asiento no cuadra, el período está cerrado o no existe, una cuenta no está en
 * el plan, etc. Esos mensajes vienen del RPC y son directamente mostrables.
 */
export async function postJournalEntry(
  db: DB,
  tenantId: string,
  input: AsientoInput,
  userId?: string | null
): Promise<string> {
  const { data, error } = await db.rpc("post_journal_entry", {
    p_tenant_id: tenantId,
    p_transaction_date: input.transaction_date,
    p_description: input.description,
    p_source_type: input.source_type,
    p_lines: input.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
    })),
    p_source_id: input.source_id ?? null,
    p_source_cufe: input.source_cufe ?? null,
    p_reverses_entry_id: input.reverses_entry_id ?? null,
    p_reversal_reason: input.reversal_reason ?? null,
    p_created_by: userId ?? null,
    p_record_date: input.record_date ?? null,
  });

  if (error) {
    console.error("[contabilidad] post_journal_entry failed", error);
    // `error.message` del RPC ya viene redactado para que lo lea un humano
    // (ver los RAISE EXCEPTION de la migración 028). 422 y no 500: el caso
    // normal es que el asiento esté mal armado, no que la base esté rota.
    throw new MutationError(
      error.message || "No se pudo registrar el asiento contable",
      422,
      error
    );
  }

  if (!data || typeof data !== "string") {
    throw new MutationError(
      "El asiento se registró pero no se pudo leer su identificador",
      500
    );
  }

  return data;
}

/** Un eslabón roto de la cadena de hash. */
export interface EslabonRoto {
  nro_asiento: number;
  problema: string;
}

/**
 * Verifica la cadena de hash del ledger. Array vacío = cadena íntegra.
 *
 * Una cadena de hash que nadie verifica es decoración. Conviene correrla antes
 * de sellar el legajo anual y ante cualquier sospecha.
 */
export async function verifyAccountingChain(
  db: DB,
  tenantId: string
): Promise<EslabonRoto[]> {
  const { data, error } = await db.rpc("verify_accounting_chain", {
    p_tenant_id: tenantId,
  });

  if (error) {
    console.error("[contabilidad] verify_accounting_chain failed", error);
    throw new MutationError(
      "No se pudo verificar la integridad de la cadena contable",
      500,
      error
    );
  }

  return (data ?? []) as EslabonRoto[];
}

/**
 * Provisiona los 12 períodos mensuales de un año. Idempotente.
 *
 * Desde la migración `030` el posteo AUTO-CREA los períodos, pero solo del año
 * en curso y del siguiente: eso saca el precipicio del 1 de enero sin perder el
 * freno contra un dedazo de fecha (un 2029 sigue fallando fuerte). Los años
 * pasados tampoco se abren solos — que un período viejo no exista significa que
 * ese ejercicio nunca se abrió, y crearlo dejaría postear dentro de un año que
 * el contador ya certificó.
 *
 * Esta función queda para provisionar CUALQUIER año a mano, fuera de esa cota.
 */
export async function ensureAccountingPeriods(
  db: DB,
  tenantId: string,
  year: number
): Promise<number> {
  const { data, error } = await db.rpc("ensure_accounting_periods", {
    p_tenant_id: tenantId,
    p_year: year,
  });

  if (error) {
    console.error("[contabilidad] ensure_accounting_periods failed", error);
    throw new MutationError(
      `No se pudieron provisionar los períodos contables de ${year}`,
      500,
      error
    );
  }

  return Number(data ?? 0);
}

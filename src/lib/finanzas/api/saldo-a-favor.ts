/**
 * SALDO A FAVOR DEL CLIENTE (Bloque 1, punto 5, migración `074`).
 *
 * Un cobro que supera lo aplicado deja `payments.amount_unapplied > 0`: el
 * dinero ya entró al banco y está en 100004 a favor del cliente (el asiento del
 * cobro es por el TOTAL). Aplicarlo a una factura nueva NO postea nada: sólo
 * dice a qué factura cancela, y T7a/T7b derivan los saldos.
 *
 * 🔑 SOP-014: el RPC va con el cliente de SERVICIO; el tenant sale del perfil
 *    autenticado. Las lecturas van con la sesión (RLS).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError } from "@/lib/finanzas/api/errors";

type DB = SupabaseClient;

export interface SaldoAFavor {
  payment_id: string;
  payment_number: string | null;
  payment_date: string;
  /** Lo que todavía no se aplicó a ninguna factura. */
  disponible: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Los cobros CONTABILIZADOS de un cliente con saldo sin aplicar, del más viejo
 * al más nuevo (es el orden en que se consumen). Un cobro sin asiento no entra:
 * su saldo no está en el libro (el RPC lo rechaza igual).
 */
export async function listarSaldosAFavor(db: DB, tenantId: string, clientId: string): Promise<SaldoAFavor[]> {
  const { data, error } = await db
    .from("payments")
    .select("id, payment_number, payment_date, amount_unapplied, status")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .neq("status", "anulado")
    .gt("amount_unapplied", 0.005)
    .order("payment_date", { ascending: true });
  if (error) throw new MutationError("No se pudo leer el saldo a favor del cliente.", 500, error);
  const filas = (data ?? []) as { id: string; payment_number: string | null; payment_date: string; amount_unapplied: number | string }[];
  if (filas.length === 0) return [];

  const { data: asientos } = await db
    .from("journal_entries")
    .select("source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", "pago")
    .in("source_id", filas.map((f) => f.id));
  const contabilizados = new Set(((asientos ?? []) as { source_id: string }[]).map((a) => a.source_id));

  return filas
    .filter((f) => contabilizados.has(f.id))
    .map((f) => ({
      payment_id: f.id,
      payment_number: f.payment_number,
      payment_date: String(f.payment_date).slice(0, 10),
      disponible: round2(Number(f.amount_unapplied)),
    }));
}

export interface AplicacionDeSaldo {
  invoice_id: string;
  amount: number;
}

/** Aplica el saldo a favor de un cobro. Los rechazos del RPC ya vienen redactados. */
export async function aplicarSaldoAFavor(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  paymentId: string,
  aplicaciones: AplicacionDeSaldo[]
): Promise<{ aplicado: number; saldo_a_favor: number }> {
  if (aplicaciones.length === 0) {
    throw new MutationError("Elige a qué factura aplicar el saldo a favor.", 400);
  }
  for (const a of aplicaciones) {
    if (!a.invoice_id || !isFinite(a.amount) || a.amount <= 0) {
      throw new MutationError("Cada aplicación lleva una factura y un monto mayor que cero.", 400);
    }
  }
  const { data, error } = await ledgerDb.rpc("apply_payment_credit", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
    p_applications: aplicaciones.map((a) => ({ invoice_id: a.invoice_id, amount: round2(a.amount) })),
    p_created_by: userId,
  });
  if (error) {
    throw new MutationError(error.message || "No se pudo aplicar el saldo a favor.", 422, error);
  }
  const r = data as { aplicado: number | string; saldo_a_favor: number | string };

  // El audit_log no frena la operación: lo irreversible ya pasó y está bien.
  try {
    await db.from("audit_log").insert({
      tenant_id: tenantId,
      user_id: userId,
      entity: "payment",
      entity_id: paymentId,
      action: "update",
      field: "aplicar_saldo_a_favor",
      old_value: null,
      new_value: JSON.stringify(aplicaciones),
    });
  } catch (err) {
    console.warn("[finanzas] aplicarSaldoAFavor: audit_log insert falló", err);
  }

  return { aplicado: round2(Number(r.aplicado)), saldo_a_favor: round2(Number(r.saldo_a_favor)) };
}

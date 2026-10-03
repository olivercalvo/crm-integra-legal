/**
 * PENDIENTES DE ENVIAR A LA DGI (03/10/2026).
 *
 * Facturas, ND y NC EMITIDAS que no tienen autorización de la DGI: `fe_estado`
 * `no_emitida` (nunca se mandó, o se cortó en la validación previa) o `error`
 * (la DGI la rechazó o falló la conexión). Es la lista que faltaba cuando 4
 * facturas de producción quedaron así sin que nadie se enterara.
 *
 * Qué NO entra:
 *   · con CUFE: ya existe ante la DGI (también las del portal con su CUFE cargado);
 *   · `interna`: se decidió no mandarla (083);
 *   · `pending`: está en curso;
 *   · anuladas y borradores;
 *   · lo anterior a `PENDIENTES_DGI_DESDE`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

/**
 * 🔴 Desde cuándo un documento sin CUFE es un pendiente. Antes de junio de 2026
 * el CRM no mandaba a la DGI (las facturas se emitían a mano en el portal de
 * ideati) y en la base esas facturas se ven IGUAL que una no enviada: sin
 * CUFE y `no_emitida`. Oliver, 03/10: «el CRM autoriza facturas a la DGI desde
 * junio de 2026; mayo fue de prueba». Lo del portal entre el 01/06 y el 07/07
 * aparece en la lista y se resuelve cargándole su CUFE (`POST …/cufe`).
 */
export const PENDIENTES_DGI_DESDE = "2026-06-01";

const ESTADOS_DE_FACTURA_EMITIDA = ["emitida", "parcialmente_pagada", "pagada"];
const PENDIENTE = ["no_emitida", "error"];

export interface PendienteDgi {
  tipo: "factura" | "nota_debito" | "nota_credito";
  id: string;
  numero: string;
  fecha: string;
  cliente: string;
  monto: number;
  creadoPor: string | null;
  creadoPorId: string | null;
  feEstado: "no_emitida" | "error";
  motivo: string | null;
  motivoEn: string | null;
}

const uno = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * La lista completa, del más viejo al más nuevo. `soloDe` filtra por quien lo
 * creó (la tarjeta de la abogada ve sólo los suyos).
 */
export async function listarPendientesDgi(db: DB, tenantId: string, soloDe?: string | null): Promise<PendienteDgi[]> {
  let qf = db
    .from("invoices")
    .select(
      "id, invoice_number, invoice_kind, issue_date, grand_total, fe_estado, fe_motivo_pendiente, fe_motivo_pendiente_en, created_by, client:clients!invoices_client_id_fkey(name), creador:users!invoices_created_by_fkey(full_name)"
    )
    .eq("tenant_id", tenantId)
    .in("status", ESTADOS_DE_FACTURA_EMITIDA)
    .in("fe_estado", PENDIENTE)
    .is("dgi_cufe", null)
    .gte("issue_date", PENDIENTES_DGI_DESDE);
  if (soloDe) qf = qf.eq("created_by", soloDe);

  let qn = db
    .from("credit_notes")
    .select(
      "id, credit_note_number, issue_date, grand_total, fe_estado, fe_motivo_pendiente, fe_motivo_pendiente_en, created_by, client:clients!credit_notes_client_id_fkey(name), creador:users!credit_notes_created_by_fkey(full_name)"
    )
    .eq("tenant_id", tenantId)
    .eq("status", "emitida")
    .in("fe_estado", PENDIENTE)
    .is("dgi_cufe", null)
    .gte("issue_date", PENDIENTES_DGI_DESDE);
  if (soloDe) qn = qn.eq("created_by", soloDe);

  const [f, n] = await Promise.all([qf, qn]);
  if (f.error) console.error("[pendientes-dgi] facturas", f.error.message);
  if (n.error) console.error("[pendientes-dgi] notas de crédito", n.error.message);

  const filas: PendienteDgi[] = [
    ...((f.data ?? []) as Record<string, unknown>[]).map((r) => ({
      tipo: (r.invoice_kind === "NOTA_DEBITO" ? "nota_debito" : "factura") as PendienteDgi["tipo"],
      id: String(r.id),
      numero: String(r.invoice_number ?? ""),
      fecha: String(r.issue_date),
      cliente: String((uno(r.client as { name: string } | null) ?? { name: "" }).name ?? ""),
      monto: Number(r.grand_total),
      creadoPor: (uno(r.creador as { full_name: string } | null) ?? { full_name: null as unknown as string }).full_name ?? null,
      creadoPorId: (r.created_by as string | null) ?? null,
      feEstado: r.fe_estado as PendienteDgi["feEstado"],
      motivo: (r.fe_motivo_pendiente as string | null) ?? null,
      motivoEn: (r.fe_motivo_pendiente_en as string | null) ?? null,
    })),
    ...((n.data ?? []) as Record<string, unknown>[]).map((r) => ({
      tipo: "nota_credito" as const,
      id: String(r.id),
      numero: String(r.credit_note_number ?? ""),
      fecha: String(r.issue_date),
      cliente: String((uno(r.client as { name: string } | null) ?? { name: "" }).name ?? ""),
      monto: Number(r.grand_total),
      creadoPor: (uno(r.creador as { full_name: string } | null) ?? { full_name: null as unknown as string }).full_name ?? null,
      creadoPorId: (r.created_by as string | null) ?? null,
      feEstado: r.fe_estado as PendienteDgi["feEstado"],
      motivo: (r.fe_motivo_pendiente as string | null) ?? null,
      motivoEn: (r.fe_motivo_pendiente_en as string | null) ?? null,
    })),
  ];
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero));
}

/** Cuántos hay (la tarjeta del dashboard y el aviso del listado de facturas). */
export async function contarPendientesDgi(db: DB, tenantId: string, soloDe?: string | null): Promise<number> {
  const contar = async (tabla: "invoices" | "credit_notes") => {
    let q = db
      .from(tabla)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("fe_estado", PENDIENTE)
      .is("dgi_cufe", null)
      .gte("issue_date", PENDIENTES_DGI_DESDE);
    q = tabla === "invoices" ? q.in("status", ESTADOS_DE_FACTURA_EMITIDA) : q.eq("status", "emitida");
    if (soloDe) q = q.eq("created_by", soloDe);
    const { count, error } = await q;
    return error ? 0 : count ?? 0;
  };
  const [f, n] = await Promise.all([contar("invoices"), contar("credit_notes")]);
  return f + n;
}

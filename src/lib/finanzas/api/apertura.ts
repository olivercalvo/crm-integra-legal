/**
 * ASIENTO DE APERTURA (100/101): cargar, revisar en seco, contabilizar,
 * reversar y cuadrar al corte. La regla pura vive en `contabilidad/apertura.ts`;
 * acá están las lecturas y las llamadas a los RPC.
 *
 * 🔴 Lo aprieta una persona desde /finanzas/asientos/apertura (admin y
 *    contador). El tenant sale del perfil; el libro se escribe con el cliente de
 *    servicio y el usuario en `x-actor-id` (bitácora).
 * 🔴 La reversión lleva SIEMPRE la fecha de la apertura y sólo con su mes
 *    abierto (101). Con el mes cerrado, la corrección es un ajuste a mano.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { cargarInicioContable, fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import {
  cuadreAlCorte,
  saldosDeLasLineas,
  validarApertura,
  type ContextoDeApertura,
  type CuadreAlCorte,
  type CuentaDeApertura,
  type ResultadoDeApertura,
  type SaldoDeDocumento,
} from "@/lib/finanzas/contabilidad/apertura";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { getAsientoDelLibro } from "@/lib/finanzas/queries/asiento-manual";
import { leerHojaDeApertura, type FilaPrecargada } from "@/lib/finanzas/import/apertura-workbook";
import { DE_PRUEBA } from "@/lib/finanzas/documentos-de-prueba";
import { FORMATO_DE_FECHA_POR_DEFECTO, type FormatoDeFecha } from "@/lib/finanzas/import/asientos-import";

type DB = SupabaseClient;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const MENSAJE_MES_DE_APERTURA_CERRADO = (fecha: string) =>
  `El mes de la apertura (${fechaCorta(fecha).slice(3)}) está cerrado: la apertura ya no se reversa. ` +
  "Si hay que corregir un saldo, se hace con un asiento de ajuste a mano en Asientos de Diario.";

// ---------------------------------------------------------------------------
// Fecha y estado
// ---------------------------------------------------------------------------

/** La fecha efectiva: el parámetro, o el día anterior al inicio contable. */
export async function cargarFechaDeApertura(db: DB, tenantId: string): Promise<{ fecha: string; inicio: string; esParametro: boolean }> {
  const inicio = await cargarInicioContable(db, tenantId);
  const { data } = await db.from("finanzas_parametros").select("fecha_apertura").eq("tenant_id", tenantId).maybeSingle();
  const param = (data as { fecha_apertura: string | null } | null)?.fecha_apertura ?? null;
  if (param) return { fecha: String(param).slice(0, 10), inicio, esParametro: true };
  const d = new Date(`${inicio}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { fecha: d.toISOString().slice(0, 10), inicio, esParametro: false };
}

async function mesAbierto(db: DB, tenantId: string, fecha: string): Promise<boolean> {
  const { data } = await db
    .from("accounting_periods")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("year", Number(fecha.slice(0, 4)))
    .eq("month", Number(fecha.slice(5, 7)))
    .maybeSingle();
  // Sin período: post_apertura lo crea abierto.
  return !data || (data as { status: string }).status === "abierto";
}

export interface AperturaRegistrada {
  id: string;
  entryId: string;
  entryNumber: number;
  referencia: string | null;
  fecha: string;
  archivo: string;
  lineas: number;
  totalDebitos: number;
  estado: "vigente" | "reversada";
  creadaEl: string;
  creadaPor: string | null;
  reversion: { entryNumber: number | null; motivo: string | null; el: string | null; por: string | null } | null;
}

export async function listarAperturas(db: DB, tenantId: string): Promise<AperturaRegistrada[]> {
  const { data, error } = await db
    .from("aperturas")
    .select(
      "id, entry_id, fecha, file_name, lineas, total_debitos, estado, created_at, motivo_reversion, reversed_at, " +
        "creador:users!aperturas_created_by_fkey(full_name), reversor:users!aperturas_reversed_by_fkey(full_name), " +
        "asiento:journal_entries!aperturas_entry_id_fkey(entry_number, reference), " +
        "reversion:journal_entries!aperturas_reversal_entry_id_fkey(entry_number)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  type Fila = {
    id: string; entry_id: string; fecha: string; file_name: string; lineas: number; total_debitos: number | string;
    estado: "vigente" | "reversada"; created_at: string; motivo_reversion: string | null; reversed_at: string | null;
    creador: { full_name: string } | null; reversor: { full_name: string } | null;
    asiento: { entry_number: number; reference: string | null } | null; reversion: { entry_number: number } | null;
  };
  return ((data ?? []) as unknown as Fila[]).map((a) => ({
    id: a.id,
    entryId: a.entry_id,
    entryNumber: Number(a.asiento?.entry_number ?? 0),
    referencia: a.asiento?.reference ?? null,
    fecha: String(a.fecha).slice(0, 10),
    archivo: a.file_name,
    lineas: a.lineas,
    totalDebitos: Number(a.total_debitos),
    estado: a.estado,
    creadaEl: a.created_at,
    creadaPor: a.creador?.full_name ?? null,
    reversion: a.estado === "reversada"
      ? { entryNumber: a.reversion?.entry_number ?? null, motivo: a.motivo_reversion, el: a.reversed_at, por: a.reversor?.full_name ?? null }
      : null,
  }));
}

export interface EstadoDeLaApertura {
  fecha: string;
  inicio: string;
  fechaEsParametro: boolean;
  mesAbierto: boolean;
  vigente: AperturaRegistrada | null;
  historial: AperturaRegistrada[];
}

export async function cargarEstadoDeLaApertura(db: DB, tenantId: string): Promise<EstadoDeLaApertura> {
  const [{ fecha, inicio, esParametro }, historial] = await Promise.all([cargarFechaDeApertura(db, tenantId), listarAperturas(db, tenantId)]);
  const vigente = historial.find((a) => a.estado === "vigente") ?? null;
  return {
    fecha: vigente?.fecha ?? fecha,
    inicio,
    fechaEsParametro: esParametro,
    mesAbierto: await mesAbierto(db, tenantId, vigente?.fecha ?? fecha),
    vigente,
    historial,
  };
}

// ---------------------------------------------------------------------------
// Contexto de la plantilla
// ---------------------------------------------------------------------------

export async function cargarContextoDeApertura(db: DB, tenantId: string, fechaApertura: string): Promise<ContextoDeApertura> {
  const [cuentas, clientes, proveedores] = await Promise.all([
    db.from("chart_of_accounts").select("code, name, account_type, active, cuenta_control").eq("tenant_id", tenantId).order("code"),
    db.from("clients").select("id, client_number, name, es_de_prueba").eq("tenant_id", tenantId),
    db.from("suppliers").select("id, supplier_number, legal_name, trade_name").eq("tenant_id", tenantId),
  ]);
  for (const r of [cuentas, clientes, proveedores]) if (r.error) throw new MutationError(pgErrorToMessage(r.error), 500, r.error);
  const ctx: ContextoDeApertura = { fechaApertura, cuentas: new Map(), clientes: new Map(), proveedores: new Map() };
  for (const c of (cuentas.data ?? []) as CuentaDeApertura[]) ctx.cuentas.set(c.code, c);
  for (const c of (clientes.data ?? []) as { id: string; client_number: string | null; name: string; es_de_prueba: boolean }[]) {
    if (c.client_number) ctx.clientes.set(c.client_number.trim().toUpperCase(), { id: c.id, nombre: c.name, dePrueba: !!c.es_de_prueba });
  }
  for (const p of (proveedores.data ?? []) as { id: string; supplier_number: string | null; legal_name: string; trade_name: string | null }[]) {
    if (p.supplier_number) ctx.proveedores.set(p.supplier_number.trim().toUpperCase(), { id: p.id, nombre: p.trade_name?.trim() || p.legal_name });
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Lo que el CRM conoce al corte (precarga y lado CRM del cuadre)
// ---------------------------------------------------------------------------

export interface SaldoCrmAlCorte extends SaldoDeDocumento {
  cuenta: "100004" | "200001";
  vencimiento: string | null;
}

/**
 * El saldo al corte de cada documento del CRM con fecha hasta el corte:
 * facturas (menos cobros y NC hasta el corte) para los clientes; compras y
 * gastos de trámite (menos pagos y NC hasta el corte) para los proveedores. Sin
 * los documentos de prueba. Un gasto sin proveedor va como «(sin proveedor)».
 */
export async function saldosCrmAlCorte(db: DB, tenantId: string, corte: string): Promise<SaldoCrmAlCorte[]> {
  const out: SaldoCrmAlCorte[] = [];

  const { data: facturas, error: e1 } = await db
    .from("invoices")
    .select("id, invoice_number, issue_date, due_date, grand_total, status, client_id, clients(client_number, name)")
    .eq("tenant_id", tenantId)
    .eq(DE_PRUEBA, false)
    .in("status", ["emitida", "parcialmente_pagada", "pagada"])
    .lte("issue_date", corte);
  if (e1) throw new MutationError(pgErrorToMessage(e1), 500, e1);
  type Fac = { id: string; invoice_number: string; issue_date: string; due_date: string | null; grand_total: number | string;
    client_id: string; clients: { client_number: string | null; name: string } | null };
  const facs = (facturas ?? []) as unknown as Fac[];
  if (facs.length > 0) {
    const ids = facs.map((f) => f.id);
    const [apl, ncs] = await Promise.all([
      db.from("payment_applications").select("invoice_id, amount_applied, payments!inner(payment_date, status)")
        .eq("tenant_id", tenantId).in("invoice_id", ids).lte("payments.payment_date", corte),
      db.from("credit_notes").select("invoice_id, grand_total, status, accounting_date, issue_date")
        .eq("tenant_id", tenantId).eq(DE_PRUEBA, false).eq("status", "emitida").in("invoice_id", ids),
    ]);
    const menos = new Map<string, number>();
    for (const a of (apl.data ?? []) as unknown as { invoice_id: string; amount_applied: number | string }[]) {
      menos.set(a.invoice_id, (menos.get(a.invoice_id) ?? 0) + Number(a.amount_applied));
    }
    for (const n of (ncs.data ?? []) as { invoice_id: string; grand_total: number | string; accounting_date: string | null; issue_date: string }[]) {
      if (String(n.accounting_date ?? n.issue_date).slice(0, 10) <= corte) menos.set(n.invoice_id, (menos.get(n.invoice_id) ?? 0) + Number(n.grand_total));
    }
    for (const f of facs) {
      const saldo = r2(Number(f.grand_total) - (menos.get(f.id) ?? 0));
      if (Math.abs(saldo) < 0.005) continue;
      out.push({ lado: "cliente", cuenta: "100004", terceroId: f.client_id, terceroCodigo: f.clients?.client_number ?? null,
        terceroNombre: f.clients?.name ?? "", documento: f.invoice_number, fecha: String(f.issue_date).slice(0, 10),
        vencimiento: f.due_date ? String(f.due_date).slice(0, 10) : null, saldo });
    }
  }

  // Proveedores: compras y gastos de trámite.
  const [compras, gastos, pagos, nccs] = await Promise.all([
    db.from("business_expenses").select("id, purchase_number, supplier_invoice_number, expense_date, due_date, total, supplier_id, suppliers(supplier_number, legal_name, trade_name)")
      .eq("tenant_id", tenantId).lte("expense_date", corte),
    db.from("expenses").select("id, purchase_number, supplier_invoice_number, concept, date, amount, status, supplier_id, suppliers(supplier_number, legal_name, trade_name)")
      .eq("tenant_id", tenantId).eq(DE_PRUEBA, false).lte("date", corte),
    db.from("supplier_payments").select("business_expense_id, expense_id, amount, status, payment_date")
      .eq("tenant_id", tenantId).lte("payment_date", corte),
    db.from("supplier_credit_notes").select("business_expense_id, grand_total, status, issue_date")
      .eq("tenant_id", tenantId).eq("status", "emitida").lte("issue_date", corte),
  ]);
  for (const r of [compras, gastos, pagos, nccs]) if (r.error) throw new MutationError(pgErrorToMessage(r.error), 500, r.error);
  const pagado = new Map<string, number>();
  for (const p of (pagos.data ?? []) as { business_expense_id: string | null; expense_id: string | null; amount: number | string; status: string }[]) {
    if (p.status === "anulado") continue;
    const k = p.business_expense_id ?? p.expense_id;
    if (k) pagado.set(k, (pagado.get(k) ?? 0) + Number(p.amount));
  }
  for (const n of (nccs.data ?? []) as { business_expense_id: string | null; grand_total: number | string }[]) {
    if (n.business_expense_id) pagado.set(n.business_expense_id, (pagado.get(n.business_expense_id) ?? 0) + Number(n.grand_total));
  }
  type Prv = { supplier_number: string | null; legal_name: string; trade_name: string | null } | null;
  const nombre = (s: Prv) => (s ? s.trade_name?.trim() || s.legal_name : "(sin proveedor)");
  for (const b of (compras.data ?? []) as unknown as { id: string; purchase_number: string | null; supplier_invoice_number: string | null;
    expense_date: string; due_date: string | null; total: number | string; supplier_id: string | null; suppliers: Prv }[]) {
    const saldo = r2(Number(b.total) - (pagado.get(b.id) ?? 0));
    if (Math.abs(saldo) < 0.005) continue;
    out.push({ lado: "proveedor", cuenta: "200001", terceroId: b.supplier_id ?? "sin-proveedor", terceroCodigo: b.suppliers?.supplier_number ?? null,
      terceroNombre: nombre(b.suppliers), documento: b.supplier_invoice_number || b.purchase_number, fecha: String(b.expense_date).slice(0, 10),
      vencimiento: b.due_date ? String(b.due_date).slice(0, 10) : null, saldo });
  }
  for (const g of (gastos.data ?? []) as unknown as { id: string; purchase_number: string | null; supplier_invoice_number: string | null;
    concept: string; date: string; amount: number | string; status: string | null; supplier_id: string | null; suppliers: Prv }[]) {
    if (g.status === "anulado") continue;
    const saldo = r2(Number(g.amount) - (pagado.get(g.id) ?? 0));
    if (Math.abs(saldo) < 0.005) continue;
    out.push({ lado: "proveedor", cuenta: "200001", terceroId: g.supplier_id ?? "sin-proveedor", terceroCodigo: g.suppliers?.supplier_number ?? null,
      terceroNombre: nombre(g.suppliers), documento: g.supplier_invoice_number || g.purchase_number || g.concept,
      fecha: String(g.date).slice(0, 10), vencimiento: null, saldo });
  }
  return out;
}

/** La precarga de la plantilla: sólo lo que el CRM conoce, con tercero. */
export async function precargaDeApertura(db: DB, tenantId: string, corte: string): Promise<FilaPrecargada[]> {
  const saldos = await saldosCrmAlCorte(db, tenantId, corte);
  return saldos
    .filter((s) => s.terceroCodigo && s.terceroId !== "sin-proveedor")
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta) || (a.terceroCodigo ?? "").localeCompare(b.terceroCodigo ?? "") || (a.fecha ?? "").localeCompare(b.fecha ?? ""))
    .map((s) => {
      // Saldo a favor (negativo): va del otro lado.
      const debitoNatural = s.lado === "cliente";
      const monto = Math.abs(s.saldo);
      const alDebito = s.saldo >= 0 ? debitoNatural : !debitoNatural;
      return { cuenta: s.cuenta, tercero: s.terceroCodigo ?? "", documento: s.documento ?? "", fecha: s.fecha, vencimiento: s.vencimiento,
        debito: alDebito ? monto : 0, credito: alDebito ? 0 : monto };
    });
}

// ---------------------------------------------------------------------------
// En seco y contabilizar
// ---------------------------------------------------------------------------

export function hashDelArchivo(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface VistaPreviaDeApertura {
  hash: string;
  fecha: string;
  resultado: ResultadoDeApertura;
  cuadre: CuadreAlCorte;
  bloqueos: string[];
}

async function bloqueosParaContabilizar(db: DB, tenantId: string, fecha: string): Promise<string[]> {
  const b: string[] = [];
  const { data: vig } = await db.from("aperturas").select("id").eq("tenant_id", tenantId).eq("estado", "vigente").maybeSingle();
  if (vig) b.push("Ya hay una apertura vigente. Para cargar otra, primero se reversa la que está.");
  if (!(await mesAbierto(db, tenantId, fecha))) {
    b.push(`El mes de la apertura (${fechaCorta(fecha).slice(3)}) está cerrado: se reabre en Períodos contables antes de cargarla.`);
  }
  return b;
}

export async function previsualizarApertura(
  db: DB,
  tenantId: string,
  buffer: Buffer,
  /** Cómo leer `nn/nn/AAAA` escrito como texto (08/10/2026). */
  formatoDeFecha: FormatoDeFecha = FORMATO_DE_FECHA_POR_DEFECTO
): Promise<VistaPreviaDeApertura> {
  const { fecha } = await cargarFechaDeApertura(db, tenantId);
  const ctx = { ...(await cargarContextoDeApertura(db, tenantId, fecha)), formatoDeFecha };
  const resultado = validarApertura(leerHojaDeApertura(buffer), ctx);
  const crm = await saldosCrmAlCorte(db, tenantId, fecha);
  return {
    hash: hashDelArchivo(buffer),
    fecha,
    resultado,
    cuadre: cuadreAlCorte(saldosDeLasLineas(resultado.lineas, ctx.cuentas), crm),
    bloqueos: await bloqueosParaContabilizar(db, tenantId, fecha),
  };
}

export async function contabilizarApertura(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  buffer: Buffer,
  fileName: string,
  hashDeLaVistaPrevia: string,
  /** El MISMO formato de la vista previa: otro leería otras fechas del mismo archivo. */
  formatoDeFecha: FormatoDeFecha = FORMATO_DE_FECHA_POR_DEFECTO
): Promise<{ apertura_id: string; entry_number: number; reference: string; fecha: string; total_debitos: number }> {
  if (hashDelArchivo(buffer) !== hashDeLaVistaPrevia) {
    throw new MutationError("El archivo no es el mismo que se revisó en la vista previa. Vuelve a subirlo y revísalo.", 409);
  }
  const v = await previsualizarApertura(db, tenantId, buffer, formatoDeFecha);
  if (v.resultado.errores.length > 0) {
    throw new MutationError(`El archivo tiene ${v.resultado.errores.length} error(es). No se registró nada.`, 422);
  }
  if (v.bloqueos.length > 0) throw new MutationError(v.bloqueos.join(" "), 409);

  const { data, error } = await ledgerDb.rpc("post_apertura", {
    p_tenant_id: tenantId,
    p_description: `Asiento de apertura al ${fechaCorta(v.fecha)}`,
    p_lines: v.resultado.lineas.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
      client_id: l.client_id,
      supplier_id: l.supplier_id,
      documento_externo: l.documento_externo,
      fecha_documento: l.fecha_documento,
      vencimiento: l.vencimiento,
    })),
    p_file_name: fileName,
    p_file_hash: v.hash,
    p_created_by: userId,
  });
  if (error) {
    // Los mensajes de la base ya están en castellano; y no se escribió nada.
    throw new MutationError(`No se registró nada: ${error.message}`, error.code === "23514" ? 409 : 422, error);
  }
  const r = data as { apertura_id: string; entry_number: number; reference: string; fecha: string; total_debitos: number };
  return { ...r, total_debitos: Number(r.total_debitos) };
}

// ---------------------------------------------------------------------------
// Reversar (101): la misma fecha, el mes abierto
// ---------------------------------------------------------------------------

export async function reversarApertura(db: DB, ledgerDb: DB, tenantId: string, userId: string, motivo: unknown) {
  const texto = typeof motivo === "string" ? motivo.trim() : "";
  if (texto.length < 3 || texto.length > 1000) throw new MutationError("El motivo va de 3 a 1000 caracteres.", 400);
  const estado = await cargarEstadoDeLaApertura(db, tenantId);
  if (!estado.vigente) throw new MutationError("No hay una apertura vigente para reversar.", 404);
  if (!estado.mesAbierto) throw new MutationError(MENSAJE_MES_DE_APERTURA_CERRADO(estado.vigente.fecha), 409);

  const original = await getAsientoDelLibro(db, tenantId, estado.vigente.entryId);
  if (!original) throw new MutationError("No se encontró el asiento de la apertura.", 404);
  const armado = construirAsientoDeReversion(
    {
      id: original.id,
      entry_number: original.entry_number,
      transaction_date: original.transaction_date,
      description: original.description,
      reference: original.reference,
      lines: original.lineas.map((l) => ({
        account_code: l.account_code, account_name: l.account_name, debit: l.debit, credit: l.credit,
        description: l.descripcion, client_id: l.client_id, supplier_id: l.supplier_id,
      })),
    },
    // 101: la MISMA fecha que la apertura, siempre.
    { fecha: original.transaction_date, motivo: texto, source_id: null }
  );
  if (!armado.ok) throw new MutationError(armado.mensaje, 422);

  const { data, error } = await ledgerDb.rpc("reverse_journal_entry", {
    p_tenant_id: tenantId,
    p_entry_id: original.id,
    p_reason: armado.asiento.reversal_reason,
    p_transaction_date: armado.asiento.transaction_date,
    p_description: `Reversión de la apertura al ${fechaCorta(original.transaction_date)}`,
    p_lines: armado.asiento.lines.map((l) => ({
      account_code: l.account_code, debit: l.debit, credit: l.credit, description: l.description ?? null,
      client_id: l.client_id ?? null, supplier_id: l.supplier_id ?? null,
    })),
    p_created_by: userId,
  });
  if (error) throw new MutationError(error.message ?? "No se pudo reversar la apertura.", 409, error);
  const r = (data ?? {}) as Record<string, unknown>;
  return { entry_number: Number(r.entry_number), transaction_date: String(r.transaction_date) };
}

// ---------------------------------------------------------------------------
// Cuadre al corte de la apertura vigente
// ---------------------------------------------------------------------------

export async function cargarCuadreAlCorte(db: DB, tenantId: string): Promise<{ fecha: string; cuadre: CuadreAlCorte; conApertura: boolean }> {
  const estado = await cargarEstadoDeLaApertura(db, tenantId);
  const crm = await saldosCrmAlCorte(db, tenantId, estado.fecha);
  if (!estado.vigente) return { fecha: estado.fecha, cuadre: cuadreAlCorte([], crm), conApertura: false };
  const { data, error } = await db
    .from("apertura_partidas")
    .select("account_code, client_id, supplier_id, documento_externo, fecha_documento, debit, credit, " +
      "clients(client_number, name), suppliers(supplier_number, legal_name, trade_name)")
    .eq("tenant_id", tenantId)
    .eq("apertura_id", estado.vigente.id);
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  const apertura: SaldoDeDocumento[] = [];
  for (const p of (data ?? []) as unknown as {
    account_code: string; client_id: string | null; supplier_id: string | null; documento_externo: string | null; fecha_documento: string | null;
    debit: number | string; credit: number | string; clients: { client_number: string | null; name: string } | null;
    suppliers: { supplier_number: string | null; legal_name: string; trade_name: string | null } | null;
  }[]) {
    if (p.account_code === "100004" && p.client_id) {
      apertura.push({ lado: "cliente", terceroId: p.client_id, terceroCodigo: p.clients?.client_number ?? null, terceroNombre: p.clients?.name ?? "",
        documento: p.documento_externo, fecha: p.fecha_documento, saldo: r2(Number(p.debit) - Number(p.credit)) });
    } else if (p.account_code === "200001" && p.supplier_id) {
      apertura.push({ lado: "proveedor", terceroId: p.supplier_id, terceroCodigo: p.suppliers?.supplier_number ?? null,
        terceroNombre: p.suppliers ? p.suppliers.trade_name?.trim() || p.suppliers.legal_name : "",
        documento: p.documento_externo, fecha: p.fecha_documento, saldo: r2(Number(p.credit) - Number(p.debit)) });
    }
  }
  return { fecha: estado.fecha, cuadre: cuadreAlCorte(apertura, crm), conApertura: true };
}

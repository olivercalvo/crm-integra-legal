/**
 * POSTEO DE DOCUMENTOS EXISTENTES, POR MES (runbook §4 punto 9, migración `097`).
 *
 * Los documentos reales desde el inicio contable (01/07/2026) hasta el deploy
 * del Bloque 1 no tienen asiento: el libro de producción estaba vacío y el
 * posteo automático arranca con el deploy. NO se postean en la ventana: se
 * postean después, UN MES POR VEZ, cuando Josuarth revisa ese mes con el Excel
 * «en seco».
 *
 * 🔴 Cada asiento sale del MISMO constructor que usa la app al emitir, cobrar o
 *    registrar (factura y ND, NC, cobro, compra, gasto de trámite, pago a
 *    proveedor), con los mismos cargadores. Un asiento retroactivo es idéntico
 *    al que habría salido en su momento.
 * 🔴 Cada documento con SU fecha de registro, en orden cronológico; nunca nada
 *    anterior al inicio contable (y la base lo rechaza igual, 096).
 * 🔴 Todo o nada: el mes se postea en UNA transacción (`post_documentos_existentes`).
 * 🔴 Un mes se carga por un solo método: si ya tiene asientos IMPORTADOS, el
 *    modo real se niega (aquí y en la base). Los manuales de ajuste no
 *    bloquean: se listan para revisar (Oliver, 07/10/2026).
 *
 * No se postean: documentos de prueba (094), las facturas emitidas que nunca
 * llegaron a la DGI (`FACTURAS_SIN_DGI_EXCLUIDAS`) y lo que cuelga de ellas,
 * las NC de una anulación (su efecto es la reversión de la factura) y los
 * cobros del caso de Legal (`client_payments`, nunca postean).
 *
 * Una factura ANULADA sin asiento: se postea la factura con su fecha y, en el
 * mes de la anulación, su reversión (la misma que habría hecho `cancelInvoice`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import type { AsientoInput } from "@/lib/finanzas/contabilidad/posting";
import { cargarInicioContable, fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { construirAsientoDeFactura } from "@/lib/finanzas/contabilidad/asiento-factura";
import { construirAsientoDeNotaDeCredito } from "@/lib/finanzas/contabilidad/asiento-nota-credito";
import { construirAsientoDeCobro, construirAsientoDePagoProveedor } from "@/lib/finanzas/contabilidad/asiento-tesoreria";
import { construirAsientoDeCompra } from "@/lib/finanzas/contabilidad/asiento-compra";
import { construirAsientoDeGastoTramite } from "@/lib/finanzas/contabilidad/asiento-gasto-tramite";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { cargarFacturaParaAsiento } from "@/lib/finanzas/queries/factura-para-asiento";
import { cargarNotaDeCreditoParaAsiento } from "@/lib/finanzas/queries/nota-credito-para-asiento";
import { cargarCobroParaAsiento, cargarPagoProveedorParaAsiento } from "@/lib/finanzas/queries/tesoreria-para-asiento";
import { cargarCompraParaAsiento } from "@/lib/finanzas/queries/compra-para-asiento";
import { getLineasDeGastoTramite } from "@/lib/finanzas/queries/expense-tramite";
import { SELECT_GASTO_PARA_ASIENTO, datosDeGastoParaAsiento } from "@/lib/finanzas/api/expense-tramite";
import { allocatePurchaseNumber } from "@/lib/finanzas/numbering/purchase-numbering";
import { cargarAsientosPorOrigen } from "@/lib/finanzas/queries/payments";

type DB = SupabaseClient;

/**
 * Facturas EMITIDAS que nunca llegaron a la DGI (sin CUFE ni autorización): no
 * se postean y se listan aparte (Oliver, 06/10/2026). Las duplicadas
 * FAC-HON-000489 y FAC-HON-000503, también sin CUFE, SÍ se postean. Lo que cuelga
 * de una excluida (sus NC, los cobros aplicados a ella) tampoco se postea.
 */
export const FACTURAS_SIN_DGI_EXCLUIDAS = ["FAC-HON-000496", "FAC-HON-000508"];

export type TipoDocumento =
  | "factura"
  | "nota_debito"
  | "nota_credito"
  | "cobro"
  | "compra"
  | "gasto_tramite"
  | "pago_proveedor"
  | "reversion";

/** El orden dentro de un mismo día (pedido de Oliver). */
export const ORDEN_DE_TIPOS: TipoDocumento[] = [
  "factura",
  "nota_debito",
  "nota_credito",
  "reversion",
  "cobro",
  "compra",
  "gasto_tramite",
  "pago_proveedor",
];

export const ETIQUETA_DE_TIPO: Record<TipoDocumento, string> = {
  factura: "Factura",
  nota_debito: "Nota de débito",
  nota_credito: "Nota de crédito",
  reversion: "Anulación de factura",
  cobro: "Cobro",
  compra: "Compra",
  gasto_tramite: "Gasto de trámite",
  pago_proveedor: "Pago a proveedor",
};

/** Un asiento del plan, con lo que hace falta para el Excel. */
export interface ItemPlan {
  tipo: TipoDocumento;
  documentoId: string;
  numero: string;
  /** Fecha de REGISTRO: la del asiento, la que define el mes. */
  fecha: string;
  /** Fecha del documento (la que se compara con el inicio). */
  fechaDocumento: string;
  asiento: AsientoInput;
  /** Sólo en una reversión: el documento cuyo asiento revierte. */
  revierte?: { source_type: string; source_id: string };
  /** Gasto de trámite sin número FAC-CO-: se asigna al contabilizar. */
  numeroPendiente?: boolean;
}

export interface Fuera {
  tipo: TipoDocumento;
  numero: string;
  fecha: string;
  motivo: string;
  /** Dónde se corrige (las asignaciones en lote, o el documento). */
  enlace?: string;
}

/** Un asiento manual del mes: NO bloquea (Oliver, 07/10), se lista para revisar. */
export interface AsientoManualDelMes {
  numero: string;
  fecha: string;
  descripcion: string;
  monto: number;
}

/** El aviso de la hoja «Asientos manuales del mes» (pantalla y Excel). */
export const AVISO_ASIENTOS_MANUALES =
  "Revisa que ninguno registre un documento que también está en la hoja Asientos.";

/** Pantallas de asignación en lote (admin y contador). */
export const RUTA_ASIGNAR_GASTOS = "/finanzas/asientos/documentos-existentes/gastos";
export const RUTA_ASIGNAR_BANCOS = "/finanzas/asientos/documentos-existentes/bancos";

export interface Plan {
  tenantId: string;
  desde: string;
  hasta: string;
  inicio: string;
  items: ItemPlan[];
  /** No se postean, a propósito. */
  excluidos: Fuera[];
  /** No se pueden postear: hay que corregir el documento primero. */
  problemas: Fuera[];
  /** Impiden el modo real (meses anteriores pendientes, asientos IMPORTADOS, período cerrado…). */
  bloqueos: string[];
  /** Asientos manuales (no importados) del período: no bloquean, se revisan. */
  manuales: AsientoManualDelMes[];
  /** Avisos para el contador; no impiden nada. */
  avisos: string[];
  /** Nombres para el Excel. */
  cuentas: Record<string, string>;
  terceros: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Puros
// ---------------------------------------------------------------------------

/** «2026-07» → { desde: 2026-07-01, hasta: 2026-07-31 }. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(mes.trim());
  if (!m) throw new Error(`Mes inválido: «${mes}». Formato AAAA-MM.`);
  const anio = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) throw new Error(`Mes inválido: «${mes}».`);
  const ultimo = new Date(Date.UTC(anio, mm, 0)).getUTCDate();
  return { desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, "0")}` };
}

/** Orden cronológico; el mismo día, por tipo (ORDEN_DE_TIPOS) y número. */
export function ordenarItems(items: ItemPlan[]): ItemPlan[] {
  const peso = (t: TipoDocumento) => ORDEN_DE_TIPOS.indexOf(t);
  return [...items].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || peso(a.tipo) - peso(b.tipo) || a.numero.localeCompare(b.numero)
  );
}

export interface TotalCuenta {
  cuenta: string;
  debito: number;
  credito: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Débito y crédito por cuenta, ordenado por código. Sale cuadrado si cada asiento cuadra. */
export function totalesPorCuenta(items: ItemPlan[]): TotalCuenta[] {
  const m = new Map<string, TotalCuenta>();
  for (const it of items) {
    for (const l of it.asiento.lines) {
      const t = m.get(l.account_code) ?? { cuenta: l.account_code, debito: 0, credito: 0 };
      t.debito = r2(t.debito + Number(l.debit));
      t.credito = r2(t.credito + Number(l.credit));
      m.set(l.account_code, t);
    }
  }
  return Array.from(m.values()).sort((a, b) => a.cuenta.localeCompare(b.cuenta));
}

/** El tercero de un asiento: el de su primera línea que lo tenga. */
export function terceroDelAsiento(a: AsientoInput): { client_id?: string | null; supplier_id?: string | null } {
  const l = a.lines.find((x) => x.client_id || x.supplier_id);
  return { client_id: l?.client_id ?? null, supplier_id: l?.supplier_id ?? null };
}

// ---------------------------------------------------------------------------
// El plan del período
// ---------------------------------------------------------------------------

/** PostgREST corta cada lectura en 1000 filas: las listas del plan se leen por
 *  páginas. Sin esto, con más de 1000 asientos en el libro el plan creería que
 *  un documento no tiene asiento e intentaría postearlo otra vez. */
const PAGINA = 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pagina = PromiseLike<{ data: any[] | null; error: any }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginado(armar: (desde: number, hasta: number) => Pagina): Promise<{ data: any[] | null; error: any }> {
  const filas: unknown[] = [];
  for (let a = 0; ; a += PAGINA) {
    const { data, error } = await armar(a, a + PAGINA - 1);
    if (error) return { data: null, error };
    filas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return { data: filas, error: null };
  }
}

const ESTADOS_FACTURA = ["emitida", "parcialmente_pagada", "pagada", "anulada"];

function enRango(f: string, desde: string, hasta: string) {
  return f >= desde && f <= hasta;
}

/**
 * Arma el plan de [desde, hasta]. No escribe nada. Recorre desde el inicio
 * contable para saber si hay meses ANTERIORES pendientes (bloquean el modo real:
 * los meses se cargan en orden).
 */
export async function planearPosteo(db: DB, tenantId: string, desdePedido: string, hastaPedido: string): Promise<Plan> {
  const inicio = await cargarInicioContable(db, tenantId);
  const desde = desdePedido < inicio ? inicio : desdePedido;
  const hasta = hastaPedido;
  const plan: Plan = {
    tenantId, desde, hasta, inicio, items: [], excluidos: [], problemas: [], bloqueos: [], avisos: [], manuales: [],
    cuentas: {}, terceros: {},
  };
  if (desdePedido < inicio) {
    plan.avisos.push(
      `Lo anterior al inicio contable (${fechaCorta(inicio)}) está contabilizado fuera: el período empieza el ${fechaCorta(inicio)}.`
    );
  }
  if (hasta < inicio) {
    plan.bloqueos.push(`El período termina antes del inicio contable (${fechaCorta(inicio)}): no hay nada que contabilizar.`);
    return plan;
  }

  // Lo que ya está en el libro.
  const conAsiento = new Set<string>();
  const reversionesDeFactura = new Set<string>();
  {
    const { data, error } = await paginado((a, b) =>
      db.from("journal_entries").select("source_type, source_id").eq("tenant_id", tenantId).order("id").range(a, b)
    );
    if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
    for (const j of (data ?? []) as { source_type: string; source_id: string | null }[]) {
      if (!j.source_id) continue;
      conAsiento.add(`${j.source_type}:${j.source_id}`);
      if (j.source_type === "reversion") reversionesDeFactura.add(j.source_id);
    }
  }
  const tiene = (st: string, id: string) => conAsiento.has(`${st}:${id}`);

  const todos: ItemPlan[] = [];
  const problemasTodos: (Fuera & { fecha: string })[] = [];
  const agregar = (it: ItemPlan) => todos.push(it);
  const problema = (f: Fuera) => problemasTodos.push(f);
  const excluir = (f: Fuera) => {
    if (enRango(f.fecha, desde, hasta)) plan.excluidos.push(f);
  };

  // ── Facturas y ND ────────────────────────────────────────────────────────
  const { data: facturas, error: errF } = await paginado((a, b) =>
    db
    .from("invoices")
    .select("id, invoice_number, invoice_kind, status, issue_date, accounting_date, dgi_cufe, fe_estado, de_prueba, cancellation_reason, cancelled_at")
    .eq("tenant_id", tenantId)
    .in("status", ESTADOS_FACTURA)
    .gte("issue_date", inicio)
    .lte("accounting_date", hasta)
    .order("id")
    .range(a, b)
  );
  if (errF) throw new MutationError(pgErrorToMessage(errF), 500, errF);
  type Fac = {
    id: string; invoice_number: string; invoice_kind: string; status: string; issue_date: string;
    accounting_date: string | null; dgi_cufe: string | null; fe_estado: string | null; de_prueba: boolean;
    cancellation_reason: string | null; cancelled_at: string | null;
  };
  const excluidas = new Set<string>();
  const facturasAnuladas: Fac[] = [];
  for (const f of (facturas ?? []) as Fac[]) {
    const tipo: TipoDocumento = f.invoice_kind === "NOTA_DEBITO" ? "nota_debito" : "factura";
    const fecha = String(f.accounting_date ?? f.issue_date).slice(0, 10);
    if (f.de_prueba) {
      excluir({ tipo, numero: f.invoice_number, fecha, motivo: "Documento de prueba: no entra al libro." });
      continue;
    }
    if (FACTURAS_SIN_DGI_EXCLUIDAS.includes(f.invoice_number)) {
      excluidas.add(f.id);
      excluir({ tipo, numero: f.invoice_number, fecha, motivo: "Emitida sin CUFE ni autorización de la DGI: no se contabiliza hasta que se resuelva." });
      continue;
    }
    if (f.status === "anulada") facturasAnuladas.push(f);
    if (tiene("factura", f.id)) continue;
    if (!f.dgi_cufe && f.fe_estado !== "interna" && enRango(fecha, desde, hasta)) {
      plan.avisos.push(`${f.invoice_number} (${fechaCorta(fecha)}) no tiene CUFE en el CRM y SÍ se contabiliza.`);
    }
    const datos = await cargarFacturaParaAsiento(db, tenantId, f.id, f.invoice_number);
    const armado = datos ? construirAsientoDeFactura(datos) : { ok: false as const, mensaje: "No se pudo leer la factura." };
    if (!armado.ok) {
      problema({ tipo, numero: f.invoice_number, fecha, motivo: armado.mensaje });
      continue;
    }
    agregar({ tipo, documentoId: f.id, numero: f.invoice_number, fecha, fechaDocumento: String(f.issue_date).slice(0, 10), asiento: armado.asiento });
  }

  // ── Reversiones de facturas anuladas sin reversión ───────────────────────
  for (const f of facturasAnuladas) {
    if (reversionesDeFactura.has(f.id)) continue;
    const { data: nc } = await db
      .from("credit_notes")
      .select("accounting_date, issue_date")
      .eq("tenant_id", tenantId)
      .eq("invoice_id", f.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ncFecha = (nc as { accounting_date?: string | null; issue_date?: string | null } | null);
    const fecha = String(ncFecha?.accounting_date ?? ncFecha?.issue_date ?? f.cancelled_at ?? f.accounting_date ?? f.issue_date).slice(0, 10);
    if (fecha > hasta) continue;
    // El original: el que se va a postear en este plan, o el que ya está en el
    // libro, leído con el MISMO cargador que usa cancelInvoice.
    const enPlan = todos.find((t) => t.documentoId === f.id && t.tipo !== "reversion");
    const original = enPlan
      ? {
          id: "pendiente", entry_number: 0, transaction_date: enPlan.fecha, description: enPlan.asiento.description,
          reference: f.invoice_number,
          lines: enPlan.asiento.lines.map((l) => ({ ...l, description: l.description ?? null })),
        }
      : (await cargarAsientosPorOrigen(db, tenantId, "factura", [f.id])).get(f.id);
    if (!original) {
      // El libro dice que la factura tiene asiento y no se pudo leer: nunca en silencio.
      if (tiene("factura", f.id)) {
        problema({ tipo: "reversion", numero: f.invoice_number, fecha, motivo: "No se pudo leer el asiento de la factura para armar su anulación." });
      }
      continue; // sin original: su factura todavía no se postea (otro mes, o tiene un problema)
    }
    const armado = construirAsientoDeReversion(original as Parameters<typeof construirAsientoDeReversion>[0], {
      fecha, motivo: f.cancellation_reason?.trim() || `Anulación de la factura ${f.invoice_number}`, source_id: f.id,
    });
    if (!armado.ok) {
      problema({ tipo: "reversion", numero: f.invoice_number, fecha, motivo: armado.mensaje });
      continue;
    }
    const asiento: AsientoInput = {
      ...armado.asiento,
      description: `Anulación de la factura ${f.invoice_number}`,
      reverses_entry_id: null,
    };
    agregar({
      tipo: "reversion", documentoId: f.id, numero: f.invoice_number, fecha, fechaDocumento: String(f.issue_date).slice(0, 10),
      asiento, revierte: { source_type: "factura", source_id: f.id },
    });
  }

  // ── NC de venta ─────────────────────────────────────────────────────────
  const { data: ncs, error: errN } = await paginado((a, b) =>
    db
    .from("credit_notes")
    .select("id, credit_note_number, status, issue_date, accounting_date, invoice_id, de_prueba, invoices(status)")
    .eq("tenant_id", tenantId)
    .gte("issue_date", inicio)
    .lte("accounting_date", hasta)
    .order("id")
    .range(a, b)
  );
  if (errN) throw new MutationError(pgErrorToMessage(errN), 500, errN);
  for (const n of (ncs ?? []) as unknown as {
    id: string; credit_note_number: string; status: string; issue_date: string; accounting_date: string | null;
    invoice_id: string | null; de_prueba: boolean; invoices: { status: string } | null;
  }[]) {
    const fecha = String(n.accounting_date ?? n.issue_date).slice(0, 10);
    const base = { tipo: "nota_credito" as TipoDocumento, numero: n.credit_note_number, fecha };
    if (tiene("nota_credito", n.id)) continue;
    if (n.de_prueba) { excluir({ ...base, motivo: "Documento de prueba: no entra al libro." }); continue; }
    if (n.invoice_id && excluidas.has(n.invoice_id)) { excluir({ ...base, motivo: "Es de una factura que no se contabiliza (sin DGI)." }); continue; }
    if (n.invoices?.status === "anulada") {
      excluir({ ...base, motivo: "Es la nota de crédito de una anulación: no tiene asiento propio; su efecto es la anulación de la factura (el asiento que revierte la factura)." });
      continue;
    }
    if (n.status !== "emitida") { problema({ ...base, motivo: `Nota de crédito en estado «${n.status}» sin asiento: revisar.` }); continue; }
    const datos = await cargarNotaDeCreditoParaAsiento(db, tenantId, n.id);
    const armado = datos ? construirAsientoDeNotaDeCredito(datos) : { ok: false as const, mensaje: "No se pudo leer la nota de crédito." };
    if (!armado.ok) { problema({ ...base, motivo: armado.mensaje }); continue; }
    agregar({ ...base, documentoId: n.id, fechaDocumento: String(n.issue_date).slice(0, 10), asiento: armado.asiento });
  }

  // ── Cobros ──────────────────────────────────────────────────────────────
  const { data: cobros, error: errC } = await paginado((a, b) =>
    db
    .from("payments")
    .select("id, payment_number, reference, status, payment_date, de_prueba, payment_applications(invoice_id)")
    .eq("tenant_id", tenantId)
    .gte("payment_date", inicio)
    .lte("payment_date", hasta)
    .order("id")
    .range(a, b)
  );
  if (errC) throw new MutationError(pgErrorToMessage(errC), 500, errC);
  for (const c of (cobros ?? []) as unknown as {
    id: string; payment_number: string | null; reference: string | null; status: string; payment_date: string;
    de_prueba: boolean; payment_applications: { invoice_id: string }[];
  }[]) {
    const fecha = String(c.payment_date).slice(0, 10);
    const base = { tipo: "cobro" as TipoDocumento, numero: c.payment_number ?? c.reference ?? c.id.slice(0, 8), fecha };
    if (tiene("pago", c.id)) continue;
    if (c.de_prueba) { excluir({ ...base, motivo: "Documento de prueba: no entra al libro." }); continue; }
    if (c.status !== "registrado") { excluir({ ...base, motivo: `Cobro en estado «${c.status}»: no se contabiliza.` }); continue; }
    if (c.payment_applications.some((a) => excluidas.has(a.invoice_id))) {
      excluir({ ...base, motivo: "Se aplicó a una factura que no se contabiliza (sin DGI)." });
      continue;
    }
    const datos = await cargarCobroParaAsiento(db, tenantId, c.id);
    const armado = datos ? construirAsientoDeCobro(datos) : { ok: false as const, mensaje: "No se pudo leer el cobro." };
    if (!armado.ok) {
      const sinBanco = "motivo" in armado && (armado.motivo === "sin_banco" || armado.motivo === "banco_invalido");
      problema({ ...base, motivo: armado.mensaje,
        enlace: sinBanco ? `${RUTA_ASIGNAR_BANCOS}?mes=${fecha.slice(0, 7)}&sel=${c.id}` : `/finanzas/cobros` });
      continue;
    }
    agregar({ ...base, documentoId: c.id, fechaDocumento: fecha, asiento: armado.asiento });
  }

  // ── Compras ─────────────────────────────────────────────────────────────
  const { data: compras, error: errB } = await paginado((a, b) =>
    db
    .from("business_expenses")
    .select("id, purchase_number, description, expense_date, accounting_date")
    .eq("tenant_id", tenantId)
    .gte("expense_date", inicio)
    .lte("accounting_date", hasta)
    .order("id")
    .range(a, b)
  );
  if (errB) throw new MutationError(pgErrorToMessage(errB), 500, errB);
  for (const b of (compras ?? []) as { id: string; purchase_number: string | null; description: string | null; expense_date: string; accounting_date: string | null }[]) {
    const fecha = String(b.accounting_date ?? b.expense_date).slice(0, 10);
    const base = { tipo: "compra" as TipoDocumento, numero: b.purchase_number ?? b.description ?? b.id.slice(0, 8), fecha };
    if (tiene("gasto", b.id)) continue;
    const datos = await cargarCompraParaAsiento(db, tenantId, b.id);
    const armado = datos ? construirAsientoDeCompra(datos) : { ok: false as const, mensaje: "No se pudo leer la compra." };
    if (!armado.ok) { problema({ ...base, motivo: armado.mensaje, enlace: `/finanzas/gastos-bufete/${b.id}/editar` }); continue; }
    agregar({ ...base, documentoId: b.id, fechaDocumento: String(b.expense_date).slice(0, 10), asiento: armado.asiento });
  }

  // ── Gastos de trámite ───────────────────────────────────────────────────
  const { data: gastos, error: errG } = await paginado((a, b) =>
    db
    .from("expenses")
    .select(SELECT_GASTO_PARA_ASIENTO)
    .eq("tenant_id", tenantId)
    .gte("date", inicio)
    .lte("accounting_date", hasta)
    .order("id")
    .range(a, b)
  );
  if (errG) throw new MutationError(pgErrorToMessage(errG), 500, errG);
  for (const g of (gastos ?? []) as unknown as Record<string, unknown>[]) {
    const id = String(g.id);
    const fecha = String(g.accounting_date ?? g.date).slice(0, 10);
    const base = { tipo: "gasto_tramite" as TipoDocumento, numero: String(g.purchase_number ?? g.concept ?? id.slice(0, 8)), fecha };
    if (g.posted_entry_id || tiene("gasto_tramite", id)) continue;
    if (g.de_prueba) { excluir({ ...base, motivo: "Documento de prueba: no entra al libro." }); continue; }
    if (g.status === "anulado") { excluir({ ...base, motivo: "Gasto anulado: no se contabiliza." }); continue; }
    const lineas = await getLineasDeGastoTramite(db, tenantId, id);
    const armado = construirAsientoDeGastoTramite(datosDeGastoParaAsiento(g), lineas);
    if (!armado.ok) { problema({ ...base, motivo: armado.mensaje, enlace: `${RUTA_ASIGNAR_GASTOS}?mes=${fecha.slice(0, 7)}&sel=${id}` }); continue; }
    agregar({
      ...base, documentoId: id, fechaDocumento: String(g.date).slice(0, 10), asiento: armado.asiento,
      numeroPendiente: !g.purchase_number,
    });
  }

  // ── Pagos a proveedor ───────────────────────────────────────────────────
  const { data: pagos, error: errP } = await paginado((a, b) =>
    db
    .from("supplier_payments")
    .select("id, payment_number, status, kind, payment_date")
    .eq("tenant_id", tenantId)
    .eq("kind", "payment")
    .gte("payment_date", inicio)
    .lte("payment_date", hasta)
    .order("id")
    .range(a, b)
  );
  if (errP) throw new MutationError(pgErrorToMessage(errP), 500, errP);
  for (const p of (pagos ?? []) as { id: string; payment_number: string | null; status: string; payment_date: string }[]) {
    const fecha = String(p.payment_date).slice(0, 10);
    const base = { tipo: "pago_proveedor" as TipoDocumento, numero: p.payment_number ?? p.id.slice(0, 8), fecha };
    if (tiene("pago_proveedor", p.id)) continue;
    if (p.status !== "registrado") { excluir({ ...base, motivo: `Pago en estado «${p.status}»: no se contabiliza.` }); continue; }
    const datos = await cargarPagoProveedorParaAsiento(db, tenantId, p.id);
    const armado = datos ? construirAsientoDePagoProveedor(datos) : { ok: false as const, mensaje: "No se pudo leer el pago." };
    if (!armado.ok) { problema({ ...base, motivo: armado.mensaje }); continue; }
    agregar({ ...base, documentoId: p.id, fechaDocumento: fecha, asiento: armado.asiento });
  }

  // ── NC de compra sin asiento: no debería existir (se crean con su asiento) ─
  const { data: ncc } = await paginado((a, b) =>
    db
    .from("supplier_credit_notes")
    .select("id, credit_note_number, status, issue_date")
    .eq("tenant_id", tenantId)
    .eq("status", "emitida")
    .gte("issue_date", inicio)
    .lte("issue_date", hasta)
    .order("id")
    .range(a, b)
  );
  for (const n of (ncc ?? []) as { id: string; credit_note_number: string; issue_date: string }[]) {
    if (tiene("nota_credito_proveedor", n.id)) continue;
    problema({
      tipo: "compra", numero: n.credit_note_number, fecha: String(n.issue_date).slice(0, 10),
      motivo: "Nota de crédito de compra sin asiento: no debería existir (se registran con su asiento). Revisar.",
    });
  }

  // ── Partir: el período pedido y lo pendiente de antes ───────────────────
  const anteriores = todos.filter((t) => t.fecha < desde);
  plan.items = ordenarItems(todos.filter((t) => enRango(t.fecha, desde, hasta)));
  plan.problemas = problemasTodos.filter((p) => enRango(p.fecha, desde, hasta));
  const problemasAnteriores = problemasTodos.filter((p) => p.fecha < desde);
  if (anteriores.length + problemasAnteriores.length > 0) {
    const meses = Array.from(new Set([...anteriores, ...problemasAnteriores].map((x) => x.fecha.slice(0, 7)))).sort();
    plan.bloqueos.push(
      `Hay ${anteriores.length + problemasAnteriores.length} documento(s) sin asiento en meses anteriores ` +
        `(${meses.join(", ")}). Los meses se contabilizan en orden: primero ${meses[0]}.`
    );
  }

  // ── Un mes, un solo método (Oliver, 07/10/2026) ─────────────────────────
  // Bloquean sólo los asientos IMPORTADOS vigentes (journal_import_entries).
  // Los manuales de ajuste no bloquean: se listan en «Asientos manuales del mes».
  const { data: manuales } = await paginado((a, b) =>
    db
    .from("journal_entries")
    .select("id, entry_number, reference, transaction_date, description, source_type, journal_entry_lines(debit)")
    .eq("tenant_id", tenantId)
    .in("source_type", ["manual", "apertura"])
    .gte("transaction_date", desde)
    .lte("transaction_date", hasta)
    .order("id")
    .range(a, b)
  );
  const { data: reversiones } = await paginado((a, b) =>
    db
    .from("journal_entries")
    .select("reverses_entry_id")
    .eq("tenant_id", tenantId)
    .not("reverses_entry_id", "is", null)
    .order("id")
    .range(a, b)
  );
  const reversados = new Set(((reversiones ?? []) as { reverses_entry_id: string }[]).map((r) => r.reverses_entry_id));
  type Manual = { id: string; entry_number: number; reference: string | null; transaction_date: string; description: string; journal_entry_lines: { debit: number }[] };
  const vigentes = ((manuales ?? []) as Manual[]).filter((m) => !reversados.has(m.id));
  const importados = new Set<string>();
  if (vigentes.length > 0) {
    const { data: imp, error: errI } = await db
      .from("journal_import_entries")
      .select("entry_id")
      .eq("tenant_id", tenantId)
      .in("entry_id", vigentes.map((m) => m.id));
    if (errI) throw new MutationError(pgErrorToMessage(errI), 500, errI);
    for (const x of (imp ?? []) as { entry_id: string }[]) importados.add(x.entry_id);
  }
  const nombre = (m: Manual) => m.reference ?? `asiento ${m.entry_number}`;
  const deImportacion = vigentes.filter((m) => importados.has(m.id));
  if (deImportacion.length > 0) {
    plan.bloqueos.push(
      `El período ya tiene ${deImportacion.length} asiento(s) importados: ` +
        deImportacion.map((m) => `${nombre(m)} (${fechaCorta(m.transaction_date)}, ${m.description})`).join("; ") +
        ". Un mes se carga por un solo método: no se contabilizan los documentos."
    );
  }
  plan.manuales = vigentes
    .filter((m) => !importados.has(m.id))
    .sort((x, y) => x.entry_number - y.entry_number)
    .map((m) => ({
      numero: nombre(m),
      fecha: String(m.transaction_date).slice(0, 10),
      descripcion: m.description,
      monto: Math.round(m.journal_entry_lines.reduce((t, l) => t + Number(l.debit), 0) * 100) / 100,
    }));

  // ── Períodos cerrados ───────────────────────────────────────────────────
  const meses = Array.from(new Set(plan.items.map((i) => i.fecha.slice(0, 7))));
  if (meses.length > 0) {
    const { data: periodos } = await db.from("accounting_periods").select("year, month, status").eq("tenant_id", tenantId);
    for (const ym of meses) {
      const [y, m] = ym.split("-").map(Number);
      const p = ((periodos ?? []) as { year: number; month: number; status: string }[]).find((x) => x.year === y && x.month === m);
      if (p?.status === "cerrado") plan.bloqueos.push(`El período ${ym} está cerrado: hay que reabrirlo para contabilizar.`);
    }
  }

  if (plan.problemas.length > 0) {
    plan.bloqueos.push(`${plan.problemas.length} documento(s) con problemas (hoja «Con problemas»): corregirlos antes de contabilizar.`);
  }

  // ── Nombres, para el Excel ──────────────────────────────────────────────
  const codigos = new Set(plan.items.flatMap((i) => i.asiento.lines.map((l) => l.account_code)));
  if (codigos.size > 0) {
    const { data: ctas } = await db.from("chart_of_accounts").select("code, name").eq("tenant_id", tenantId).in("code", Array.from(codigos));
    for (const c of (ctas ?? []) as { code: string; name: string }[]) plan.cuentas[c.code] = c.name;
  }
  const clientes = new Set<string>();
  const proveedores = new Set<string>();
  for (const i of plan.items) for (const l of i.asiento.lines) {
    if (l.client_id) clientes.add(l.client_id);
    if (l.supplier_id) proveedores.add(l.supplier_id);
  }
  if (clientes.size > 0) {
    const { data } = await db.from("clients").select("id, name, client_number").in("id", Array.from(clientes));
    for (const c of (data ?? []) as { id: string; name: string; client_number: string | null }[]) {
      plan.terceros[c.id] = c.client_number ? `${c.name} (${c.client_number})` : c.name;
    }
  }
  if (proveedores.size > 0) {
    const { data } = await db.from("suppliers").select("id, legal_name, supplier_number").in("id", Array.from(proveedores));
    for (const p of (data ?? []) as { id: string; legal_name: string; supplier_number: string | null }[]) {
      plan.terceros[p.id] = p.supplier_number ? `${p.legal_name} (${p.supplier_number})` : p.legal_name;
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// El modo real
// ---------------------------------------------------------------------------

export interface ResultadoPosteo {
  posteoId: string;
  asientos: { orden: number; entry_number: number; reference: string | null }[];
  totalDebitos: number;
}

/**
 * Contabiliza el plan: TODO en una transacción (`post_documentos_existentes`,
 * 097). Se niega si el plan tiene bloqueos. `ledgerDb` es el cliente de
 * SERVICIO (SOP-014); el tenant viene del perfil.
 *
 * Los gastos de trámite sin número FAC-CO- lo reciben ANTES del lote (como en
 * `postearGastoTramite`): si el lote falla, el número queda en el gasto y el
 * próximo intento lo reusa. No quema números.
 */
export async function contabilizarPlan(db: DB, ledgerDb: DB, plan: Plan, userId: string | null): Promise<ResultadoPosteo> {
  if (plan.bloqueos.length > 0) {
    throw new MutationError(`No se contabiliza: ${plan.bloqueos.join(" ")}`, 409);
  }
  if (plan.items.length === 0) {
    throw new MutationError("No hay documentos sin asiento en ese período: no hay nada que contabilizar.", 409);
  }

  for (const it of plan.items) {
    if (it.tipo !== "gasto_tramite" || !it.numeroPendiente) continue;
    const numero = await allocatePurchaseNumber(db, plan.tenantId);
    const { error } = await db
      .from("expenses")
      .update({ purchase_number: numero })
      .eq("tenant_id", plan.tenantId)
      .eq("id", it.documentoId)
      .is("purchase_number", null);
    if (error) throw new MutationError(`No se pudo numerar el gasto ${it.numero}: ${pgErrorToMessage(error)}`, 500, error);
    // El número que QUEDÓ en el gasto: si otra corrida lo numeró antes, el
    // UPDATE de arriba no tocó nada y el nuestro es un hueco (SOP-031). La base
    // lo vuelve a verificar (098).
    const { data: guardado, error: errLeer } = await db
      .from("expenses")
      .select("purchase_number")
      .eq("tenant_id", plan.tenantId)
      .eq("id", it.documentoId)
      .single();
    if (errLeer) throw new MutationError(`No se pudo leer el número del gasto: ${pgErrorToMessage(errLeer)}`, 500, errLeer);
    const final = String((guardado as { purchase_number: string | null }).purchase_number ?? numero);
    it.asiento = { ...it.asiento, reference: final };
    it.numero = final;
    it.numeroPendiente = false;
  }

  const items = plan.items.map((it) => ({
    transaction_date: it.fecha,
    description: it.asiento.description,
    source_type: it.asiento.source_type,
    source_id: it.asiento.source_id ?? null,
    source_cufe: it.asiento.source_cufe ?? null,
    reversal_reason: it.asiento.reversal_reason ?? null,
    reference: it.asiento.reference ?? null,
    referencia_externa: it.asiento.referencia_externa ?? null,
    idempotency_key: it.asiento.idempotency_key ?? null,
    lines: it.asiento.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
      client_id: l.client_id ?? null,
      supplier_id: l.supplier_id ?? null,
    })),
    ...(it.revierte ? { revierte_source_type: it.revierte.source_type, revierte_source_id: it.revierte.source_id } : {}),
  }));

  const { data, error } = await ledgerDb.rpc("post_documentos_existentes", {
    p_tenant_id: plan.tenantId,
    p_desde: plan.desde,
    p_hasta: plan.hasta,
    p_items: items,
    p_created_by: userId,
  });
  if (error) {
    throw new MutationError(
      `No se contabilizó nada (el período queda como estaba): ${error.message}`,
      error.code === "23514" ? 409 : 422,
      error
    );
  }
  const r = data as { posteo_id: string; asientos: ResultadoPosteo["asientos"]; total_debitos: number };
  return { posteoId: r.posteo_id, asientos: r.asientos, totalDebitos: Number(r.total_debitos) };
}

/**
 * FUENTE DE DATOS de la antigüedad de saldos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS COSAS QUE HAY QUE SABER ANTES DE LEER ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **EL PROVEEDOR YA ES UNA ENTIDAD** (migración 033, 02/09/2026). Se agrupa
 *    por `supplier_id`, no por el texto de `supplier_name`. Antes, dos gastos
 *    del mismo proveedor escritos con una coma de diferencia salían como dos
 *    proveedores distintos; eso se terminó.
 *
 *    `supplier_name` sigue existiendo como RESPALDO de la migración y como
 *    salida para un gasto suelto sin ficha. Un gasto sin `supplier_id` se
 *    agrupa por ese texto, igual que antes: no se pierde ni se esconde.
 *
 * 2. **LA ANTIGÜEDAD SE CUENTA DESDE `due_date`**, que también llegó con la 033.
 *    El vencimiento sale del plazo del proveedor (contado, 30, 60, 90) y es
 *    editable por gasto. Antes no existía el campo y se contaba desde la fecha
 *    del gasto, que daba una antigüedad más pesimista que la real. Era
 *    exactamente el motivo por el que Josuarth pidió los términos de pago.
 *
 *    Un gasto sin `due_date` cae de nuevo en `expense_date`, que es lo mismo que
 *    tratarlo como contado.
 */

import { cargarInicioContable, esContabilizadoFuera } from "@/lib/finanzas/contabilidad/inicio-contable";
import { aperturaRegistrada, saldoInicialEfectivo } from "@/lib/finanzas/reports/apertura-registrada";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";
import {
  diasAlCorte,
  fechaDeAplicacion,
  saldoAlCorte,
  vigenteAlCorte,
  type Baja,
} from "@/lib/finanzas/reports/antiguedad-al-corte";
import type {
  ControlMedido,
  DocumentoPendiente,
  SinAsiento,
} from "@/lib/finanzas/reports/antiguedad";
import {
  manualesSinTercero,
  partidasDeDiario,
  partidasDeApertura,
  type PartidaDeApertura,
  SOURCE_TYPES_DE_PARTIDA,
  type LineaDeControl,
} from "@/lib/finanzas/reports/partidas-de-diario";
import { DE_PRUEBA } from "@/lib/finanzas/documentos-de-prueba";

type DB = SupabaseClient;

/** Cuentas control de cada auxiliar, según el plan de Josuar. */
export const CUENTA_CONTROL = {
  cobrar: "100004",
  pagar: "200001",
} as const;

export type TipoAntiguedad = keyof typeof CUENTA_CONTROL;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Saldo de la cuenta control: apertura + movimientos del ledger.
 *
 * Se calcula igual que en `accounting-source.ts` a propósito — es el número que
 * muestra el Balance General, y compararse contra otra cosa no probaría nada.
 * Al corte: sólo los asientos con fecha de registro hasta ese día.
 */
async function saldoDeCuentaControl(
  db: DB,
  tenantId: string,
  code: string,
  corte: string
): Promise<Omit<ControlMedido, "sinAsiento">> {
  const { data: cuenta } = await db
    .from("chart_of_accounts")
    .select("id, code, name, saldo_inicial")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();

  if (!cuenta) {
    return {
      saldoCuentaControl: 0,
      saldoApertura: 0,
      cuentaCodigo: code,
      cuentaNombre: "(cuenta no encontrada)",
    };
  }

  const c = cuenta as { id: string; code: string; name: string; saldo_inicial: number | string };
  const { data: lineas } = await db
    .from("journal_entry_lines")
    .select("debit, credit, journal_entries!inner(transaction_date)")
    .eq("tenant_id", tenantId)
    .eq("account_id", c.id)
    .lte("journal_entries.transaction_date", corte);

  let neto = 0;
  for (const l of (lineas ?? []) as { debit: number | string; credit: number | string }[]) {
    neto += Number(l.debit) - Number(l.credit);
  }

  // 100: con apertura, el saldo inicial de la cuenta ya no cuenta (está en el libro).
  const apertura = saldoInicialEfectivo(c.saldo_inicial, await aperturaRegistrada(db, tenantId));
  return {
    saldoCuentaControl: round2(apertura + neto),
    saldoApertura: apertura,
    cuentaCodigo: c.code,
    cuentaNombre: c.name,
  };
}

/**
 * LÍNEAS DE ASIENTOS MANUALES Y DE APERTURA contra la cuenta control (E9).
 *
 * Una sola lectura para dos usos (`partidas-de-diario.ts`): las líneas CON el
 * tercero del auxiliar son partidas de la tabla; las que no lo tienen (lo
 * anterior a la 071) siguen en la explicación de la diferencia (D5). Una
 * `reversion` no se lee: se usa para descartar los asientos que ya se
 * reversaron, que con su espejo suman cero en el mayor. Vuelve la FECHA de cada
 * reversión: al corte anterior, el asiento todavía contaba.
 */
async function lineasDeDiarioContraControl(
  db: DB,
  tenantId: string,
  code: string
): Promise<{ lineas: LineaDeControl[]; reversiones: Map<string, string> }> {
  const vacio = { lineas: [] as LineaDeControl[], reversiones: new Map<string, string>() };
  const { data: cuenta } = await db
    .from("chart_of_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();
  if (!cuenta) return vacio;

  const { data, error } = await db
    .from("journal_entry_lines")
    .select(
      "entry_id, debit, credit, client_id, supplier_id, clients(name), suppliers(legal_name, trade_name), " +
        "journal_entries!inner(entry_number, source_type, transaction_date, reference, referencia_externa)"
    )
    .eq("tenant_id", tenantId)
    .eq("account_id", (cuenta as { id: string }).id)
    .in("journal_entries.source_type", [...SOURCE_TYPES_DE_PARTIDA]);

  if (error) {
    console.error("[finanzas/antiguedad] lineasDeDiarioContraControl failed", error);
    return vacio;
  }

  type Fila = {
    entry_id: string;
    debit: number | string;
    credit: number | string;
    client_id: string | null;
    supplier_id: string | null;
    clients: { name: string } | null;
    suppliers: { legal_name: string; trade_name: string | null } | null;
    journal_entries: {
      entry_number: number;
      source_type: string;
      transaction_date: string;
      reference: string | null;
      referencia_externa: string | null;
    };
  };
  const lineas: LineaDeControl[] = ((data ?? []) as unknown as Fila[]).map((f) => ({
    entryId: f.entry_id,
    entryNumber: Number(f.journal_entries.entry_number),
    sourceType: f.journal_entries.source_type,
    fecha: String(f.journal_entries.transaction_date).slice(0, 10),
    referencia: f.journal_entries.reference,
    debit: Number(f.debit ?? 0),
    credit: Number(f.credit ?? 0),
    clientId: f.client_id,
    supplierId: f.supplier_id,
    terceroNombre:
      f.clients?.name ?? (f.suppliers ? f.suppliers.trade_name?.trim() || f.suppliers.legal_name : null),
  }));
  if (lineas.length === 0) return vacio;

  const ids = Array.from(new Set(lineas.map((l) => l.entryId)));
  // 07/10/2026: de los asientos IMPORTADOS se muestra la referencia externa (el
  // número del documento en el archivo), además del AD-.
  const importados = new Set<string>();
  try {
    const { data: imp } = await db.from("journal_import_entries").select("entry_id").eq("tenant_id", tenantId).in("entry_id", ids);
    for (const r of (imp ?? []) as { entry_id: string }[]) importados.add(r.entry_id);
  } catch {
    // sin la 067 no hay importaciones
  }
  const externas = new Map(((data ?? []) as unknown as Fila[]).map((f) => [f.entry_id, f.journal_entries.referencia_externa]));
  for (const l of lineas) {
    if (importados.has(l.entryId)) l.referenciaExterna = externas.get(l.entryId) ?? null;
  }
  const { data: espejos } = await db
    .from("journal_entries")
    .select("reverses_entry_id, transaction_date")
    .eq("tenant_id", tenantId)
    .in("reverses_entry_id", ids);
  const reversiones = new Map<string, string>();
  for (const e of (espejos ?? []) as { reverses_entry_id: string | null; transaction_date: string }[]) {
    if (e.reverses_entry_id) reversiones.set(e.reverses_entry_id, String(e.transaction_date).slice(0, 10));
  }
  return { lineas, reversiones };
}

// ─────────────────────────────────────────────────────────────────────────────
// AL CORTE (requerimiento 41, 08/10/2026). Cada saldo se RECONSTRUYE a la
// fecha de corte con su historia (`antiguedad-al-corte.ts`): el documento desde
// su fecha de registro, cada cobro, pago, NC o aplicación desde la suya, y lo
// reversado o anulado hasta la fecha de registro de la reversión. Con el corte
// en hoy da lo mismo que `balance_due`.
// ─────────────────────────────────────────────────────────────────────────────

const d10 = (v: unknown) => String(v).slice(0, 10);
const diaEnPanama = (ts: string | null | undefined) => (ts ? hoyEnPanama(new Date(ts)) : null);
const mayor = (a: string, b: string | null) => (b && b > a ? b : a);

/** source_id → id de SU asiento, para un tipo de documento. */
async function asientosDe(db: DB, tenantId: string, sourceType: string): Promise<Map<string, string>> {
  const { data } = await db
    .from("journal_entries")
    .select("id, source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", sourceType);
  const m = new Map<string, string>();
  for (const e of (data ?? []) as { id: string; source_id: string | null }[]) if (e.source_id) m.set(e.source_id, e.id);
  return m;
}

/** Asiento reversado → fecha de registro de su reversión. */
async function fechasDeReversion(db: DB, tenantId: string): Promise<Map<string, string>> {
  const { data } = await db
    .from("journal_entries")
    .select("reverses_entry_id, transaction_date")
    .eq("tenant_id", tenantId)
    .not("reverses_entry_id", "is", null);
  const m = new Map<string, string>();
  for (const e of (data ?? []) as { reverses_entry_id: string | null; transaction_date: string }[]) {
    if (e.reverses_entry_id) m.set(e.reverses_entry_id, d10(e.transaction_date));
  }
  return m;
}

function nombreDeProveedor(p: { legal_name?: string; trade_name?: string | null } | null | undefined): string {
  return p ? p.trade_name?.trim() || p.legal_name || "" : "";
}

function uno<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

interface Auxiliar {
  documentos: DocumentoPendiente[];
  sinAsiento: SinAsiento;
}

/**
 * POR COBRAR: facturas (y ND) con su saldo al corte, los SALDOS A FAVOR de los
 * cobros (074) y de las NC sin factura (E8) en negativo, y lo que no llega al
 * mayor (causa 2 de la diferencia).
 *
 * ⚠️ Se leen también las facturas PAGADAS y ANULADAS: al corte pudieron estar
 * pendientes. El saldo sale de la historia, no del `status` de hoy. Una factura
 * acreditada al 100% por NC (D3, Bloque 5) da saldo 0 y no se lista.
 */
async function auxiliarCobrar(db: DB, tenantId: string, inicio: string, corte: string): Promise<Auxiliar> {
  const [facturas, aplicaciones, reversadas, cobros, notas, aplicacionesDeNotas, asFactura, asCobro, asNota, reversiones] =
    await Promise.all([
      db
        .from("invoices")
        .select("id, invoice_number, issue_date, accounting_date, due_date, grand_total, status, cancelled_at, client_id, clients!inner(id, name)")
        .eq("tenant_id", tenantId)
        .eq(DE_PRUEBA, false)
        .in("status", ["emitida", "parcialmente_pagada", "pagada", "anulada"])
        .order("due_date"),
      db
        .from("payment_applications")
        .select("payment_id, invoice_id, amount_applied, applied_at, created_at, payments(payment_date, created_at)")
        .eq("tenant_id", tenantId),
      // Lo que se borró al reversar un cobro (046): al corte anterior, restaba.
      db
        .from("payment_reversals")
        .select("payment_id, invoice_id, amount_applied, reversed_at, payments(payment_date)")
        .eq("tenant_id", tenantId),
      db
        .from("payments")
        .select("id, payment_number, payment_date, amount, status, created_at, updated_at, client_id, clients!inner(id, name)")
        .eq("tenant_id", tenantId)
        .eq(DE_PRUEBA, false),
      db
        .from("credit_notes")
        .select("id, credit_note_number, invoice_id, accounting_date, issue_date, grand_total, status, cancelled_at, client_id, clients(name)")
        .eq("tenant_id", tenantId)
        .eq(DE_PRUEBA, false)
        .in("status", ["emitida", "anulada"]),
      db.from("credit_note_applications").select("credit_note_id, invoice_id, amount_applied, created_at").eq("tenant_id", tenantId),
      asientosDe(db, tenantId, "factura"),
      asientosDe(db, tenantId, "pago"),
      asientosDe(db, tenantId, "nota_credito"),
      fechasDeReversion(db, tenantId),
    ]);
  if (facturas.error) {
    console.error("[finanzas/antiguedad] facturas failed", facturas.error);
    throw new Error("No se pudieron leer las facturas pendientes");
  }

  // Hasta cuándo restó un cobro: la fecha de registro de su reversión.
  const cobroReversadoEl = (id: string, status?: string, actualizado?: string | null) => {
    const asiento = asCobro.get(id);
    const f = asiento ? reversiones.get(asiento) : undefined;
    return f ?? (status === "anulado" ? diaEnPanama(actualizado) : null);
  };
  type Cobro = {
    id: string; payment_number: string | null; payment_date: string; amount: number | string; status: string;
    created_at: string; updated_at: string | null; client_id: string; clients: { id: string; name: string };
  };
  const listaDeCobros = (cobros.data ?? []) as unknown as Cobro[];
  const estadoDeCobro = new Map(listaDeCobros.map((c) => [c.id, c]));

  // Las bajas de cada factura y lo aplicado de cada cobro / NC, con su fecha.
  const bajas = new Map<string, Baja[]>();
  const aplicadoDe = new Map<string, Baja[]>();
  const sumar = (m: Map<string, Baja[]>, id: string, b: Baja) => m.set(id, [...(m.get(id) ?? []), b]);

  type App = {
    payment_id: string; invoice_id: string; amount_applied: number | string; applied_at: string | null;
    created_at: string | null; payments: { payment_date: string; created_at: string | null } | null;
  };
  const apps = (aplicaciones.data ?? []) as unknown as App[];
  for (const a of apps) {
    const p = uno(a.payments);
    const c = estadoDeCobro.get(a.payment_id);
    const fecha = p
      ? fechaDeAplicacion(d10(p.payment_date), p.created_at, a.applied_at ?? a.created_at, hoyEnPanama)
      : diaEnPanama(a.applied_at ?? a.created_at) ?? "0000-01-01";
    const b = { fecha, monto: Number(a.amount_applied), hasta: cobroReversadoEl(a.payment_id, c?.status, c?.updated_at) };
    sumar(bajas, a.invoice_id, b);
    sumar(aplicadoDe, a.payment_id, b);
  }
  type Rev = { payment_id: string; invoice_id: string; amount_applied: number | string; reversed_at: string | null; payments: { payment_date: string } | null };
  for (const r of (reversadas.data ?? []) as unknown as Rev[]) {
    const p = uno(r.payments);
    const b = {
      fecha: p ? d10(p.payment_date) : "0000-01-01",
      monto: Number(r.amount_applied),
      hasta: cobroReversadoEl(r.payment_id) ?? diaEnPanama(r.reversed_at),
    };
    sumar(bajas, r.invoice_id, b);
    sumar(aplicadoDe, r.payment_id, b);
  }

  type Nota = {
    id: string; credit_note_number: string; invoice_id: string | null; accounting_date: string | null; issue_date: string;
    grand_total: number | string; status: string; cancelled_at: string | null; client_id: string; clients: { name: string } | null;
  };
  const listaDeNotas = (notas.data ?? []) as unknown as Nota[];
  const notaReversadaEl = (n: Nota) => {
    if (n.status !== "anulada") return null;
    const asiento = asNota.get(n.id);
    return (asiento ? reversiones.get(asiento) : undefined) ?? diaEnPanama(n.cancelled_at);
  };
  const fechaDeNota = (n: Nota) => d10(n.accounting_date ?? n.issue_date);
  const notaPorId = new Map(listaDeNotas.map((n) => [n.id, n]));
  for (const n of listaDeNotas) {
    // La NC nacida sobre la factura la acredita entera desde su fecha de registro.
    if (n.invoice_id) sumar(bajas, n.invoice_id, { fecha: fechaDeNota(n), monto: Number(n.grand_total), hasta: notaReversadaEl(n) });
  }
  for (const a of (aplicacionesDeNotas.data ?? []) as { credit_note_id: string; invoice_id: string; amount_applied: number | string; created_at: string | null }[]) {
    const n = notaPorId.get(a.credit_note_id);
    const fecha = mayor(n ? fechaDeNota(n) : "0000-01-01", diaEnPanama(a.created_at));
    const b = { fecha, monto: Number(a.amount_applied), hasta: n ? notaReversadaEl(n) : null };
    sumar(bajas, a.invoice_id, b);
    sumar(aplicadoDe, a.credit_note_id, b);
  }

  // ── Facturas ───────────────────────────────────────────────────────────────
  type Factura = {
    id: string; invoice_number: string; issue_date: string; accounting_date: string | null; due_date: string;
    grand_total: number | string; status: string; cancelled_at: string | null; client_id: string; clients: { id: string; name: string };
  };
  const documentos: DocumentoPendiente[] = [];
  const sinAsientoDocs = { cantidad: 0, monto: 0 };
  const fueraDocs = { cantidad: 0, monto: 0 };
  for (const f of (facturas.data ?? []) as unknown as Factura[]) {
    const desde = d10(f.accounting_date ?? f.issue_date);
    const asiento = asFactura.get(f.id);
    const finEn =
      f.status === "anulada" ? (asiento ? reversiones.get(asiento) : undefined) ?? diaEnPanama(f.cancelled_at) ?? desde : null;
    const saldo = saldoAlCorte({ desde, total: Number(f.grand_total), bajas: bajas.get(f.id) ?? [], finEn }, corte);
    if (saldo === null || saldo <= 0.005) continue;
    const vence = d10(f.due_date);
    // 096: anterior al inicio contable. Sigue en la antigüedad; su saldo está
    // en el saldo inicial de 100004, no en un asiento del CRM.
    const fuera = esContabilizadoFuera(f.issue_date, inicio);
    documentos.push({
      id: f.id,
      numero: f.invoice_number,
      tercero: f.clients.name,
      terceroId: f.client_id,
      fechaReferencia: vence,
      diasVencido: diasAlCorte(vence, corte),
      saldo,
      sourceType: "factura",
      contabilizadoFuera: fuera,
    });
    if (!asiento) {
      sinAsientoDocs.cantidad += 1;
      sinAsientoDocs.monto += saldo;
      if (fuera) {
        fueraDocs.cantidad += 1;
        fueraDocs.monto += saldo;
      }
    }
  }

  // ── 074: SALDOS A FAVOR de los cobros, en NEGATIVO ─────────────────────────
  // El asiento del cobro acreditó 100004 por el TOTAL, así que el excedente ya
  // está en el mayor. Sólo cobros CONTABILIZADOS. Tramo corriente (no vence).
  for (const c of listaDeCobros) {
    if (!asCobro.has(c.id)) continue;
    const fecha = d10(c.payment_date);
    if (!vigenteAlCorte(fecha, cobroReversadoEl(c.id, c.status, c.updated_at), corte)) continue;
    const saldo = saldoAlCorte({ desde: fecha, total: Number(c.amount), bajas: aplicadoDe.get(c.id) ?? [] }, corte) ?? 0;
    if (saldo <= 0.005) continue;
    documentos.push({
      id: c.id,
      numero: `${c.payment_number ?? "Cobro"} (saldo a favor)`,
      tercero: c.clients.name,
      terceroId: c.client_id,
      fechaReferencia: fecha,
      diasVencido: 0,
      saldo: -saldo,
      sourceType: "pago",
    });
  }

  // ── E8: NC SIN FACTURA, saldo a favor en NEGATIVO ──────────────────────────
  for (const n of listaDeNotas) {
    if (n.invoice_id || !asNota.has(n.id)) continue;
    const fecha = fechaDeNota(n);
    if (!vigenteAlCorte(fecha, notaReversadaEl(n), corte)) continue;
    const saldo = saldoAlCorte({ desde: fecha, total: Number(n.grand_total), bajas: aplicadoDe.get(n.id) ?? [] }, corte) ?? 0;
    if (saldo <= 0.005) continue;
    documentos.push({
      id: n.id,
      numero: `${n.credit_note_number} (saldo a favor)`,
      tercero: uno(n.clients)?.name ?? "",
      terceroId: n.client_id,
      fechaReferencia: fecha,
      diasVencido: 0,
      saldo: -saldo,
      sourceType: "nota_credito",
    });
  }

  // ── Cobros SIN ASIENTO: descontados del auxiliar y no del mayor ────────────
  const pagosContados = new Set<string>();
  const sinAsientoCobros = { cantidad: 0, monto: 0 };
  const fueraCobros = { cantidad: 0, monto: 0 };
  for (const a of apps) {
    if (asCobro.has(a.payment_id)) continue;
    const fechaDelCobro = uno(a.payments)?.payment_date ?? null;
    if (fechaDelCobro && d10(fechaDelCobro) > corte) continue;
    const fuera = esContabilizadoFuera(fechaDelCobro, inicio);
    sinAsientoCobros.monto += Number(a.amount_applied);
    if (fuera) fueraCobros.monto += Number(a.amount_applied);
    // Un pago puede aplicarse a varias facturas: se cuenta el pago una vez.
    if (!pagosContados.has(a.payment_id)) {
      pagosContados.add(a.payment_id);
      sinAsientoCobros.cantidad += 1;
      if (fuera) fueraCobros.cantidad += 1;
    }
  }

  return {
    documentos,
    sinAsiento: {
      documentos: { cantidad: sinAsientoDocs.cantidad, monto: round2(sinAsientoDocs.monto) },
      cobros: { cantidad: sinAsientoCobros.cantidad, monto: round2(sinAsientoCobros.monto) },
      contabilizadosFuera: {
        documentos: { cantidad: fueraDocs.cantidad, monto: round2(fueraDocs.monto) },
        cobros: { cantidad: fueraCobros.cantidad, monto: round2(fueraCobros.monto) },
      },
    },
  };
}

/**
 * Gastos de TRÁMITE (Bloque 4, FND-010): acreditan 200001 al registrarse, así
 * que entran al auxiliar.
 *
 * 🔴 SOLO los que están EN EL LIBRO (`posted_entry_id`) o CONTABILIZADOS FUERA
 * (096, anteriores al inicio contable: su cuenta por pagar está en el saldo
 * inicial de 200001). Los demás sin asiento no están en 200001 y no entran.
 * Se leen también los pagados y los anulados: al corte pudieron estar
 * pendientes (el saldo sale de la historia; uno anulado deja de existir desde la
 * fecha de su reversión).
 */
async function gastosTramitePendientes(db: DB, tenantId: string, inicio: string) {
  return db
    .from("expenses")
    .select("id, supplier_id, concept, date, accounting_date, due_date, amount, status, posted_entry_id")
    .eq("tenant_id", tenantId)
    .eq(DE_PRUEBA, false)
    .or(`posted_entry_id.not.is.null,date.lt.${inicio}`)
    .in("status", ["pendiente_pago", "parcialmente_pagado", "pagado", "anulado"])
    .order("due_date");
}

/**
 * POR PAGAR: compras (agrupadas por la ficha del proveedor, 033, con la
 * antigüedad desde `due_date`), gastos de trámite en el libro, NC de proveedor
 * sin compra en negativo (E8), y lo que no llega al mayor.
 *
 * El saldo de una compra se reconstruye: total − pagos (048) − NC del
 * proveedor (066) − aplicaciones (076). Un SALDO HEREDADO (`migrated_balance`)
 * resta como un pago y se cuenta aparte en lo «sin asiento».
 */
async function auxiliarPagar(db: DB, tenantId: string, inicio: string, corte: string): Promise<Auxiliar> {
  const [compras, tramites, pagos, notas, aplicacionesDeNotas, asCompra, asPago, asNota, reversiones] = await Promise.all([
    db
      .from("business_expenses")
      .select("id, supplier_id, supplier_name, description, expense_date, accounting_date, due_date, total")
      .eq("tenant_id", tenantId)
      .order("due_date"),
    gastosTramitePendientes(db, tenantId, inicio),
    db
      .from("supplier_payments")
      .select("id, business_expense_id, expense_id, kind, amount, payment_date, status, updated_at")
      .eq("tenant_id", tenantId)
      .in("status", ["registrado", "anulado"]),
    db
      .from("supplier_credit_notes")
      .select("id, credit_note_number, business_expense_id, supplier_id, issue_date, grand_total, status, cancelled_at, suppliers(legal_name, trade_name)")
      .eq("tenant_id", tenantId)
      .in("status", ["emitida", "anulada"]),
    db
      .from("supplier_credit_note_applications")
      .select("credit_note_id, business_expense_id, amount_applied, created_at")
      .eq("tenant_id", tenantId),
    asientosDe(db, tenantId, "gasto"),
    asientosDe(db, tenantId, "pago_proveedor"),
    asientosDe(db, tenantId, "nota_credito_proveedor"),
    fechasDeReversion(db, tenantId),
  ]);
  if (compras.error || tramites.error) {
    console.error("[finanzas/antiguedad] compras o trámites failed", compras.error ?? tramites.error);
    throw new Error("No se pudieron leer los gastos pendientes");
  }

  const bajasCompra = new Map<string, Baja[]>();
  const bajasTramite = new Map<string, Baja[]>();
  const aplicadoDe = new Map<string, Baja[]>();
  const sumar = (m: Map<string, Baja[]>, id: string, b: Baja) => m.set(id, [...(m.get(id) ?? []), b]);

  type Pago = { id: string; business_expense_id: string | null; expense_id: string | null; kind: string; amount: number | string; payment_date: string | null; status: string; updated_at: string | null };
  const listaDePagos = (pagos.data ?? []) as Pago[];
  const pagoReversadoEl = (p: Pago) => {
    if (p.status !== "anulado") return null;
    const asiento = asPago.get(p.id);
    return (asiento ? reversiones.get(asiento) : undefined) ?? diaEnPanama(p.updated_at);
  };
  // Un saldo heredado puede no tener fecha: ya estaba pagado antes de todo.
  const fechaDePago = (p: Pago) => (p.payment_date ? d10(p.payment_date) : "0000-01-01");
  for (const p of listaDePagos) {
    const b = { fecha: fechaDePago(p), monto: Number(p.amount), hasta: pagoReversadoEl(p) };
    if (p.business_expense_id) sumar(bajasCompra, p.business_expense_id, b);
    if (p.expense_id) sumar(bajasTramite, p.expense_id, b);
  }

  type NotaProv = {
    id: string; credit_note_number: string; business_expense_id: string | null; supplier_id: string | null; issue_date: string;
    grand_total: number | string; status: string; cancelled_at: string | null;
    suppliers: { legal_name: string; trade_name: string | null } | null;
  };
  const listaDeNotas = (notas.data ?? []) as unknown as NotaProv[];
  const notaReversadaEl = (n: NotaProv) => {
    if (n.status !== "anulada") return null;
    const asiento = asNota.get(n.id);
    return (asiento ? reversiones.get(asiento) : undefined) ?? diaEnPanama(n.cancelled_at);
  };
  const notaPorId = new Map(listaDeNotas.map((n) => [n.id, n]));
  for (const n of listaDeNotas) {
    if (n.business_expense_id) {
      sumar(bajasCompra, n.business_expense_id, { fecha: d10(n.issue_date), monto: Number(n.grand_total), hasta: notaReversadaEl(n) });
    }
  }
  for (const a of (aplicacionesDeNotas.data ?? []) as { credit_note_id: string; business_expense_id: string; amount_applied: number | string; created_at: string | null }[]) {
    const n = notaPorId.get(a.credit_note_id);
    const b = { fecha: mayor(n ? d10(n.issue_date) : "0000-01-01", diaEnPanama(a.created_at)), monto: Number(a.amount_applied), hasta: n ? notaReversadaEl(n) : null };
    sumar(bajasCompra, a.business_expense_id, b);
    sumar(aplicadoDe, a.credit_note_id, b);
  }

  // El nombre sale de la ficha, en una query aparte. Así dos gastos del mismo
  // proveedor muestran el MISMO nombre aunque se hayan tipeado distinto.
  type Compra = { id: string; supplier_id: string | null; supplier_name: string | null; description: string | null; expense_date: string; accounting_date: string | null; due_date: string | null; total: number | string };
  type Tramite = { id: string; supplier_id: string | null; concept: string | null; date: string; accounting_date: string | null; due_date: string | null; amount: number | string; status: string; posted_entry_id: string | null };
  const listaDeCompras = (compras.data ?? []) as Compra[];
  const listaDeTramites = (tramites.data ?? []) as Tramite[];
  const ids = Array.from(
    new Set([...listaDeCompras, ...listaDeTramites].map((g) => g.supplier_id).filter((v): v is string => !!v))
  );
  const nombres = new Map<string, string>();
  if (ids.length > 0) {
    const { data: provs } = await db.from("suppliers").select("id, legal_name, trade_name").eq("tenant_id", tenantId).in("id", ids);
    for (const p of (provs ?? []) as { id: string; legal_name: string; trade_name: string | null }[]) nombres.set(p.id, nombreDeProveedor(p));
  }

  const documentos: DocumentoPendiente[] = [];
  const sinAsientoDocs = { cantidad: 0, monto: 0 };
  const fueraDocs = { cantidad: 0, monto: 0 };

  for (const g of listaDeCompras) {
    const saldo = saldoAlCorte(
      { desde: d10(g.accounting_date ?? g.expense_date), total: Number(g.total), bajas: bajasCompra.get(g.id) ?? [] },
      corte
    );
    if (saldo === null || saldo <= 0.005) continue;
    // Sin vencimiento cargado se cae en la fecha del gasto, que equivale a
    // tratarlo como contado. Es el comportamiento viejo, no un caso de error.
    const referencia = d10(g.due_date ?? g.expense_date);
    const fuera = esContabilizadoFuera(g.expense_date, inicio);
    documentos.push({
      id: g.id,
      numero: g.description?.trim() || "(sin descripción)",
      tercero: (g.supplier_id ? nombres.get(g.supplier_id) : undefined) ?? g.supplier_name?.trim() ?? "(sin proveedor)",
      // Un gasto sin ficha cae en null y se agrupa por su texto, como antes.
      terceroId: g.supplier_id,
      fechaReferencia: referencia,
      diasVencido: diasAlCorte(referencia, corte),
      saldo,
      sourceType: "gasto",
      contabilizadoFuera: fuera,
    });
    if (!asCompra.has(g.id)) {
      sinAsientoDocs.cantidad += 1;
      sinAsientoDocs.monto += saldo;
      if (fuera) {
        fueraDocs.cantidad += 1;
        fueraDocs.monto += saldo;
      }
    }
  }

  for (const g of listaDeTramites) {
    const desde = d10(g.accounting_date ?? g.date);
    const finEn = g.status === "anulado" ? (g.posted_entry_id ? reversiones.get(g.posted_entry_id) : undefined) ?? desde : null;
    const saldo = saldoAlCorte({ desde, total: Number(g.amount), bajas: bajasTramite.get(g.id) ?? [], finEn }, corte);
    if (saldo === null || saldo <= 0.005) continue;
    const referencia = d10(g.due_date ?? g.date);
    documentos.push({
      id: g.id,
      numero: g.concept?.trim() || "(sin concepto)",
      // Sin ficha no hay texto libre en `expenses` (D2): va "(sin proveedor)".
      tercero: (g.supplier_id ? nombres.get(g.supplier_id) : undefined) ?? "(sin proveedor)",
      terceroId: g.supplier_id,
      fechaReferencia: referencia,
      diasVencido: diasAlCorte(referencia, corte),
      saldo,
      sourceType: "gasto_tramite",
      contabilizadoFuera: esContabilizadoFuera(g.date, inicio),
    });
    // 096: los CONTABILIZADOS FUERA entran sin asiento: también son documentos
    // sin asiento. Los demás sin asiento ni siquiera se leen.
    if (!g.posted_entry_id) {
      sinAsientoDocs.cantidad += 1;
      sinAsientoDocs.monto += saldo;
      fueraDocs.cantidad += 1;
      fueraDocs.monto += saldo;
    }
  }

  // ── E8: NC de proveedor SIN COMPRA, saldo a favor en NEGATIVO ──────────────
  for (const n of listaDeNotas) {
    if (n.business_expense_id || !asNota.has(n.id)) continue;
    const fecha = d10(n.issue_date);
    if (!vigenteAlCorte(fecha, notaReversadaEl(n), corte)) continue;
    const saldo = saldoAlCorte({ desde: fecha, total: Number(n.grand_total), bajas: aplicadoDe.get(n.id) ?? [] }, corte) ?? 0;
    if (saldo <= 0.005) continue;
    documentos.push({
      id: n.id,
      numero: `${n.credit_note_number} (saldo a favor)`,
      tercero: nombreDeProveedor(uno(n.suppliers)),
      terceroId: String(n.supplier_id),
      fechaReferencia: fecha,
      diasVencido: 0,
      saldo: -saldo,
      sourceType: "nota_credito_proveedor",
    });
  }

  // ── PAGOS SIN ASIENTO (los saldos heredados de la 048 se nombran aparte) ───
  const sinAsientoPagos = { cantidad: 0, monto: 0 };
  const heredados = { cantidad: 0, monto: 0 };
  const fueraPagos = { cantidad: 0, monto: 0 };
  for (const p of listaDePagos) {
    if (asPago.has(p.id)) continue;
    if (!vigenteAlCorte(fechaDePago(p), pagoReversadoEl(p), corte)) continue;
    const monto = Number(p.amount);
    sinAsientoPagos.cantidad += 1;
    sinAsientoPagos.monto += monto;
    if (p.kind === "migrated_balance") {
      heredados.cantidad += 1;
      heredados.monto += monto;
    } else if (esContabilizadoFuera(p.payment_date, inicio)) {
      fueraPagos.cantidad += 1;
      fueraPagos.monto += monto;
    }
  }

  return {
    documentos,
    sinAsiento: {
      documentos: { cantidad: sinAsientoDocs.cantidad, monto: round2(sinAsientoDocs.monto) },
      cobros: { cantidad: sinAsientoPagos.cantidad, monto: round2(sinAsientoPagos.monto) },
      heredados: { cantidad: heredados.cantidad, monto: round2(heredados.monto) },
      contabilizadosFuera: {
        documentos: { cantidad: fueraDocs.cantidad, monto: round2(fueraDocs.monto) },
        cobros: { cantidad: fueraPagos.cantidad, monto: round2(fueraPagos.monto) },
      },
    },
  };
}

/*
 * LOS DOCUMENTOS QUE TODAVÍA NO LLEGAN AL MAYOR son la segunda causa de que el
 * auxiliar no cuadre (la primera es la apertura sin detalle). Se miden en la
 * base, en `auxiliarCobrar` y `auxiliarPagar`, y no se deducen del residuo: si
 * algún día hubiera una tercera causa, el reporte lo nota
 * (`porCablearExplicado`) en vez de atribuirle todo a estas dos.
 */

/**
 * 100: las partidas de los asientos de apertura que aparecen en las líneas de
 * la cuenta control, y si hay una apertura VIGENTE.
 */
async function partidasDeAperturaDelLibro(
  db: DB,
  tenantId: string,
  lineas: LineaDeControl[],
  corte: string
): Promise<{ partidas: PartidaDeApertura[]; conDetalle: Set<string>; vigente: boolean }> {
  let vigente = false;
  try {
    const { data: vig, error: errV } = await db.from("aperturas").select("id, fecha").eq("tenant_id", tenantId).eq("estado", "vigente").limit(1);
    // Antes de la 100 la tabla no existe: no hay apertura. Al corte anterior a
    // la fecha de la apertura, todavía no estaba.
    vigente = !errV && ((vig ?? []) as { fecha: string }[]).some((a) => String(a.fecha).slice(0, 10) <= corte);
  } catch {
    vigente = false;
  }
  const ids = Array.from(new Set(lineas.filter((l) => l.sourceType === "apertura").map((l) => l.entryId)));
  if (ids.length === 0) return { partidas: [], conDetalle: new Set(), vigente };
  const { data, error } = await db
    .from("apertura_partidas")
    .select(
      "id, entry_id, account_code, client_id, supplier_id, documento_externo, fecha_documento, vencimiento, debit, credit, " +
        "clients(name), suppliers(legal_name, trade_name), aperturas(fecha), journal_entries(reference)"
    )
    .eq("tenant_id", tenantId)
    .in("entry_id", ids);
  if (error) {
    console.error("[finanzas/antiguedad] apertura_partidas failed", error);
    return { partidas: [], conDetalle: new Set(), vigente };
  }
  type Fila = {
    id: string; entry_id: string; account_code: string; client_id: string | null; supplier_id: string | null;
    documento_externo: string | null; fecha_documento: string | null; vencimiento: string | null;
    debit: number | string; credit: number | string; clients: { name: string } | null;
    suppliers: { legal_name: string; trade_name: string | null } | null; aperturas: { fecha: string } | null;
    journal_entries: { reference: string | null } | null;
  };
  const partidas: PartidaDeApertura[] = [];
  for (const f of (data ?? []) as unknown as Fila[]) {
    const cuenta = f.account_code === CUENTA_CONTROL.cobrar ? "cobrar" : f.account_code === CUENTA_CONTROL.pagar ? "pagar" : null;
    const terceroId = cuenta === "cobrar" ? f.client_id : cuenta === "pagar" ? f.supplier_id : null;
    if (!cuenta || !terceroId) continue;
    partidas.push({
      id: f.id,
      entryId: f.entry_id,
      referencia: f.journal_entries?.reference ?? null,
      cuenta,
      terceroId,
      terceroNombre: f.clients?.name ?? (f.suppliers ? f.suppliers.trade_name?.trim() || f.suppliers.legal_name : null),
      documento: f.documento_externo,
      fechaDocumento: f.fecha_documento ? String(f.fecha_documento).slice(0, 10) : null,
      vencimiento: f.vencimiento ? String(f.vencimiento).slice(0, 10) : null,
      fechaApertura: String(f.aperturas?.fecha ?? f.fecha_documento ?? "").slice(0, 10),
      debit: Number(f.debit),
      credit: Number(f.credit),
    });
  }
  return { partidas, conDetalle: new Set(partidas.map((p) => p.entryId)), vigente };
}

/**
 * La antigüedad AL CORTE (`YYYY-MM-DD`, por defecto hoy en Panamá): documentos,
 * cobros, pagos, NC y partidas de diario y de apertura con fecha de registro
 * hasta ese día, días de atraso contados contra el corte, y la cuenta control
 * con los asientos hasta el corte.
 */
export async function loadAntiguedad(
  db: DB,
  tenantId: string,
  tipo: TipoAntiguedad,
  corte: string = hoyEnPanama()
): Promise<{
  documentos: DocumentoPendiente[];
  control: ControlMedido;
}> {
  // 096: el inicio contable, para lo «contabilizado fuera».
  const inicio = await cargarInicioContable(db, tenantId);
  const [auxiliar, controlCrudo, diario] = await Promise.all([
    // Cobrar: facturas + saldos a favor de cobros (074) y de NC sin factura (E8).
    // Pagar: compras + gastos de trámite EN EL LIBRO (FND-010) + NC de proveedor sin compra.
    tipo === "cobrar" ? auxiliarCobrar(db, tenantId, inicio, corte) : auxiliarPagar(db, tenantId, inicio, corte),
    saldoDeCuentaControl(db, tenantId, CUENTA_CONTROL[tipo], corte),
    lineasDeDiarioContraControl(db, tenantId, CUENTA_CONTROL[tipo]),
  ]);

  // Al corte: las líneas hasta ese día, y reversado sólo lo que se reversó
  // hasta ese día.
  const lineas = diario.lineas.filter((l) => l.fecha <= corte);
  const reversados = new Set(
    Array.from(diario.reversiones.entries())
      .filter(([, fecha]) => fecha <= corte)
      .map(([id]) => id)
  );
  // `partidasDeDiario` cuenta los días entre dos medianoches locales: con el
  // corte también a medianoche local, da los días calendario.
  const alCorte = new Date(`${corte}T00:00:00`);

  // 100: con una APERTURA VIGENTE, lo anterior al inicio contable ya está en el
  // libro (en la apertura, por documento): esos documentos salen del auxiliar y
  // de lo «sin asiento», y en su lugar cuentan las partidas de la apertura. Así
  // la factura anterior al inicio aparece una sola vez. Sin apertura, como antes.
  const apertura = await partidasDeAperturaDelLibro(db, tenantId, lineas, corte);
  const conVigente = apertura.vigente;
  const modulo = conVigente ? auxiliar.documentos.filter((d) => !d.contabilizadoFuera) : auxiliar.documentos;

  // E9: las partidas de diario y de apertura CON tercero son saldo de ese
  // tercero; las que no lo tienen siguen explicando la diferencia (D5).
  const documentos = [
    ...modulo,
    ...partidasDeDiario(lineas, tipo, reversados, alCorte, apertura.conDetalle),
    ...partidasDeApertura(apertura.partidas, tipo, reversados, alCorte),
  ];
  const base = auxiliar.sinAsiento;
  const fuera = base.contabilizadosFuera;
  const sinAsiento: SinAsiento = {
    ...(conVigente && fuera
      ? {
          ...base,
          documentos: {
            cantidad: base.documentos.cantidad - fuera.documentos.cantidad,
            monto: round2(base.documentos.monto - fuera.documentos.monto),
          },
          cobros: {
            cantidad: base.cobros.cantidad - fuera.cobros.cantidad,
            monto: round2(base.cobros.monto - fuera.cobros.monto),
          },
          contabilizadosFuera: { documentos: { cantidad: 0, monto: 0 }, cobros: { cantidad: 0, monto: 0 } },
        }
      : base),
    manuales: manualesSinTercero(lineas, tipo, reversados),
  };

  // El auxiliar de pagar se compara en VALOR ABSOLUTO: la cuenta por pagar tiene
  // saldo acreedor (negativo en balanza) y los documentos son montos positivos.
  const control: ControlMedido =
    tipo === "pagar"
      ? {
          ...controlCrudo,
          saldoCuentaControl: Math.abs(controlCrudo.saldoCuentaControl),
          saldoApertura: Math.abs(controlCrudo.saldoApertura),
          sinAsiento,
        }
      : { ...controlCrudo, sinAsiento };

  return { documentos, control };
}

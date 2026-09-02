/**
 * FUENTE DE DATOS de la antigüedad de saldos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS COSAS QUE HAY QUE SABER ANTES DE LEER ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **EL PROVEEDOR TODAVÍA NO ES UNA ENTIDAD.** En `business_expenses` es
 *    `supplier_name`, texto libre que se reescribe en cada gasto. No hay tabla de
 *    proveedores. Así que la antigüedad de cuentas por pagar agrupa POR ESE
 *    TEXTO: dos gastos escritos con una coma de diferencia salen como dos
 *    proveedores distintos. Crear la entidad es del módulo de compras y va
 *    después; acá se agrupa con lo que hay y la pantalla lo advierte.
 *
 * 2. **LOS GASTOS DEL BUFETE NO TIENEN FECHA DE VENCIMIENTO.** La tabla solo
 *    tiene `expense_date` y `payment_date`; el campo de vencimiento está en la
 *    lista de pendientes del módulo de compras. Así que la antigüedad de CxP se
 *    cuenta desde la FECHA DEL GASTO, no desde su vencimiento — que es una
 *    antigüedad distinta y más pesimista. La pantalla lo dice con esas palabras.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ControlMedido,
  DocumentoPendiente,
  SinAsiento,
} from "@/lib/finanzas/reports/antiguedad";

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

/** Días entre una fecha y hoy. Positivo = ya pasó. */
function diasDesde(fecha: string): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(`${fecha}T00:00:00`);
  return Math.round((hoy.getTime() - d.getTime()) / 86_400_000);
}

/**
 * Saldo de la cuenta control: apertura + movimientos del ledger.
 *
 * Se calcula igual que en `accounting-source.ts` a propósito — es el número que
 * muestra el Balance General, y compararse contra otra cosa no probaría nada.
 */
async function saldoDeCuentaControl(
  db: DB,
  tenantId: string,
  code: string
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
    .select("debit, credit")
    .eq("tenant_id", tenantId)
    .eq("account_id", c.id);

  let neto = 0;
  for (const l of (lineas ?? []) as { debit: number | string; credit: number | string }[]) {
    neto += Number(l.debit) - Number(l.credit);
  }

  const apertura = round2(Number(c.saldo_inicial ?? 0));
  return {
    saldoCuentaControl: round2(apertura + neto),
    saldoApertura: apertura,
    cuentaCodigo: c.code,
    cuentaNombre: c.name,
  };
}

/**
 * Facturas pendientes de cobro.
 *
 * ⚠️ El filtro va por STATUS, no por `balance_due > 0`. Una factura anulada, en
 * borrador o cancelada antes de emitirse tiene `balance_due` mayor que cero
 * —porque esa columna es `grand_total − amount_paid` y no mira el estado— pero
 * NO es una cuenta por cobrar. Sumarlas infla el auxiliar con documentos que no
 * son deuda de nadie.
 */
async function facturasPendientes(db: DB, tenantId: string): Promise<DocumentoPendiente[]> {
  const { data, error } = await db
    .from("invoices")
    .select("id, invoice_number, due_date, balance_due, client_id, clients!inner(id, name)")
    .eq("tenant_id", tenantId)
    .in("status", ["emitida", "parcialmente_pagada"])
    .order("due_date");

  if (error) {
    console.error("[finanzas/antiguedad] facturasPendientes failed", error);
    throw new Error("No se pudieron leer las facturas pendientes");
  }

  type Fila = {
    id: string;
    invoice_number: string;
    due_date: string;
    balance_due: number | string;
    client_id: string;
    clients: { id: string; name: string };
  };

  return ((data ?? []) as unknown as Fila[])
    .filter((f) => Number(f.balance_due) > 0.005)
    .map((f) => ({
      id: f.id,
      numero: f.invoice_number,
      tercero: f.clients.name,
      terceroId: f.client_id,
      fechaReferencia: String(f.due_date).slice(0, 10),
      diasVencido: diasDesde(String(f.due_date).slice(0, 10)),
      saldo: round2(Number(f.balance_due)),
      sourceType: "factura",
    }));
}

/**
 * Gastos del bufete pendientes de pago.
 *
 * La antigüedad se cuenta desde `expense_date`: no hay fecha de vencimiento (ver
 * el encabezado del archivo). Y el tercero es `supplier_name`, texto libre.
 */
async function gastosPendientes(db: DB, tenantId: string): Promise<DocumentoPendiente[]> {
  const { data, error } = await db
    .from("business_expenses")
    .select("id, supplier_name, description, expense_date, total")
    .eq("tenant_id", tenantId)
    .eq("status", "pendiente_pago")
    .order("expense_date");

  if (error) {
    console.error("[finanzas/antiguedad] gastosPendientes failed", error);
    throw new Error("No se pudieron leer los gastos pendientes");
  }

  type Fila = {
    id: string;
    supplier_name: string | null;
    description: string | null;
    expense_date: string;
    total: number | string;
  };

  return ((data ?? []) as unknown as Fila[])
    .filter((g) => Number(g.total) > 0.005)
    .map((g) => ({
      id: g.id,
      numero: g.description?.trim() || "(sin descripción)",
      tercero: g.supplier_name?.trim() || "(sin proveedor)",
      // null a propósito: el proveedor no es una entidad, así que no hay id al
      // que enlazar. Se agrupa por el texto.
      terceroId: null,
      fechaReferencia: String(g.expense_date).slice(0, 10),
      diasVencido: diasDesde(String(g.expense_date).slice(0, 10)),
      saldo: round2(Number(g.total)),
      sourceType: "gasto",
    }));
}

/**
 * LOS DOCUMENTOS QUE TODAVÍA NO LLEGAN AL MAYOR.
 *
 * Es la segunda causa de que el auxiliar no cuadre, y no tiene nada que ver con
 * la primera: la apertura es un dato histórico que falta, esto es cableado que
 * falta construir. Un asiento se reconoce por `source_type` + `source_id`.
 *
 * Se mide en la base y no se deduce del residuo: si algún día hubiera una tercera
 * causa, el reporte lo va a notar (`porCablearExplicado`) en vez de atribuirle
 * todo a estas dos.
 */
async function idsConAsiento(
  db: DB,
  tenantId: string,
  sourceType: string
): Promise<Set<string>> {
  const { data } = await db
    .from("journal_entries")
    .select("source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", sourceType);

  const ids = new Set<string>();
  for (const e of (data ?? []) as { source_id: string | null }[]) {
    if (e.source_id) ids.add(e.source_id);
  }
  return ids;
}

/** CxC: facturas del auxiliar sin asiento, y cobros sin asiento. */
async function sinAsientoCobrar(db: DB, tenantId: string): Promise<SinAsiento> {
  const [conAsientoFactura, conAsientoPago] = await Promise.all([
    idsConAsiento(db, tenantId, "factura"),
    idsConAsiento(db, tenantId, "pago"),
  ]);

  const { data: facturas } = await db
    .from("invoices")
    .select("id, balance_due")
    .eq("tenant_id", tenantId)
    .in("status", ["emitida", "parcialmente_pagada"]);

  const documentos = { cantidad: 0, monto: 0 };
  for (const f of (facturas ?? []) as { id: string; balance_due: number | string }[]) {
    const saldo = Number(f.balance_due);
    if (saldo > 0.005 && !conAsientoFactura.has(f.id)) {
      documentos.cantidad += 1;
      documentos.monto += saldo;
    }
  }

  const { data: aplicaciones } = await db
    .from("payment_applications")
    .select("amount_applied, payment_id")
    .eq("tenant_id", tenantId);

  const pagosContados = new Set<string>();
  const cobros = { cantidad: 0, monto: 0 };
  for (const a of (aplicaciones ?? []) as {
    amount_applied: number | string;
    payment_id: string;
  }[]) {
    if (conAsientoPago.has(a.payment_id)) continue;
    cobros.monto += Number(a.amount_applied);
    // Un pago puede aplicarse a varias facturas: se cuenta el pago una vez.
    if (!pagosContados.has(a.payment_id)) {
      pagosContados.add(a.payment_id);
      cobros.cantidad += 1;
    }
  }

  return {
    documentos: { cantidad: documentos.cantidad, monto: round2(documentos.monto) },
    cobros: { cantidad: cobros.cantidad, monto: round2(cobros.monto) },
  };
}

/**
 * CxP: gastos del auxiliar sin asiento.
 *
 * No hay lado de "pagos sin asiento": el pago de un gasto no es una entidad
 * propia, es una fecha en el gasto. Cuando exista el módulo de compras esto se
 * vuelve simétrico con el de cobrar.
 */
async function sinAsientoPagar(db: DB, tenantId: string): Promise<SinAsiento> {
  const conAsiento = await idsConAsiento(db, tenantId, "gasto");

  const { data } = await db
    .from("business_expenses")
    .select("id, total")
    .eq("tenant_id", tenantId)
    .eq("status", "pendiente_pago");

  const documentos = { cantidad: 0, monto: 0 };
  for (const g of (data ?? []) as { id: string; total: number | string }[]) {
    const monto = Number(g.total);
    if (monto > 0.005 && !conAsiento.has(g.id)) {
      documentos.cantidad += 1;
      documentos.monto += monto;
    }
  }

  return {
    documentos: { cantidad: documentos.cantidad, monto: round2(documentos.monto) },
    cobros: { cantidad: 0, monto: 0 },
  };
}

export async function loadAntiguedad(
  db: DB,
  tenantId: string,
  tipo: TipoAntiguedad
): Promise<{
  documentos: DocumentoPendiente[];
  control: ControlMedido;
}> {
  const [documentos, controlCrudo, sinAsiento] = await Promise.all([
    tipo === "cobrar" ? facturasPendientes(db, tenantId) : gastosPendientes(db, tenantId),
    saldoDeCuentaControl(db, tenantId, CUENTA_CONTROL[tipo]),
    tipo === "cobrar" ? sinAsientoCobrar(db, tenantId) : sinAsientoPagar(db, tenantId),
  ]);

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

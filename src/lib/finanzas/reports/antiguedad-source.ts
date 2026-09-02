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
 * Agrupa por `supplier_id` —la ficha del proveedor— y cuenta la antigüedad desde
 * `due_date`. Los dos campos llegaron con la migración 033; ver el encabezado.
 */
async function gastosPendientes(db: DB, tenantId: string): Promise<DocumentoPendiente[]> {
  const { data, error } = await db
    .from("business_expenses")
    .select("id, supplier_id, supplier_name, description, expense_date, due_date, total")
    .eq("tenant_id", tenantId)
    .eq("status", "pendiente_pago")
    .order("due_date");

  if (error) {
    console.error("[finanzas/antiguedad] gastosPendientes failed", error);
    throw new Error("No se pudieron leer los gastos pendientes");
  }

  type Fila = {
    id: string;
    supplier_id: string | null;
    supplier_name: string | null;
    description: string | null;
    expense_date: string;
    due_date: string | null;
    total: number | string;
  };

  const filas = ((data ?? []) as unknown as Fila[]).filter((g) => Number(g.total) > 0.005);

  // El nombre sale de la ficha, en una query aparte. Así dos gastos del mismo
  // proveedor muestran el MISMO nombre aunque se hayan tipeado distinto.
  const ids = Array.from(
    new Set(filas.map((g) => g.supplier_id).filter((v): v is string => !!v))
  );
  const nombres = new Map<string, string>();
  if (ids.length > 0) {
    const { data: provs } = await db
      .from("suppliers")
      .select("id, legal_name, trade_name")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    for (const p of (provs ?? []) as {
      id: string;
      legal_name: string;
      trade_name: string | null;
    }[]) {
      nombres.set(p.id, p.trade_name?.trim() || p.legal_name);
    }
  }

  return filas.map((g) => {
    // Sin vencimiento cargado se cae en la fecha del gasto, que equivale a
    // tratarlo como contado. Es el comportamiento viejo, no un caso de error.
    const referencia = String(g.due_date ?? g.expense_date).slice(0, 10);
    const nombreFicha = g.supplier_id ? nombres.get(g.supplier_id) : undefined;

    return {
      id: g.id,
      numero: g.description?.trim() || "(sin descripción)",
      tercero: nombreFicha ?? g.supplier_name?.trim() ?? "(sin proveedor)",
      // Ya hay id al que agrupar y enlazar. Un gasto sin ficha sigue cayendo en
      // null y se agrupa por su texto, como antes.
      terceroId: g.supplier_id,
      fechaReferencia: referencia,
      diasVencido: diasDesde(referencia),
      saldo: round2(Number(g.total)),
      sourceType: "gasto",
    };
  });
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

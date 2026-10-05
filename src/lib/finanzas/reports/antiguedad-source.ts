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
import {
  manualesSinTercero,
  partidasDeDiario,
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
 * LÍNEAS DE ASIENTOS MANUALES Y DE APERTURA contra la cuenta control (E9).
 *
 * Una sola lectura para dos usos (`partidas-de-diario.ts`): las líneas CON el
 * tercero del auxiliar son partidas de la tabla; las que no lo tienen (lo
 * anterior a la 071) siguen en la explicación de la diferencia (D5). Una
 * `reversion` no se lee: se usa para descartar los asientos que ya se
 * reversaron, que con su espejo suman cero en el mayor.
 */
async function lineasDeDiarioContraControl(
  db: DB,
  tenantId: string,
  code: string
): Promise<{ lineas: LineaDeControl[]; reversados: Set<string> }> {
  const vacio = { lineas: [] as LineaDeControl[], reversados: new Set<string>() };
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
        "journal_entries!inner(entry_number, source_type, transaction_date, reference)"
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
  const { data: espejos } = await db
    .from("journal_entries")
    .select("reverses_entry_id")
    .eq("tenant_id", tenantId)
    .in("reverses_entry_id", ids);
  const reversados = new Set(
    ((espejos ?? []) as { reverses_entry_id: string | null }[])
      .map((e) => e.reverses_entry_id)
      .filter((v): v is string => !!v)
  );
  return { lineas, reversados };
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
    .eq(DE_PRUEBA, false)
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

  // Por SALDO, no solo por status (D3, Bloque 5): una factura acreditada al
  // 100% por nota de crédito sigue `emitida` con `balance_due = 0` — desde la
  // 051 `balance_due` ya resta `credited_total`— y no es una cuenta por cobrar.
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
 * 074: SALDOS A FAVOR de clientes (lo que un cobro dejó sin aplicar), en
 * NEGATIVO. El asiento del cobro acreditó 100004 por el TOTAL, así que el
 * excedente ya está en el mayor; si el auxiliar no lo restara, la antigüedad no
 * cuadraría contra 100004. Sólo cobros CONTABILIZADOS: uno sin asiento no movió
 * el mayor. Va en el tramo corriente (un saldo a favor no vence; P-5a de
 * Josuarth puede pedir una columna aparte).
 */
async function saldosAFavor(db: DB, tenantId: string): Promise<DocumentoPendiente[]> {
  const { data, error } = await db
    .from("payments")
    .select("id, payment_number, payment_date, amount_unapplied, client_id, clients!inner(id, name)")
    .eq("tenant_id", tenantId)
    .eq(DE_PRUEBA, false)
    .neq("status", "anulado")
    .gt("amount_unapplied", 0.005);
  if (error) {
    console.error("[finanzas/antiguedad] saldosAFavor failed", error);
    throw new Error("No se pudieron leer los saldos a favor");
  }
  type Fila = {
    id: string;
    payment_number: string | null;
    payment_date: string;
    amount_unapplied: number | string;
    client_id: string;
    clients: { id: string; name: string };
  };
  const filas = (data ?? []) as unknown as Fila[];
  if (filas.length === 0) return [];
  const { data: asientos } = await db
    .from("journal_entries")
    .select("source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", "pago")
    .in("source_id", filas.map((f) => f.id));
  const enElLibro = new Set(((asientos ?? []) as { source_id: string }[]).map((a) => a.source_id));
  return filas
    .filter((f) => enElLibro.has(f.id))
    .map((f) => ({
      id: f.id,
      numero: `${f.payment_number ?? "Cobro"} (saldo a favor)`,
      tercero: f.clients.name,
      terceroId: f.client_id,
      fechaReferencia: String(f.payment_date).slice(0, 10),
      diasVencido: 0,
      saldo: -round2(Number(f.amount_unapplied)),
      sourceType: "pago",
    }));
}

/**
 * E8 (`076`): las NOTAS DE CRÉDITO SIN DOCUMENTO son saldo a favor del tercero,
 * en NEGATIVO, igual que el excedente de un cobro. Su asiento ya acreditó
 * 100004 (venta) o debitó 200001 (compra) con el cliente o el proveedor, así
 * que sin restarlas acá la antigüedad no cuadraría contra el mayor. Lo que ya
 * se aplicó a una factura o compra ya bajó el saldo de ese documento y no se
 * vuelve a restar. Sólo las que están en el libro.
 */
async function saldosAFavorDeNotas(db: DB, tenantId: string, tipo: TipoAntiguedad): Promise<DocumentoPendiente[]> {
  const venta = tipo === "cobrar";
  const { data, error } = venta
    ? await db
        .from("credit_notes")
        .select("id, credit_note_number, accounting_date, grand_total, client_id, clients!inner(name)")
        .eq("tenant_id", tenantId)
        .eq(DE_PRUEBA, false)
        .eq("status", "emitida")
        .is("invoice_id", null)
    : await db
        .from("supplier_credit_notes")
        .select("id, credit_note_number, issue_date, grand_total, supplier_id, suppliers!inner(legal_name, trade_name)")
        .eq("tenant_id", tenantId)
        .eq("status", "emitida")
        .is("business_expense_id", null);
  if (error) {
    console.error("[finanzas/antiguedad] saldosAFavorDeNotas failed", error);
    throw new Error("No se pudieron leer las notas de crédito con saldo a favor");
  }
  const filas = (data ?? []) as unknown as Record<string, unknown>[];
  if (filas.length === 0) return [];
  const ids = filas.map((f) => String(f.id));

  const [{ data: apps }, { data: asientos }] = await Promise.all([
    db
      .from(venta ? "credit_note_applications" : "supplier_credit_note_applications")
      .select("credit_note_id, amount_applied")
      .eq("tenant_id", tenantId)
      .in("credit_note_id", ids),
    db
      .from("journal_entries")
      .select("source_id")
      .eq("tenant_id", tenantId)
      .eq("source_type", venta ? "nota_credito" : "nota_credito_proveedor")
      .in("source_id", ids),
  ]);
  const aplicado = new Map<string, number>();
  for (const a of (apps ?? []) as { credit_note_id: string; amount_applied: number | string }[]) {
    aplicado.set(a.credit_note_id, (aplicado.get(a.credit_note_id) ?? 0) + Number(a.amount_applied));
  }
  const enElLibro = new Set(((asientos ?? []) as { source_id: string }[]).map((x) => x.source_id));

  const partidas: DocumentoPendiente[] = [];
  for (const f of filas) {
    const id = String(f.id);
    if (!enElLibro.has(id)) continue;
    const saldo = round2(Number(f.grand_total) - (aplicado.get(id) ?? 0));
    if (saldo <= 0.005) continue;
    const crudo = (venta ? f.clients : f.suppliers) as unknown;
    const t = (Array.isArray(crudo) ? crudo[0] : crudo) as
      | { name?: string; legal_name?: string; trade_name?: string | null }
      | null
      | undefined;
    partidas.push({
      id,
      numero: `${f.credit_note_number} (saldo a favor)`,
      tercero: venta ? t?.name ?? "" : t?.trade_name?.trim() || t?.legal_name || "",
      terceroId: String(venta ? f.client_id : f.supplier_id),
      fechaReferencia: String(venta ? f.accounting_date : f.issue_date).slice(0, 10),
      diasVencido: 0,
      saldo: -saldo,
      sourceType: venta ? "nota_credito" : "nota_credito_proveedor",
    });
  }
  return partidas;
}

/**
 * Gastos del bufete pendientes de pago.
 *
 * Agrupa por `supplier_id` —la ficha del proveedor— y cuenta la antigüedad desde
 * `due_date`. Los dos campos llegaron con la migración 033; ver el encabezado.
 */
async function gastosPendientes(db: DB, tenantId: string): Promise<DocumentoPendiente[]> {
  // Desde la 048 una compra puede estar PARCIALMENTE pagada: el saldo es
  // `total − amount_paid`, no el total, y entran las dos que no están `pagado`.
  const { data, error } = await db
    .from("business_expenses")
    .select("id, supplier_id, supplier_name, description, expense_date, due_date, total, amount_paid, balance_due")
    .eq("tenant_id", tenantId)
    .neq("status", "pagado")
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
    amount_paid: number | string;
    balance_due: number | string;
  };

  // `balance_due` (066): total − pagado − acreditado por NC del proveedor.
  const saldoDe = (g: Fila) => round2(Number(g.balance_due));
  const filas = ((data ?? []) as unknown as Fila[]).filter((g) => saldoDe(g) > 0.005);

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
      saldo: saldoDe(g),
      sourceType: "gasto",
    };
  });
}

/**
 * Gastos de TRÁMITE pendientes de pago (Bloque 4, FND-010).
 *
 * Un gasto de trámite acredita 200001 al registrarse (DEBE 130003 / HABER
 * cuentas por pagar, decisión de RM del 25/08) igual que una compra, así que
 * es una cuenta por pagar y entra al auxiliar. Hasta el 21/09 no entraba, y por
 * eso la antigüedad no cuadraba contra el mayor (FND-010).
 *
 * 🔴 SOLO los que están EN EL LIBRO (`posted_entry_id`). Los anteriores al
 * posteo automático nacieron sin asiento y nadie sabe si se pagaron: no están
 * en 200001, así que tampoco entran acá. Aparecen cuando se registran en el
 * libro (botón de reintento en /finanzas/gastos-tramite/{id}), y entonces sí
 * cuadran. Contarlos sin asiento sería inventar una deuda que el mayor no tiene.
 *
 * El saldo es `amount − amount_paid` (049); `pagado` y `anulado` no entran.
 */
async function gastosTramitePendientes(db: DB, tenantId: string): Promise<DocumentoPendiente[]> {
  const { data, error } = await db
    .from("expenses")
    .select("id, supplier_id, concept, date, due_date, amount, amount_paid, status, posted_entry_id")
    .eq("tenant_id", tenantId)
    .eq(DE_PRUEBA, false)
    .not("posted_entry_id", "is", null)
    .in("status", ["pendiente_pago", "parcialmente_pagado"])
    .order("due_date");

  if (error) {
    console.error("[finanzas/antiguedad] gastosTramitePendientes failed", error);
    throw new Error("No se pudieron leer los gastos de trámite pendientes");
  }

  type Fila = {
    id: string;
    supplier_id: string | null;
    concept: string | null;
    date: string;
    due_date: string | null;
    amount: number | string;
    amount_paid: number | string;
  };
  const saldoDe = (g: Fila) => round2(Number(g.amount) - Number(g.amount_paid ?? 0));
  const filas = ((data ?? []) as unknown as Fila[]).filter((g) => saldoDe(g) > 0.005);

  const ids = Array.from(new Set(filas.map((g) => g.supplier_id).filter((v): v is string => !!v)));
  const nombres = new Map<string, string>();
  if (ids.length > 0) {
    const { data: provs } = await db
      .from("suppliers")
      .select("id, legal_name, trade_name")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    for (const p of (provs ?? []) as { id: string; legal_name: string; trade_name: string | null }[]) {
      nombres.set(p.id, p.trade_name?.trim() || p.legal_name);
    }
  }

  return filas.map((g) => {
    const referencia = String(g.due_date ?? g.date).slice(0, 10);
    return {
      id: g.id,
      numero: g.concept?.trim() || "(sin concepto)",
      // Sin ficha no hay texto libre en `expenses` (D2): va "(sin proveedor)".
      tercero: (g.supplier_id ? nombres.get(g.supplier_id) : undefined) ?? "(sin proveedor)",
      terceroId: g.supplier_id,
      fechaReferencia: referencia,
      diasVencido: diasDesde(referencia),
      saldo: saldoDe(g),
      sourceType: "gasto_tramite",
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
    .eq(DE_PRUEBA, false)
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
 * CxP: gastos del auxiliar sin asiento, y PAGOS sin asiento.
 *
 * Desde la 048 el pago a proveedor es una entidad (`supplier_payments`), así
 * que esto es simétrico con `sinAsientoCobrar`: un pago `registrado` sin
 * asiento `pago_proveedor` ya se descontó del auxiliar y no del mayor. Más
 * simple que el lado cobrar porque no hay N:M: un pago es de UNA compra.
 *
 * Los SALDOS HEREDADOS (`kind = 'migrated_balance'`) son, por definición,
 * pagos sin asiento: la compra estaba `pagado` antes de que existieran los
 * pagos, y en el mayor nunca hubo asiento de pago. Entran en el mismo término
 * (bajan el auxiliar, no el mayor) pero se cuentan aparte para que la pantalla
 * los nombre como lo que son y no como "pagos que faltan cablear".
 */
async function sinAsientoPagar(db: DB, tenantId: string): Promise<SinAsiento> {
  const [conAsientoGasto, conAsientoPago] = await Promise.all([
    idsConAsiento(db, tenantId, "gasto"),
    idsConAsiento(db, tenantId, "pago_proveedor"),
  ]);

  const { data } = await db
    .from("business_expenses")
    .select("id, balance_due")
    .eq("tenant_id", tenantId)
    .neq("status", "pagado");

  const documentos = { cantidad: 0, monto: 0 };
  for (const g of (data ?? []) as { id: string; balance_due: number | string }[]) {
    const saldo = Number(g.balance_due);
    if (saldo > 0.005 && !conAsientoGasto.has(g.id)) {
      documentos.cantidad += 1;
      documentos.monto += saldo;
    }
  }

  const { data: pagos } = await db
    .from("supplier_payments")
    .select("id, amount, kind")
    .eq("tenant_id", tenantId)
    .eq("status", "registrado");

  const cobros = { cantidad: 0, monto: 0 };
  const heredados = { cantidad: 0, monto: 0 };
  for (const p of (pagos ?? []) as { id: string; amount: number | string; kind: string }[]) {
    if (conAsientoPago.has(p.id)) continue;
    const monto = Number(p.amount);
    cobros.cantidad += 1;
    cobros.monto += monto;
    if (p.kind === "migrated_balance") {
      heredados.cantidad += 1;
      heredados.monto += monto;
    }
  }

  return {
    documentos: { cantidad: documentos.cantidad, monto: round2(documentos.monto) },
    cobros: { cantidad: cobros.cantidad, monto: round2(cobros.monto) },
    heredados: { cantidad: heredados.cantidad, monto: round2(heredados.monto) },
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
  const [documentosDeModulo, controlCrudo, base, diario] = await Promise.all([
    tipo === "cobrar"
      ? // 074: las facturas pendientes MÁS los saldos a favor, en negativo.
        //     E8: y las NC sin factura, también en negativo.
        Promise.all([facturasPendientes(db, tenantId), saldosAFavor(db, tenantId), saldosAFavorDeNotas(db, tenantId, "cobrar")]).then(
          ([a, b, c]) => [...a, ...b, ...c]
        )
      : // Compras del bufete + gastos de trámite EN EL LIBRO (FND-010), y las
        // NC de proveedor sin compra en negativo (E8).
        Promise.all([gastosPendientes(db, tenantId), gastosTramitePendientes(db, tenantId), saldosAFavorDeNotas(db, tenantId, "pagar")]).then(
          ([a, b, c]) => [...a, ...b, ...c]
        ),
    saldoDeCuentaControl(db, tenantId, CUENTA_CONTROL[tipo]),
    tipo === "cobrar" ? sinAsientoCobrar(db, tenantId) : sinAsientoPagar(db, tenantId),
    lineasDeDiarioContraControl(db, tenantId, CUENTA_CONTROL[tipo]),
  ]);

  // E9: las partidas de diario y de apertura CON tercero son saldo de ese
  // tercero; las que no lo tienen siguen explicando la diferencia (D5).
  const documentos = [...documentosDeModulo, ...partidasDeDiario(diario.lineas, tipo, diario.reversados)];
  const sinAsiento: SinAsiento = {
    ...base,
    manuales: manualesSinTercero(diario.lineas, tipo, diario.reversados),
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

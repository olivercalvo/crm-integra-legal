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
  ConteoConTerceros,
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
 * ASIENTOS MANUALES contra la cuenta control (D5, Bloque 7).
 *
 * Mueven el mayor y no el auxiliar, así que son una de las causas de la
 * diferencia — y hasta hoy caían en el residuo anónimo. Se miden acá y se
 * nombran en pantalla; **no entran en los tramos**: un asiento manual no tiene
 * vencimiento.
 *
 * `source_type = 'manual'` a propósito y no "todo lo que no sea un documento":
 * una `reversion` o el asiento de `apertura` son otra cosa y tienen su propia
 * explicación.
 *
 * El signo: para COBRAR (activo) un débito sube el mayor y sube la diferencia;
 * para PAGAR el auxiliar se compara en valor absoluto contra un saldo acreedor,
 * así que el efecto se invierte. Se devuelve ya con el signo que corresponde.
 */
async function manualesContraControl(
  db: DB,
  tenantId: string,
  code: string,
  tipo: TipoAntiguedad
): Promise<ConteoConTerceros> {
  const { data: cuenta } = await db
    .from("chart_of_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();
  if (!cuenta) return { cantidad: 0, monto: 0, terceros: [] };

  const { data, error } = await db
    .from("journal_entry_lines")
    .select(
      "entry_id, debit, credit, clients(name), suppliers(legal_name), " +
        "journal_entries!inner(source_type)"
    )
    .eq("tenant_id", tenantId)
    .eq("account_id", (cuenta as { id: string }).id)
    .eq("journal_entries.source_type", "manual");

  if (error) {
    console.error("[finanzas/antiguedad] manualesContraControl failed", error);
    return { cantidad: 0, monto: 0, terceros: [] };
  }

  type Fila = {
    entry_id: string;
    debit: number | string;
    credit: number | string;
    clients: { name: string } | null;
    suppliers: { legal_name: string } | null;
  };
  const filas = (data ?? []) as unknown as Fila[];
  const asientos = new Set<string>();
  const terceros = new Set<string>();
  let neto = 0;
  for (const f of filas) {
    asientos.add(f.entry_id);
    neto += Number(f.debit ?? 0) - Number(f.credit ?? 0);
    const nombre = f.clients?.name ?? f.suppliers?.legal_name;
    if (nombre) terceros.add(nombre);
  }

  return {
    cantidad: asientos.size,
    monto: round2(tipo === "pagar" ? -neto : neto),
    terceros: Array.from(terceros).sort((a, b) => a.localeCompare(b, "es")),
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

/**
 * Las tres piezas de `porCablear` juntas: documentos sin asiento, cobros o
 * pagos sin asiento, y los asientos manuales contra la cuenta control (D5).
 */
async function sinAsientoConManuales(
  db: DB,
  tenantId: string,
  tipo: TipoAntiguedad
): Promise<SinAsiento> {
  const [base, manuales] = await Promise.all([
    tipo === "cobrar" ? sinAsientoCobrar(db, tenantId) : sinAsientoPagar(db, tenantId),
    manualesContraControl(db, tenantId, CUENTA_CONTROL[tipo], tipo),
  ]);
  return { ...base, manuales };
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
    tipo === "cobrar"
      ? facturasPendientes(db, tenantId)
      : // Compras del bufete + gastos de trámite EN EL LIBRO (FND-010).
        Promise.all([gastosPendientes(db, tenantId), gastosTramitePendientes(db, tenantId)]).then(
          ([a, b]) => [...a, ...b]
        ),
    saldoDeCuentaControl(db, tenantId, CUENTA_CONTROL[tipo]),
    sinAsientoConManuales(db, tenantId, tipo),
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

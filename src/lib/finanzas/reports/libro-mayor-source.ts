/**
 * FUENTE DE DATOS del Libro Mayor.
 *
 * Lee el ledger (`journal_entry_lines` + `journal_entries`) y arma los
 * `MovimientoCrudo` que consume `libro-mayor.ts`. Es el único archivo de este
 * reporte que toca la BD.
 *
 * ⚠️ EL MAYOR LEE DEL LEDGER; LOS REPORTES TODAVÍA NO.
 * `accounting-source.ts` sigue calculando el saldo de cada cuenta como
 * `saldo_inicial` a secas, sin sumar movimientos. O sea que hoy el Balance
 * General y el Estado de Resultado NO incluyen lo que muestra este mayor.
 *
 * No es un descuido: cambiar `accounting-source.ts` haría que los reportes de
 * staging dejaran de coincidir con el Excel de Josuar, que es justamente el
 * baseline contra el que RM va a validar. El cambio pertenece al mismo bloque
 * que el cableado factura→asiento, después de esa validación.
 *
 * Mientras tanto, el mayor lo dice en pantalla y la fila "Saldo inicial" deja
 * ver de dónde arranca: el número que muestra el Balance es exactamente ese.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { RUTA_DEL_DOCUMENTO } from "@/lib/finanzas/reports/destino-documento";
import type {
  CuentaDelMayor,
  LineaHermana,
  MovimientoCrudo,
} from "@/lib/finanzas/reports/libro-mayor";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

type DB = SupabaseClient;

export interface RangoFechas {
  /** ISO YYYY-MM-DD, inclusive. */
  desde?: string | null;
  /** ISO YYYY-MM-DD, inclusive. */
  hasta?: string | null;
}

/**
 * La cuenta cuyo mayor se va a mostrar. null si no existe o no es del tenant.
 *
 * Si viene `rango.desde`, además calcula el SALDO DE ARRANQUE: el saldo de
 * apertura más todos los movimientos anteriores a esa fecha. Sin eso, pedir el
 * mayor desde junio mostraba el saldo de enero en la primera fila y el saldo
 * corrido quedaba desplazado de punta a punta — el error más visible que se
 * puede cometer en un mayor, y el primero que un contador nota.
 */
export async function loadCuentaDelMayor(
  db: DB,
  tenantId: string,
  code: string,
  rango: RangoFechas = {}
): Promise<CuentaDelMayor | null> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("id, code, name, account_type, saldo_inicial, saldo_inicial_fecha")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/mayor] loadCuentaDelMayor failed", error);
    return null;
  }
  if (!data) return null;

  const r = data as Record<string, unknown>;
  const saldoInicial = Number(r.saldo_inicial ?? 0);
  const saldoInicialFecha = (r.saldo_inicial_fecha as string | null) ?? null;

  const previos = rango.desde
    ? await sumaMovimientosAnteriores(db, tenantId, r.id as string, rango.desde)
    : 0;

  return {
    code: r.code as string,
    name: r.name as string,
    account_type: r.account_type as AccountType,
    saldo_inicial: saldoInicial,
    saldo_inicial_fecha: saldoInicialFecha,
    saldo_arranque: round2(saldoInicial + previos),
    arranque_fecha: rango.desde ?? saldoInicialFecha,
    arranque_ajustado: previos !== 0,
  };
}

/**
 * Neto (débitos − créditos) de los movimientos ANTERIORES a `desde`.
 *
 * Se trae solo `debit`/`credit` y se suma acá: PostgREST no agrega, y montar un
 * RPC para esto sería una función de base más para mantener. Son las líneas de
 * una cuenta antes de una fecha — decenas, no millones.
 */
async function sumaMovimientosAnteriores(
  db: DB,
  tenantId: string,
  accountId: string,
  desde: string
): Promise<number> {
  const { data, error } = await db
    .from("journal_entry_lines")
    .select("debit, credit, journal_entries!inner(transaction_date)")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId)
    .lt("journal_entries.transaction_date", desde);

  if (error) {
    console.error("[finanzas/mayor] sumaMovimientosAnteriores failed", error);
    // Devolver 0 en silencio mostraría el saldo de apertura como si fuera el del
    // rango, que es justo el error que esta función existe para evitar.
    throw new Error("No se pudo calcular el saldo anterior al rango de fechas");
  }

  let neto = 0;
  for (const fila of (data ?? []) as { debit: number | string; credit: number | string }[]) {
    neto += Number(fila.debit) - Number(fila.credit);
  }
  return round2(neto);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Mapa code → cuenta_control, para deducir el nombre del tercero. */
export async function loadCuentasControl(
  db: DB,
  tenantId: string
): Promise<Record<string, string | null>> {
  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, cuenta_control")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[finanzas/mayor] loadCuentasControl failed", error);
    return {};
  }
  const mapa: Record<string, string | null> = {};
  for (const row of data ?? []) {
    const r = row as { code: string; cuenta_control: string | null };
    mapa[r.code] = r.cuenta_control ?? null;
  }
  return mapa;
}

/**
 * Movimientos de una cuenta en un rango de fechas.
 *
 * Se hace en DOS consultas y no en un join gigante:
 *   1. Las líneas de ESA cuenta (con su asiento), para saber qué asientos tocar.
 *   2. TODAS las líneas de esos asientos, que hacen falta para resolver la
 *      contrapartida — que por definición está en las OTRAS líneas.
 *
 * Un solo join no serviría: filtrar por cuenta se lleva puestas justamente las
 * líneas hermanas que necesitamos.
 */
export async function loadMovimientosDeCuenta(
  db: DB,
  tenantId: string,
  code: string,
  rango: RangoFechas = {}
): Promise<MovimientoCrudo[]> {
  // -- id de la cuenta --------------------------------------------------------
  const { data: cuenta } = await db
    .from("chart_of_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();
  if (!cuenta) return [];
  const accountId = (cuenta as { id: string }).id;

  // -- 1) líneas de esta cuenta ----------------------------------------------
  let q = db
    .from("journal_entry_lines")
    .select(
      "id, entry_id, line_order, debit, credit, line_description, " +
        "journal_entries!inner(id, entry_number, transaction_date, description, source_type, source_id)"
    )
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId);

  if (rango.desde) q = q.gte("journal_entries.transaction_date", rango.desde);
  if (rango.hasta) q = q.lte("journal_entries.transaction_date", rango.hasta);

  const { data: propias, error } = await q;
  if (error) {
    console.error("[finanzas/mayor] loadMovimientosDeCuenta failed", error);
    throw new Error("No se pudieron leer los movimientos de la cuenta");
  }
  if (!propias || propias.length === 0) return [];

  type FilaPropia = {
    entry_id: string;
    line_order: number;
    debit: number | string;
    credit: number | string;
    line_description: string | null;
    journal_entries: {
      entry_number: number;
      transaction_date: string;
      description: string;
      source_type: string;
      source_id: string | null;
    };
  };
  const filas = propias as unknown as FilaPropia[];
  const entryIds = Array.from(new Set(filas.map((f) => f.entry_id)));

  // -- 2) TODAS las líneas de esos asientos (para la contrapartida) -----------
  const { data: todas, error: errTodas } = await db
    .from("journal_entry_lines")
    .select(
      "entry_id, line_order, debit, credit, line_description, chart_of_accounts!inner(code, name)"
    )
    .eq("tenant_id", tenantId)
    .in("entry_id", entryIds);

  if (errTodas) {
    console.error("[finanzas/mayor] hermanas failed", errTodas);
    throw new Error("No se pudieron leer las contrapartidas");
  }

  type FilaHermana = {
    entry_id: string;
    line_order: number;
    debit: number | string;
    credit: number | string;
    line_description: string | null;
    chart_of_accounts: { code: string; name: string };
  };

  const porAsiento = new Map<string, LineaHermana[]>();
  for (const row of (todas ?? []) as unknown as FilaHermana[]) {
    const lista = porAsiento.get(row.entry_id) ?? [];
    lista.push({
      code: row.chart_of_accounts.code,
      name: row.chart_of_accounts.name,
      debit: Number(row.debit ?? 0),
      credit: Number(row.credit ?? 0),
      line_order: row.line_order,
      descripcion: row.line_description,
    });
    porAsiento.set(row.entry_id, lista);
  }

  const cuentaInfo = await loadCuentaDelMayor(db, tenantId, code);

  return filas.map((f) => ({
    entry_id: f.entry_id,
    entry_number: f.journal_entries.entry_number,
    transaction_date: f.journal_entries.transaction_date,
    source_type: f.journal_entries.source_type,
    source_id: f.journal_entries.source_id,
    entry_description: f.journal_entries.description,
    line_description: f.line_description,
    line_order: f.line_order,
    debit: Number(f.debit ?? 0),
    credit: Number(f.credit ?? 0),
    account_code: code,
    account_name: cuentaInfo?.name ?? code,
    account_type: (cuentaInfo?.account_type ?? "asset") as AccountType,
    hermanas: porAsiento.get(f.entry_id) ?? [],
  }));
}

/** Cuentas que tienen al menos un movimiento, para el selector del mayor. */
export async function loadCuentasConMovimiento(
  db: DB,
  tenantId: string
): Promise<string[]> {
  const { data, error } = await db
    .from("journal_entry_lines")
    .select("chart_of_accounts!inner(code)")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[finanzas/mayor] loadCuentasConMovimiento failed", error);
    return [];
  }
  const codes = new Set<string>();
  for (const row of (data ?? []) as unknown as { chart_of_accounts: { code: string } }[]) {
    codes.add(row.chart_of_accounts.code);
  }
  return Array.from(codes).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/**
 * A DÓNDE lleva cada movimiento: `source_id` → ruta del documento que lo originó.
 *
 * TRAZABILIDAD NIVEL 2. Devuelve un mapa y no un set de "existe / no existe"
 * por una razón concreta: el destino de un PAGO no se puede deducir de su
 * `source_id`. Los pagos no tienen pantalla propia —viven dentro del detalle de
 * la factura— así que hay que preguntar a qué factura se aplicó. Eso es una
 * consulta, y las consultas van acá, no en el componente.
 *
 * Un movimiento que no está en el mapa se muestra SIN enlace. Se llega a eso
 * por cuatro caminos, y los cuatro son correctos:
 *
 *   · el asiento no tiene `source_id` (asiento de diario: su origen es él mismo)
 *   · el `source_type` no tiene pantalla de destino (apertura, reversión)
 *   · el documento NO EXISTE — fue un id sintético, o se borró después. El
 *     asiento es inmutable y no se puede corregir, así que hay que preguntar
 *   · el destino es ambiguo (un pago aplicado a varias facturas)
 *
 * Un enlace que lleva a una pantalla vacía es peor que no tener enlace: hace
 * dudar del reporte entero. Ante la duda, no se enlaza.
 */
export async function loadDestinosDeOrigen(
  db: DB,
  tenantId: string,
  movimientos: { source_type: string; source_id: string | null }[]
): Promise<Map<string, string>> {
  const destinos = new Map<string, string>();

  /**
   * Tipos que se resuelven mirando UNA tabla y llevan a UNA ruta directa.
   *
   * Las RUTAS no se escriben acá: vienen de `destino-documento.ts`, que las
   * exporta para que `nav-guard.test.ts` pueda verificar que cada rol que ve el
   * reporte pueda abrirlas. Acá se dice en qué tabla se comprueba que el
   * documento exista; a dónde lleva lo dice el otro módulo.
   */
  const DIRECTOS: Record<string, { tabla: string; ruta: (id: string) => string }> = {
    factura: { tabla: "invoices", ruta: RUTA_DEL_DOCUMENTO.factura },
    nota_credito: { tabla: "invoices", ruta: RUTA_DEL_DOCUMENTO.nota_credito },
    gasto: { tabla: "business_expenses", ruta: RUTA_DEL_DOCUMENTO.gasto },
  };

  const idsPorTipo = new Map<string, Set<string>>();
  for (const m of movimientos) {
    if (!m.source_id) continue;
    const set = idsPorTipo.get(m.source_type) ?? new Set<string>();
    set.add(m.source_id);
    idsPorTipo.set(m.source_type, set);
  }

  // -- tipos directos --------------------------------------------------------
  for (const [tipo, { tabla, ruta }] of Object.entries(DIRECTOS)) {
    const ids = idsPorTipo.get(tipo);
    if (!ids || ids.size === 0) continue;

    const { data, error } = await db
      .from(tabla)
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", Array.from(ids));
    if (error) {
      console.error(`[finanzas/mayor] loadDestinosDeOrigen(${tabla}) failed`, error);
      continue;
    }
    for (const row of (data ?? []) as { id: string }[]) {
      destinos.set(row.id, ruta(row.id));
    }
  }

  // -- pagos: el destino es la factura que cancelaron ------------------------
  const idsPago = idsPorTipo.get("pago");
  if (idsPago && idsPago.size > 0) {
    const { data, error } = await db
      .from("payment_applications")
      .select("payment_id, invoice_id")
      .eq("tenant_id", tenantId)
      .in("payment_id", Array.from(idsPago));

    if (error) {
      console.error("[finanzas/mayor] loadDestinosDeOrigen(payment_applications) failed", error);
    } else {
      // Un pago aplicado a VARIAS facturas no tiene un destino único, así que
      // se queda sin enlace en vez de elegir una arbitrariamente.
      const facturasPorPago = new Map<string, Set<string>>();
      for (const row of (data ?? []) as { payment_id: string; invoice_id: string }[]) {
        const set = facturasPorPago.get(row.payment_id) ?? new Set<string>();
        set.add(row.invoice_id);
        facturasPorPago.set(row.payment_id, set);
      }
      for (const [pagoId, facturas] of Array.from(facturasPorPago.entries())) {
        if (facturas.size !== 1) continue;
        destinos.set(pagoId, RUTA_DEL_DOCUMENTO.pago(Array.from(facturas)[0]));
      }
    }
  }

  return destinos;
}

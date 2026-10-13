/**
 * ASIGNACIONES EN LOTE para contabilizar los documentos existentes (07/10/2026).
 *
 * En producción, los documentos desde el inicio contable hasta la ventana no
 * se pueden contabilizar como están: ningún gasto de trámite tiene proveedor
 * (la 049 agregó la columna vacía), sus líneas nacieron sin cuenta (036) y
 * ningún cobro tiene banco (041). Acá se completan, varios a la vez:
 *
 *   · gasto de trámite SIN asiento → proveedor (por gasto) y cuenta (por línea);
 *   · cobro SIN asiento → banco.
 *
 * 🔴 Un documento que ya tiene asiento NO se toca: el dato entró al libro y
 *    cambiarlo dejaría el documento diciendo una cosa y el asiento otra. Se
 *    verifica todo el lote ANTES de escribir; si uno no se puede, no se escribe
 *    ninguno y el mensaje los nombra. La base lo vuelve a exigir (las líneas de
 *    un gasto asentado son inmutables por la 038; el banco de un cobro
 *    asentado, por la 099).
 * Tampoco se tocan los documentos de prueba ni los anteriores al inicio
 * contable (están contabilizados fuera: nunca entran al libro).
 *
 * Quién: admin y contador (Oliver, 07/10). La bitácora contable lo registra
 * sola (triggers de la 087: `expenses.supplier_id`, `expense_lines` y
 * `payments` van a la contable), con el usuario que viaja en el cliente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { cargarInicioContable, fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { motivoDeRechazo } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import { esCuentaDeBancoValida } from "@/lib/finanzas/contabilidad/asiento-tesoreria";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

type DB = SupabaseClient;

/** Tope de un lote: los 85 gastos y 8 cobros de producción entran de sobra. */
export const MAX_POR_LOTE = 500;

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

export interface LineaSinAsiento {
  id: string;
  descripcion: string;
  monto: number;
  cuenta: string | null;
}

export interface GastoSinAsiento {
  id: string;
  fecha: string;
  numero: string | null;
  concepto: string;
  monto: number;
  /** Del caso, SÓLO el número (el contador no entra a Legal). */
  caso: string | null;
  proveedorId: string | null;
  proveedor: string | null;
  lineas: LineaSinAsiento[];
}

export interface CobroSinAsiento {
  id: string;
  fecha: string;
  numero: string;
  cliente: string;
  monto: number;
  banco: string | null;
}

async function idsConAsiento(db: DB, tenantId: string, sourceType: string, ids: string[]): Promise<Set<string>> {
  const con = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("journal_entries")
      .select("source_id")
      .eq("tenant_id", tenantId)
      .eq("source_type", sourceType)
      .in("source_id", ids.slice(i, i + 200));
    if (error) throw new MutationError("No se pudo verificar qué documentos ya están en el libro contable.", 500, error);
    for (const r of (data ?? []) as { source_id: string }[]) con.add(r.source_id);
  }
  return con;
}

/** Los gastos de trámite del período, sin asiento, con sus líneas. */
export async function listarGastosSinAsiento(db: DB, tenantId: string, desde: string, hasta: string): Promise<GastoSinAsiento[]> {
  const inicio = await cargarInicioContable(db, tenantId);
  const { data, error } = await db
    .from("expenses")
    .select("id, date, accounting_date, concept, amount, purchase_number, supplier_id, status, de_prueba, posted_entry_id, cases(case_number), suppliers(legal_name, supplier_number)")
    .eq("tenant_id", tenantId)
    .is("posted_entry_id", null)
    .eq("de_prueba", false)
    .gte("date", inicio)
    .gte("accounting_date", desde)
    .lte("accounting_date", hasta)
    .order("accounting_date")
    .limit(2000);
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  type Fila = {
    id: string; date: string; accounting_date: string | null; concept: string; amount: number; purchase_number: string | null;
    supplier_id: string | null; status: string | null; cases: { case_number: number | string | null } | null;
    suppliers: { legal_name: string; supplier_number: string | null } | null;
  };
  const filas = ((data ?? []) as unknown as Fila[]).filter((g) => g.status !== "anulado");
  const con = await idsConAsiento(db, tenantId, "gasto_tramite", filas.map((g) => g.id));
  const vivos = filas.filter((g) => !con.has(g.id));

  const lineas = new Map<string, LineaSinAsiento[]>();
  for (let i = 0; i < vivos.length; i += 200) {
    const { data: ls, error: errL } = await db
      .from("expense_lines")
      .select("id, expense_id, line_order, description, amount, chart_account_code")
      .eq("tenant_id", tenantId)
      .in("expense_id", vivos.slice(i, i + 200).map((g) => g.id))
      .order("line_order");
    if (errL) throw new MutationError(pgErrorToMessage(errL), 500, errL);
    for (const l of (ls ?? []) as { id: string; expense_id: string; description: string; amount: number; chart_account_code: string | null }[]) {
      const arr = lineas.get(l.expense_id) ?? [];
      arr.push({ id: l.id, descripcion: l.description, monto: Number(l.amount), cuenta: l.chart_account_code });
      lineas.set(l.expense_id, arr);
    }
  }
  return vivos.map((g) => ({
    id: g.id,
    fecha: String(g.accounting_date ?? g.date).slice(0, 10),
    numero: g.purchase_number,
    concepto: g.concept,
    monto: Number(g.amount),
    caso: g.cases?.case_number != null ? String(g.cases.case_number) : null,
    proveedorId: g.supplier_id,
    proveedor: g.suppliers ? `${g.suppliers.legal_name}${g.suppliers.supplier_number ? ` (${g.suppliers.supplier_number})` : ""}` : null,
    lineas: lineas.get(g.id) ?? [],
  }));
}

/** Los cobros del período, sin asiento. */
export async function listarCobrosSinAsiento(db: DB, tenantId: string, desde: string, hasta: string): Promise<CobroSinAsiento[]> {
  const inicio = await cargarInicioContable(db, tenantId);
  const { data, error } = await db
    .from("payments")
    .select("id, payment_number, reference, payment_date, amount, payment_account_code, status, de_prueba, clients(name, client_number)")
    .eq("tenant_id", tenantId)
    .eq("status", "registrado")
    .eq("de_prueba", false)
    .gte("payment_date", inicio > desde ? inicio : desde)
    .lte("payment_date", hasta)
    .order("payment_date")
    .limit(2000);
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  type Fila = {
    id: string; payment_number: string | null; reference: string | null; payment_date: string; amount: number;
    payment_account_code: string | null; clients: { name: string; client_number: string | null } | null;
  };
  const filas = (data ?? []) as unknown as Fila[];
  const con = await idsConAsiento(db, tenantId, "pago", filas.map((c) => c.id));
  return filas
    .filter((c) => !con.has(c.id))
    .map((c) => ({
      id: c.id,
      fecha: String(c.payment_date).slice(0, 10),
      numero: c.payment_number ?? c.reference ?? c.id.slice(0, 8),
      cliente: c.clients ? `${c.clients.name}${c.clients.client_number ? ` (${c.clients.client_number})` : ""}` : "",
      monto: Number(c.amount),
      banco: c.payment_account_code,
    }));
}

// ---------------------------------------------------------------------------
// Validación del lote (pura)
// ---------------------------------------------------------------------------

export interface DocumentoDelLote {
  id: string;
  numero: string;
  fecha: string;
  conAsiento: boolean;
  dePrueba: boolean;
  /** Para los gastos: anulado. Para los cobros: estado distinto de registrado. */
  inactivo?: string | null;
}

/**
 * Por qué no se puede tocar cada documento del lote. Vacío = se puede todo.
 * Un id que no está en `encontrados` es de otro bufete o no existe.
 */
export function rechazosDelLote(ids: string[], encontrados: DocumentoDelLote[], inicio: string): string[] {
  const porId = new Map(encontrados.map((d) => [d.id, d]));
  const out: string[] = [];
  for (const id of ids) {
    const d = porId.get(id);
    if (!d) { out.push(`${id.slice(0, 8)}: no existe`); continue; }
    if (d.conAsiento) out.push(`${d.numero}: ya está en el libro contable y no se toca`);
    else if (d.dePrueba) out.push(`${d.numero}: es un documento de prueba`);
    else if (d.fecha < inicio) out.push(`${d.numero}: es anterior al inicio contable (${fechaCorta(inicio)}), está contabilizado fuera`);
    else if (d.inactivo) out.push(`${d.numero}: ${d.inactivo}`);
  }
  return out;
}

function validarIds(raw: unknown, que: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))) {
    throw new MutationError(`Marca al menos un ${que}.`, 400);
  }
  const ids = Array.from(new Set(raw as string[]));
  if (ids.length > MAX_POR_LOTE) throw new MutationError(`Son más de ${MAX_POR_LOTE} a la vez: hazlo en partes.`, 400);
  return ids;
}

function noSePuede(rechazos: string[]): MutationError {
  return new MutationError(
    `No se cambió nada. ${rechazos.length === 1 ? "Un documento no se puede tocar" : `${rechazos.length} documentos no se pueden tocar`}: ` +
      rechazos.join("; ") + ".",
    409
  );
}

// ---------------------------------------------------------------------------
// Gasto de trámite: proveedor y cuenta por línea
// ---------------------------------------------------------------------------

export interface AsignacionDeGastos {
  /** Los gastos a los que se les pone el proveedor. */
  expense_ids?: unknown;
  supplier_id?: unknown;
  /** Las líneas a las que se les pone la cuenta. */
  line_ids?: unknown;
  chart_account_code?: unknown;
}

export async function asignarAGastos(db: DB, tenantId: string, body: AsignacionDeGastos) {
  const conProveedor = typeof body.supplier_id === "string" && body.supplier_id !== "";
  const conCuenta = typeof body.chart_account_code === "string" && body.chart_account_code.trim() !== "";
  if (!conProveedor && !conCuenta) throw new MutationError("Elige un proveedor o una cuenta para asignar.", 400);

  const expenseIds = conProveedor ? validarIds(body.expense_ids, "gasto de trámite") : [];
  const lineIds = conCuenta ? validarIds(body.line_ids, "línea de gasto") : [];

  // El proveedor: del bufete y activo.
  if (conProveedor) {
    const { data: prov } = await db
      .from("suppliers").select("id, active").eq("tenant_id", tenantId).eq("id", body.supplier_id as string).maybeSingle();
    if (!prov) throw new MutationError("El proveedor elegido no existe.", 400);
    if ((prov as { active: boolean }).active === false) throw new MutationError("El proveedor elegido está inactivo.", 400);
  }
  // La cuenta: la MISMA regla que la clasificación de una línea (`/api/expenses/lines/[id]`).
  const cuenta = conCuenta ? (body.chart_account_code as string).trim() : null;
  if (cuenta) {
    const { data: c } = await db
      .from("chart_of_accounts").select("code, name, active, account_type").eq("tenant_id", tenantId).eq("code", cuenta).maybeSingle();
    if (!c) throw new MutationError(`La cuenta ${cuenta} no existe en el plan de cuentas.`, 400);
    const fila = c as { code: string; name: string; active: boolean; account_type: AccountType };
    if (fila.active === false) throw new MutationError(`La cuenta ${cuenta} está inactiva.`, 400);
    const rechazo = motivoDeRechazo(fila);
    if (rechazo) throw new MutationError(rechazo, 400);
  }

  // Las líneas → sus gastos; todo el lote se verifica antes de escribir.
  let lineasDeGasto: { id: string; expense_id: string | null }[] = [];
  if (lineIds.length > 0) {
    const { data, error } = await db.from("expense_lines").select("id, expense_id").eq("tenant_id", tenantId).in("id", lineIds);
    if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
    lineasDeGasto = (data ?? []) as { id: string; expense_id: string | null }[];
    const faltan = lineIds.filter((id) => !lineasDeGasto.some((l) => l.id === id && l.expense_id));
    if (faltan.length > 0) throw new MutationError(`No se cambió nada: ${faltan.length} línea(s) no son de un gasto de trámite.`, 400);
  }
  const todos = Array.from(new Set([...expenseIds, ...lineasDeGasto.map((l) => l.expense_id as string)]));
  const { data: gastos, error: errG } = await db
    .from("expenses")
    .select("id, purchase_number, concept, date, de_prueba, status, posted_entry_id")
    .eq("tenant_id", tenantId)
    .in("id", todos);
  if (errG) throw new MutationError(pgErrorToMessage(errG), 500, errG);
  const filas = (gastos ?? []) as { id: string; purchase_number: string | null; concept: string; date: string; de_prueba: boolean; status: string | null; posted_entry_id: string | null }[];
  const con = await idsConAsiento(db, tenantId, "gasto_tramite", todos);
  const inicio = await cargarInicioContable(db, tenantId);
  const rechazos = rechazosDelLote(
    todos,
    filas.map((g) => ({
      id: g.id,
      numero: g.purchase_number ?? `gasto «${g.concept}»`,
      fecha: String(g.date).slice(0, 10),
      conAsiento: !!g.posted_entry_id || con.has(g.id),
      dePrueba: g.de_prueba,
      inactivo: g.status === "anulado" ? "está anulado" : null,
    })),
    inicio
  );
  if (rechazos.length > 0) throw noSePuede(rechazos);

  // Escribir: las cuentas y después el proveedor, siempre sobre documentos sin asiento.
  if (cuenta && lineIds.length > 0) {
    const { error } = await db.from("expense_lines").update({ chart_account_code: cuenta }).eq("tenant_id", tenantId).in("id", lineIds);
    if (error) throw new MutationError(`No se pudo asignar la cuenta: ${pgErrorToMessage(error)}`, 500, error);
  }
  if (conProveedor && expenseIds.length > 0) {
    const { error } = await db
      .from("expenses").update({ supplier_id: body.supplier_id as string })
      .eq("tenant_id", tenantId).in("id", expenseIds).is("posted_entry_id", null);
    if (error) throw new MutationError(`No se pudo asignar el proveedor: ${pgErrorToMessage(error)}`, 500, error);
  }
  return { gastos: expenseIds.length, lineas: lineIds.length };
}

// ---------------------------------------------------------------------------
// Cobro: banco
// ---------------------------------------------------------------------------

export async function asignarBancoACobros(db: DB, tenantId: string, body: { payment_ids?: unknown; payment_account_code?: unknown }) {
  const ids = validarIds(body.payment_ids, "cobro");
  const code = typeof body.payment_account_code === "string" ? body.payment_account_code.trim() : "";
  if (!code) throw new MutationError("Elige el banco.", 400);
  const { data: c } = await db
    .from("chart_of_accounts").select("code, name, active, account_type").eq("tenant_id", tenantId).eq("code", code).maybeSingle();
  if (!esCuentaDeBancoValida(c as never)) {
    throw new MutationError(`La cuenta ${code} no existe, está inactiva o no es una cuenta de activo: no puede recibir un cobro.`, 400);
  }

  const { data, error } = await db
    .from("payments")
    .select("id, payment_number, reference, payment_date, status, de_prueba")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  const filas = (data ?? []) as { id: string; payment_number: string | null; reference: string | null; payment_date: string; status: string; de_prueba: boolean }[];
  const con = await idsConAsiento(db, tenantId, "pago", ids);
  const inicio = await cargarInicioContable(db, tenantId);
  const rechazos = rechazosDelLote(
    ids,
    filas.map((p) => ({
      id: p.id,
      numero: p.payment_number ?? p.reference ?? p.id.slice(0, 8),
      fecha: String(p.payment_date).slice(0, 10),
      conAsiento: con.has(p.id),
      dePrueba: p.de_prueba,
      inactivo: p.status !== "registrado" ? `está ${p.status}` : null,
    })),
    inicio
  );
  if (rechazos.length > 0) throw noSePuede(rechazos);

  const { error: errU } = await db.from("payments").update({ payment_account_code: code }).eq("tenant_id", tenantId).in("id", ids);
  if (errU) throw new MutationError(`No se pudo asignar el banco: ${pgErrorToMessage(errU)}`, 500, errU);
  return { cobros: ids.length };
}

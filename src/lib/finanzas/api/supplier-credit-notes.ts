/**
 * NOTA DE CRÉDITO DE COMPRA (3.5, migración `066`): alta, reversión y lectura.
 *
 * 🔑 SOP-014: los dos RPC tienen EXECUTE sólo para `service_role`, así que van
 *    con el cliente de SERVICIO (`ledgerDb`) y el `tenantId` sale del perfil
 *    autenticado, nunca del body. Las lecturas van con la sesión (RLS).
 *
 * El alta es UNA transacción en la base (número, NC, líneas y asiento): no hay
 * compensación que hacer desde acá. Lo que sí se hace acá es armar el asiento
 * con la función pura, para que sea el mismo patrón que el resto del libro; la
 * base lo verifica contra los montos que calcula ella.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import {
  calcularNcDeCompra,
  construirAsientoDeNotaDeCompra,
  SOURCE_TYPE_NOTA_CREDITO_PROVEEDOR,
  type CompraParaNc,
  type LineaDeCompraParaNc,
  type LineaPedida,
} from "@/lib/finanzas/contabilidad/asiento-nota-credito-compra";
import { construirAsientoDeReversion, MOTIVO_MAX, MOTIVO_MIN, type AsientoAReversar } from "@/lib/finanzas/contabilidad/reversion";
import { esTipoValidoParaGasto } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import { cargarAsientosPorOrigen } from "@/lib/finanzas/queries/payments";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

type DB = SupabaseClient;

export interface CompraConLineasParaNc extends CompraParaNc {
  total: number;
  balance_due: number;
  status: string;
  lineas: LineaDeCompraParaNc[];
}

function num(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

/** La compra con cada línea y lo que ya le acreditaron NC vigentes. */
export async function cargarCompraParaNc(
  db: DB,
  tenantId: string,
  compraId: string
): Promise<CompraConLineasParaNc | null> {
  const { data: be, error } = await db
    .from("business_expenses")
    .select("id, description, supplier_name, supplier_id, total, balance_due, status")
    .eq("tenant_id", tenantId)
    .eq("id", compraId)
    .maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!be) return null;

  const { data: lns, error: errL } = await db
    .from("expense_lines")
    .select("id, line_order, description, chart_account_code, amount, tax_rate, tax_amount")
    .eq("tenant_id", tenantId)
    .eq("business_expense_id", compraId)
    .order("line_order", { ascending: true });
  if (errL) throw new MutationError(pgErrorToMessage(errL), 500, errL);
  const lineas = (lns ?? []) as {
    id: string; line_order: number; description: string; chart_account_code: string | null;
    amount: number | string; tax_rate: number | string; tax_amount: number | string;
  }[];

  // Lo acreditado por NC VIGENTES, por línea.
  const acreditado = new Map<string, { base: number; itbms: number }>();
  if (lineas.length > 0) {
    const { data: ncl } = await db
      .from("supplier_credit_note_lines")
      .select("expense_line_id, amount, tax_amount, nota:supplier_credit_notes!inner(status)")
      .eq("tenant_id", tenantId)
      .in("expense_line_id", lineas.map((l) => l.id));
    for (const r of (ncl ?? []) as unknown as {
      expense_line_id: string; amount: number | string; tax_amount: number | string;
      nota: { status: string } | { status: string }[] | null;
    }[]) {
      const nota = Array.isArray(r.nota) ? r.nota[0] : r.nota;
      if (nota?.status !== "emitida") continue;
      const a = acreditado.get(r.expense_line_id) ?? { base: 0, itbms: 0 };
      a.base += num(r.amount);
      a.itbms += num(r.tax_amount);
      acreditado.set(r.expense_line_id, a);
    }
  }

  // Validez de las cuentas: el MISMO predicado que la compra (cuentas-de-gasto.ts).
  const codigos = Array.from(new Set(lineas.map((l) => l.chart_account_code).filter((x): x is string => !!x)));
  const validas = new Set<string>();
  if (codigos.length > 0) {
    const { data: cta } = await db
      .from("chart_of_accounts")
      .select("code, active, account_type")
      .eq("tenant_id", tenantId)
      .in("code", codigos);
    for (const c of (cta ?? []) as { code: string; active: boolean; account_type: AccountType }[]) {
      if (c.active && esTipoValidoParaGasto(c.account_type)) validas.add(c.code);
    }
  }

  const row = be as Record<string, unknown>;
  return {
    id: String(row.id),
    description: String(row.description ?? ""),
    supplier_name: (row.supplier_name as string | null) ?? null,
    supplier_id: (row.supplier_id as string | null) ?? null,
    total: num(row.total),
    balance_due: num(row.balance_due),
    status: String(row.status),
    lineas: lineas.map((l) => ({
      id: l.id,
      line_order: l.line_order,
      description: l.description,
      chart_account_code: l.chart_account_code,
      amount: num(l.amount),
      tax_rate: num(l.tax_rate),
      tax_amount: num(l.tax_amount),
      acreditado_base: acreditado.get(l.id)?.base ?? 0,
      acreditado_itbms: acreditado.get(l.id)?.itbms ?? 0,
      cuenta_valida: l.chart_account_code !== null && validas.has(l.chart_account_code),
    })),
  };
}

export interface CrearNcDeCompraInput {
  business_expense_id: string;
  supplier_document_number: string;
  supplier_document_date: string;
  supplier_cufe?: string | null;
  reason: string;
  lineas: LineaPedida[];
}

/** La forma del pedido. Los montos los valida `calcularNcDeCompra` y la base. */
export function validarPedidoDeNcDeCompra(raw: unknown):
  | { ok: true; data: CrearNcDeCompraInput }
  | { ok: false; errors: Record<string, string> } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const compra = s(b.business_expense_id);
  const doc = s(b.supplier_document_number);
  const fecha = s(b.supplier_document_date);
  const motivo = s(b.reason);
  if (!compra) errors.business_expense_id = "Falta la compra.";
  if (!doc) errors.supplier_document_number = "Escribe el número de la nota de crédito que te dio el proveedor.";
  if (doc.length > 100) errors.supplier_document_number = "El número del documento no puede pasar de 100 caracteres.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) {
    errors.supplier_document_date = "Indica la fecha del documento del proveedor.";
  }
  if (motivo.length < 3 || motivo.length > 1000) errors.reason = "El motivo debe tener entre 3 y 1000 caracteres.";
  const lineas = Array.isArray(b.lineas)
    ? (b.lineas as unknown[]).map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { expense_line_id: s(o.expense_line_id), amount: Number(o.amount) };
      }).filter((x) => x.expense_line_id && Number.isFinite(x.amount) && x.amount > 0)
    : [];
  if (lineas.length === 0) errors.lineas = "Indica cuánto se acredita en al menos una línea.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      business_expense_id: compra,
      supplier_document_number: doc,
      supplier_document_date: fecha,
      supplier_cufe: s(b.supplier_cufe) || null,
      reason: motivo,
      lineas,
    },
  };
}

export interface NcDeCompraCreada {
  id: string;
  credit_note_number: string;
  total: number;
  entry_number: number;
}

export async function createSupplierCreditNote(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  input: CrearNcDeCompraInput,
  hoy: string = new Date().toISOString().slice(0, 10)
): Promise<NcDeCompraCreada> {
  const compra = await cargarCompraParaNc(db, tenantId, input.business_expense_id);
  if (!compra) throw new MutationError("Compra no encontrada", 404);

  const calculo = calcularNcDeCompra(compra.lineas, input.lineas, compra.balance_due);
  if (!calculo.ok) throw new MutationError(calculo.mensaje, 422);

  const armado = construirAsientoDeNotaDeCompra(compra, hoy, calculo);
  if (!armado.ok) throw new MutationError(armado.mensaje, 422);

  const { data, error } = await ledgerDb.rpc("create_supplier_credit_note", {
    p_tenant_id: tenantId,
    p_business_expense_id: compra.id,
    p_doc_numero: input.supplier_document_number,
    p_doc_fecha: input.supplier_document_date,
    p_doc_cufe: input.supplier_cufe ?? null,
    p_reason: input.reason,
    p_issue_date: hoy,
    p_lineas: calculo.lineas.map((x) => ({ expense_line_id: x.linea.id, amount: x.amount })),
    p_asiento: armado.asiento.lines,
    p_created_by: userId,
  });
  if (error) {
    // 23505 del índice del documento del proveedor: ya se registró.
    if ((error as { code?: string }).code === "23505") {
      throw new MutationError(
        `La nota de crédito ${input.supplier_document_number} de este proveedor ya está registrada.`,
        409,
        error
      );
    }
    // Los mensajes del RPC ya vienen redactados para una persona.
    throw new MutationError(error.message || "No se pudo registrar la nota de crédito.", 422, error);
  }
  const r = data as { id: string; credit_note_number: string; total: number; entry_number: number };
  return { id: r.id, credit_note_number: r.credit_note_number, total: Number(r.total), entry_number: Number(r.entry_number) };
}

export async function getAsientoDeNotaDeCompra(
  db: DB,
  tenantId: string,
  ncId: string
): Promise<AsientoAReversar | null> {
  const mapa = await cargarAsientosPorOrigen(db, tenantId, SOURCE_TYPE_NOTA_CREDITO_PROVEEDOR, [ncId]);
  return mapa.get(ncId) ?? null;
}

export async function reverseSupplierCreditNote(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  ncId: string,
  reason: string
): Promise<{ entry_number: number; reversed_entry_number: number; credit_note_number: string }> {
  const motivo = reason.trim();
  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
    throw new MutationError(`El motivo de la reversión debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`, 400);
  }
  const { data: nc, error } = await db
    .from("supplier_credit_notes")
    .select("id, status, credit_note_number")
    .eq("tenant_id", tenantId)
    .eq("id", ncId)
    .maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!nc) throw new MutationError("Nota de crédito de proveedor no encontrada", 404);
  if ((nc as { status: string }).status === "anulada") {
    throw new MutationError("Esta nota de crédito ya está anulada.", 409);
  }

  const original = await getAsientoDeNotaDeCompra(db, tenantId, ncId);
  if (!original) throw new MutationError("La nota de crédito no tiene asiento: no hay nada que reversar.", 409);

  // El espejo: la MISMA función que dibuja la vista previa del diálogo.
  const armado = construirAsientoDeReversion(original, {
    hoy: new Date().toISOString().slice(0, 10),
    motivo,
    source_id: ncId,
  });
  if (!armado.ok) throw new MutationError(armado.mensaje, 422);

  const { data, error: errRpc } = await ledgerDb.rpc("reverse_supplier_credit_note", {
    p_tenant_id: tenantId,
    p_credit_note_id: ncId,
    p_reason: armado.asiento.reversal_reason,
    p_transaction_date: armado.asiento.transaction_date,
    p_description: armado.asiento.description,
    p_lines: armado.asiento.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
    })),
    p_created_by: userId,
  });
  if (errRpc) {
    throw new MutationError(errRpc.message || "No se pudo reversar la nota de crédito.", 422, errRpc);
  }
  const r = data as { entry_number: number; reversed_entry_number: number; credit_note_number: string };
  return r;
}

export interface NcDeCompraResumen {
  id: string;
  credit_note_number: string;
  supplier_document_number: string;
  issue_date: string;
  status: string;
  grand_total: number;
}

export async function listSupplierCreditNotesForExpense(
  db: DB,
  tenantId: string,
  compraId: string
): Promise<NcDeCompraResumen[]> {
  const { data } = await db
    .from("supplier_credit_notes")
    .select("id, credit_note_number, supplier_document_number, issue_date, status, grand_total")
    .eq("tenant_id", tenantId)
    .eq("business_expense_id", compraId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    credit_note_number: String(r.credit_note_number),
    supplier_document_number: String(r.supplier_document_number),
    issue_date: String(r.issue_date),
    status: String(r.status),
    grand_total: num(r.grand_total),
  }));
}

export async function getSupplierCreditNoteById(db: DB, tenantId: string, id: string) {
  const { data: nc } = await db
    .from("supplier_credit_notes")
    .select(
      `id, credit_note_number, business_expense_id, supplier_document_number, supplier_document_date,
       supplier_cufe, issue_date, reason, status, subtotal_total, tax_total, grand_total,
       cancelled_at, cancellation_reason, created_at,
       compra:business_expenses!supplier_credit_notes_business_expense_id_fkey(id, description, supplier_name, total, balance_due),
       proveedor:suppliers!supplier_credit_notes_supplier_id_fkey(id, supplier_number, legal_name, ruc, dv)`
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!nc) return null;
  const { data: lineas } = await db
    .from("supplier_credit_note_lines")
    .select("id, line_order, description, chart_account_code, amount, tax_rate, tax_amount, line_total")
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", id)
    .order("line_order", { ascending: true });
  return { ...(nc as Record<string, unknown>), lineas: lineas ?? [] };
}

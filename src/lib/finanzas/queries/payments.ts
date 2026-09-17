/**
 * Queries server-side para payments. Patrón consistente con el resto del
 * módulo: admin client + filtro manual por tenant_id.
 *
 * MVP: getPaymentsForInvoice — devuelve todos los pagos que se aplicaron
 * a la factura indicada, con monto aplicado + datos del usuario que lo
 * registró. Como el sprint usa 1 pago = 1 application, el monto aplicado
 * coincide con payment.amount.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS ORÍGENES DESDE EL 17/09/2026: `payment_applications` Y `payment_reversals`
 * ─────────────────────────────────────────────────────────────────────────────
 * Reversar un cobro (`reverse_payment`, migración `046`) BORRA sus
 * `payment_applications` — es lo que dispara T7a y devuelve la factura a su
 * estado—, así que un cobro reversado ya no aparece por el primer origen. Si
 * solo se leyera ese, el cobro desaparecería de la pantalla como si nunca
 * hubiera existido, y la abogada vería una factura "emitida" sin rastro de que
 * alguien cobró y después deshizo. La foto queda en `payment_reversals`, y de
 * ahí sale la fila tachada.
 *
 * El filtro viejo "excluir anulados por ruido visual" se conserva para los
 * anulados que NO vienen de una reversión (hoy no hay ninguno: el único camino
 * a `anulado` es el RPC). Un cobro reversado se muestra SIEMPRE.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AsientoDeCobro,
  PaymentForInvoice,
  ReversionDeCobro,
} from "@/lib/finanzas/types/payment";
import { SOURCE_TYPE_COBRO } from "@/lib/finanzas/contabilidad/asiento-tesoreria";

type DB = SupabaseClient;

function num(v: number | string | null | undefined): number {
  return v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);
}

type PaymentRaw = {
  id: string;
  payment_number: string | null;
  client_id: string;
  payment_date: string;
  amount: string | number;
  amount_unapplied: string | number;
  currency: string;
  method: string;
  reference: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

const PAYMENT_COLS =
  "id, payment_number, client_id, payment_date, amount, amount_unapplied, " +
  "currency, method, reference, status, notes, created_at, created_by";

/**
 * El asiento de UN cobro, con sus líneas y el código y nombre de cada cuenta.
 * Null si el cobro no está en el libro (los anteriores al cableado del 04/09).
 *
 * Lo usa la ruta de reversión para armar el espejo, y `getPaymentsForInvoice`
 * para que la pantalla sepa si el cobro se reversa o se elimina, y para dibujar
 * la vista previa con las mismas líneas que va a postear el servidor.
 */
export async function getAsientoDeCobro(
  db: DB,
  tenantId: string,
  paymentId: string
): Promise<AsientoDeCobro | null> {
  const mapa = await cargarAsientosDeCobros(db, tenantId, [paymentId]);
  return mapa.get(paymentId) ?? null;
}

/** Los asientos de varios cobros de una vez, por `payment_id`. */
async function cargarAsientosDeCobros(
  db: DB,
  tenantId: string,
  paymentIds: string[]
): Promise<Map<string, AsientoDeCobro>> {
  const resultado = new Map<string, AsientoDeCobro>();
  if (paymentIds.length === 0) return resultado;

  const { data: asientos, error } = await db
    .from("journal_entries")
    .select("id, entry_number, transaction_date, description, reference, source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE_COBRO)
    .in("source_id", paymentIds);

  if (error) {
    console.error("[finanzas/queries] cargarAsientosDeCobros failed", error);
    return resultado;
  }

  type Cab = {
    id: string;
    entry_number: number;
    transaction_date: string;
    description: string;
    reference: string | null;
    source_id: string;
  };
  const cabeceras = (asientos ?? []) as Cab[];
  if (cabeceras.length === 0) return resultado;

  const { data: lineas, error: errLineas } = await db
    .from("journal_entry_lines")
    .select("entry_id, line_order, debit, credit, line_description, chart_of_accounts!inner(code, name)")
    .eq("tenant_id", tenantId)
    .in(
      "entry_id",
      cabeceras.map((c) => c.id)
    )
    .order("line_order");

  if (errLineas) {
    console.error("[finanzas/queries] cargarAsientosDeCobros(lineas) failed", errLineas);
    return resultado;
  }

  type Lin = {
    entry_id: string;
    line_order: number;
    debit: number | string;
    credit: number | string;
    line_description: string | null;
    chart_of_accounts: { code: string; name: string };
  };
  const porAsiento = new Map<string, AsientoDeCobro["lines"]>();
  for (const l of (lineas ?? []) as unknown as Lin[]) {
    const lista = porAsiento.get(l.entry_id) ?? [];
    lista.push({
      account_code: l.chart_of_accounts.code,
      account_name: l.chart_of_accounts.name,
      debit: num(l.debit),
      credit: num(l.credit),
      description: l.line_description,
    });
    porAsiento.set(l.entry_id, lista);
  }

  for (const c of cabeceras) {
    resultado.set(c.source_id, {
      id: c.id,
      entry_number: Number(c.entry_number),
      transaction_date: c.transaction_date,
      description: c.description,
      reference: c.reference,
      lines: porAsiento.get(c.id) ?? [],
    });
  }
  return resultado;
}

/**
 * Lista los pagos aplicados a una factura específica, ordenados por
 * payment_date descendente (más recientes primero). Incluye los reversados
 * (ver el encabezado), con `reversion` cargada.
 */
export async function getPaymentsForInvoice(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<PaymentForInvoice[]> {
  // ---- 1) Los vigentes: por payment_applications ---------------------------
  const { data, error } = await db
    .from("payment_applications")
    .select(
      `
        amount_applied,
        payment:payments!payment_applications_payment_id_fkey(${PAYMENT_COLS})
      `
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);

  if (error) {
    console.error("[finanzas/queries] getPaymentsForInvoice failed", error);
    return [];
  }

  type Row = { amount_applied: string | number; payment: PaymentRaw | null };
  const rows = (data ?? []) as unknown as Row[];

  // Excluir anulados (presentación). Mantener registrado + conciliado. Los
  // reversados entran por el paso 2, no por acá.
  const vigentes = rows.filter((r) => r.payment && r.payment.status !== "anulado");

  // ---- 2) Los reversados: por payment_reversals -----------------------------
  const { data: revs, error: errRevs } = await db
    .from("payment_reversals")
    .select(
      `
        amount_applied, reason, reversed_at, reversed_by,
        reversal:journal_entries!payment_reversals_reversal_entry_id_fkey(entry_number),
        reversed:journal_entries!payment_reversals_reversed_entry_id_fkey(entry_number),
        payment:payments!payment_reversals_payment_id_fkey(${PAYMENT_COLS})
      `
    )
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);

  if (errRevs) {
    // No se esconde: si esto falla, la pantalla mostraría una factura sin
    // rastro de un cobro deshecho. Se loguea y se sigue con los vigentes.
    console.error("[finanzas/queries] getPaymentsForInvoice(payment_reversals) failed", errRevs);
  }

  type Uno = { entry_number: number } | { entry_number: number }[] | null;
  const primero = (x: Uno): number => {
    const v = Array.isArray(x) ? x[0] : x;
    return Number(v?.entry_number ?? 0);
  };
  type RevRow = {
    amount_applied: string | number;
    reason: string;
    reversed_at: string;
    reversed_by: string | null;
    reversal: Uno;
    reversed: Uno;
    payment: PaymentRaw | null;
  };
  const reversados = ((revs ?? []) as unknown as RevRow[]).filter((r) => r.payment);

  // ---- 3) Hidratar nombres de usuario con un solo lookup --------------------
  const userIds = Array.from(
    new Set(
      [
        ...vigentes.map((r) => r.payment?.created_by),
        ...reversados.map((r) => r.payment?.created_by),
        ...reversados.map((r) => r.reversed_by),
      ].filter((id): id is string => !!id)
    )
  );
  const userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await db.from("users").select("id, full_name").in("id", userIds);
    for (const u of users ?? []) {
      userMap[u.id as string] = (u.full_name as string) ?? "";
    }
  }

  // ---- 4) El asiento de cada cobro vigente ----------------------------------
  const asientos = await cargarAsientosDeCobros(
    db,
    tenantId,
    vigentes.map((r) => r.payment!.id)
  );

  const aFila = (
    p: PaymentRaw,
    amountApplied: string | number,
    asiento: AsientoDeCobro | null,
    reversion: ReversionDeCobro | null
  ): PaymentForInvoice => ({
    id: p.id,
    payment_number: p.payment_number,
    client_id: p.client_id,
    payment_date: p.payment_date,
    amount: p.amount,
    amount_unapplied: p.amount_unapplied,
    currency: p.currency,
    // cast: la BD garantiza el dominio vía CHECK
    method: p.method as PaymentForInvoice["method"],
    reference: p.reference,
    status: p.status as PaymentForInvoice["status"],
    notes: p.notes,
    created_at: p.created_at,
    created_by: p.created_by,
    amount_applied: amountApplied,
    created_by_name: p.created_by ? userMap[p.created_by] ?? null : null,
    asiento,
    reversion,
  });

  const result: PaymentForInvoice[] = [
    ...vigentes.map((r) =>
      aFila(r.payment!, r.amount_applied, asientos.get(r.payment!.id) ?? null, null)
    ),
    ...reversados.map((r) =>
      aFila(r.payment!, r.amount_applied, null, {
        entry_number: primero(r.reversal),
        reversed_entry_number: primero(r.reversed),
        reason: r.reason,
        reversed_at: r.reversed_at,
        reversed_by_name: r.reversed_by ? userMap[r.reversed_by] ?? null : null,
      })
    ),
  ].sort((a, b) => (a.payment_date < b.payment_date ? 1 : -1));

  return result;
}

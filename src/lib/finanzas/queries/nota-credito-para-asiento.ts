/**
 * La NOTA DE CRÉDITO ya insertada, releída con sus líneas y las cuentas de
 * ingreso de sus servicios, para armar su asiento propio (Bloque 5, D5).
 * Simétrico de `cargarFacturaParaAsiento`: se llama después del INSERT y
 * antes del posteo; si el posteo falla, `emitCreditNote` deshace la NC con la
 * válvula de la 052.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotaDeCreditoParaAsiento } from "@/lib/finanzas/contabilidad/asiento-nota-credito";
import { resolverLineasParaAsiento, type FilaLinea } from "@/lib/finanzas/queries/factura-para-asiento";

type DB = SupabaseClient;

const num = (v: number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);

export async function cargarNotaDeCreditoParaAsiento(
  db: DB,
  tenantId: string,
  ncId: string
): Promise<NotaDeCreditoParaAsiento | null> {
  const { data: nc, error: errNc } = await db
    .from("credit_notes")
    .select(
      "id, credit_note_number, issue_date, grand_total, " +
        "invoice:invoices!credit_notes_invoice_id_fkey(invoice_number), " +
        "client:clients!credit_notes_client_id_fkey(name)"
    )
    .eq("tenant_id", tenantId)
    .eq("id", ncId)
    .maybeSingle();
  if (errNc) throw errNc;
  if (!nc) return null;

  const { data: filas, error: errLin } = await db
    .from("credit_note_lines")
    .select("line_order, description, subtotal, tax_amount, service_id")
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", ncId)
    .order("line_order", { ascending: true });
  if (errLin) throw errLin;

  const lineas = await resolverLineasParaAsiento(db, tenantId, (filas ?? []) as unknown as FilaLinea[]);

  type Uno<T> = T | T[] | null | undefined;
  const uno = <T,>(x: Uno<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
  const row = nc as unknown as {
    id: string;
    credit_note_number: string;
    issue_date: string;
    grand_total: number | string;
    invoice: Uno<{ invoice_number: string }>;
    client: Uno<{ name: string }>;
  };

  return {
    id: row.id,
    credit_note_number: row.credit_note_number,
    issue_date: row.issue_date,
    grand_total: num(row.grand_total),
    invoice_number: uno(row.invoice)?.invoice_number ?? "",
    client_name: uno(row.client)?.name ?? "—",
    lineas,
  };
}

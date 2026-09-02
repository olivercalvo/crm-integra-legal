/**
 * FUENTE DE DATOS del Diario General.
 *
 * Tres consultas y no un join gigante, por la misma razón que en el Libro Mayor:
 * PostgREST devuelve el join anidado y hay que reagrupar igual, así que se lee
 * plano y se arma acá, que es más fácil de leer y de depurar.
 *
 * El nombre del tercero (el "documento de respaldo") se resuelve igual que en el
 * mayor: mirando la tabla que corresponde a cada `source_type`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AsientoCrudo, LineaCruda } from "@/lib/finanzas/reports/diario-general";
import type { RangoFechas } from "@/lib/finanzas/reports/libro-mayor-source";

type DB = SupabaseClient;

/** Tabla y columna de la que sale el rótulo del documento, por `source_type`. */
const DOCUMENTO_DE: Record<string, { tabla: string; campo: string }> = {
  factura: { tabla: "invoices", campo: "invoice_number" },
  nota_credito: { tabla: "invoices", campo: "invoice_number" },
  gasto: { tabla: "business_expenses", campo: "supplier_name" },
  pago: { tabla: "payments", campo: "reference" },
};

/**
 * Los asientos del rango, con sus líneas y el rótulo de su documento.
 *
 * Orden: por fecha y después por correlativo. Un diario se lee cronológicamente,
 * y dentro del mismo día el correlativo es el orden en que se registraron.
 */
export async function loadAsientosDelDiario(
  db: DB,
  tenantId: string,
  rango: RangoFechas = {}
): Promise<AsientoCrudo[]> {
  let q = db
    .from("journal_entries")
    .select("id, entry_number, transaction_date, description, source_type, source_id")
    .eq("tenant_id", tenantId);

  if (rango.desde) q = q.gte("transaction_date", rango.desde);
  if (rango.hasta) q = q.lte("transaction_date", rango.hasta);

  const { data: cabeceras, error } = await q
    .order("transaction_date", { ascending: true })
    .order("entry_number", { ascending: true });

  if (error) {
    console.error("[finanzas/diario] loadAsientosDelDiario failed", error);
    throw new Error("No se pudieron leer los asientos del diario");
  }

  type Cabecera = {
    id: string;
    entry_number: number;
    transaction_date: string;
    description: string;
    source_type: string;
    source_id: string | null;
  };
  const asientos = (cabeceras ?? []) as unknown as Cabecera[];
  if (asientos.length === 0) return [];

  const entryIds = asientos.map((a) => a.id);

  // -- líneas, con el código y el nombre de su cuenta -------------------------
  const { data: lineas, error: errLineas } = await db
    .from("journal_entry_lines")
    .select("entry_id, line_order, debit, credit, line_description, chart_of_accounts!inner(code, name)")
    .eq("tenant_id", tenantId)
    .in("entry_id", entryIds);

  if (errLineas) {
    console.error("[finanzas/diario] líneas failed", errLineas);
    throw new Error("No se pudieron leer las líneas de los asientos");
  }

  type FilaLinea = {
    entry_id: string;
    line_order: number;
    debit: number | string;
    credit: number | string;
    line_description: string | null;
    chart_of_accounts: { code: string; name: string };
  };
  const porAsiento = new Map<string, LineaCruda[]>();
  for (const l of (lineas ?? []) as unknown as FilaLinea[]) {
    const lista = porAsiento.get(l.entry_id) ?? [];
    lista.push({
      line_order: l.line_order,
      account_code: l.chart_of_accounts.code,
      account_name: l.chart_of_accounts.name,
      line_description: l.line_description,
      debit: Number(l.debit),
      credit: Number(l.credit),
    });
    porAsiento.set(l.entry_id, lista);
  }

  // -- rótulo del documento de respaldo --------------------------------------
  // Una consulta por TABLA, no por asiento.
  const documentos = new Map<string, string>();
  const idsPorTipo = new Map<string, Set<string>>();
  for (const a of asientos) {
    if (!a.source_id || !DOCUMENTO_DE[a.source_type]) continue;
    const set = idsPorTipo.get(a.source_type) ?? new Set<string>();
    set.add(a.source_id);
    idsPorTipo.set(a.source_type, set);
  }

  for (const [tipo, ids] of Array.from(idsPorTipo.entries())) {
    const { tabla, campo } = DOCUMENTO_DE[tipo];
    const { data, error: errDoc } = await db
      .from(tabla)
      .select(`id, ${campo}`)
      .eq("tenant_id", tenantId)
      .in("id", Array.from(ids));
    if (errDoc) {
      // Sin el rótulo el diario sigue siendo legible: la columna queda vacía.
      console.error(`[finanzas/diario] documento(${tabla}) failed`, errDoc);
      continue;
    }
    // El `select` es dinámico (`id, ${campo}`), así que el tipado de PostgREST no
    // puede inferirlo: se pasa por `unknown` a propósito.
    for (const fila of (data ?? []) as unknown as Record<string, unknown>[]) {
      const valor = fila[campo];
      if (typeof valor === "string") documentos.set(fila.id as string, valor);
    }
  }

  return asientos.map((a) => ({
    entry_id: a.id,
    entry_number: a.entry_number,
    transaction_date: String(a.transaction_date).slice(0, 10),
    description: a.description,
    source_type: a.source_type,
    source_id: a.source_id,
    documento: a.source_id ? (documentos.get(a.source_id) ?? null) : null,
    lineas: porAsiento.get(a.id) ?? [],
  }));
}

/**
 * IMPORTAR ASIENTOS DESDE EXCEL (7.5, migración `067`): vista previa,
 * contabilizar, deshacer y leer.
 *
 * 🔑 SOP-014: los RPC van con el cliente de SERVICIO; el tenant sale del
 *    perfil autenticado. Las lecturas van con la sesión (RLS).
 * 🔴 El commit vuelve a LEER el archivo y exige el MISMO hash que se vio en la
 *    vista previa: se contabiliza exactamente lo que se revisó.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import {
  validarImportacion,
  type ContextoDeImportacion,
  type ResultadoDeImportacion,
} from "@/lib/finanzas/import/asientos-import";
import { leerHojaDeAsientos } from "@/lib/finanzas/import/asientos-workbook";
import { construirAsientoDeReversion, type AsientoAReversar } from "@/lib/finanzas/contabilidad/reversion";

type DB = SupabaseClient;

export function hashDelArchivo(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function cargarContextoDeImportacion(db: DB, tenantId: string, hoy = new Date()): Promise<ContextoDeImportacion> {
  const [cuentas, periodos] = await Promise.all([
    db.from("chart_of_accounts").select("code, active").eq("tenant_id", tenantId),
    db.from("accounting_periods").select("year, month, status").eq("tenant_id", tenantId),
  ]);
  if (cuentas.error) throw new MutationError(pgErrorToMessage(cuentas.error), 500, cuentas.error);
  const existentes = new Set<string>();
  const activas = new Set<string>();
  for (const c of (cuentas.data ?? []) as { code: string; active: boolean }[]) {
    existentes.add(c.code);
    if (c.active) activas.add(c.code);
  }
  const cerrados = new Set<string>();
  const conPeriodo = new Set<string>();
  for (const p of (periodos.data ?? []) as { year: number; month: number; status: string }[]) {
    const mes = `${p.year}-${String(p.month).padStart(2, "0")}`;
    conPeriodo.add(mes);
    if (p.status !== "abierto") cerrados.add(mes);
  }
  // El motor (054) crea solo el período del año en curso y del siguiente.
  const anio = hoy.getUTCFullYear();
  return {
    cuentasExistentes: existentes,
    cuentasActivas: activas,
    mesesCerrados: cerrados,
    mesesConPeriodo: conPeriodo,
    aniosConPeriodoAutomatico: new Set([anio, anio + 1]),
  };
}

export async function previsualizarImportacion(
  db: DB,
  tenantId: string,
  buffer: Buffer
): Promise<{ hash: string; resultado: ResultadoDeImportacion; yaImportado: string | null }> {
  const matriz = leerHojaDeAsientos(buffer);
  const ctx = await cargarContextoDeImportacion(db, tenantId);
  const resultado = validarImportacion(matriz, ctx);
  const hash = hashDelArchivo(buffer);
  const { data: previo } = await db
    .from("journal_imports")
    .select("id, created_at")
    .eq("tenant_id", tenantId)
    .eq("file_hash", hash)
    .eq("status", "contabilizada")
    .maybeSingle();
  return { hash, resultado, yaImportado: previo ? String((previo as { created_at: string }).created_at) : null };
}

export async function contabilizarImportacion(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  buffer: Buffer,
  fileName: string,
  hashDeLaVistaPrevia: string
): Promise<{ import_id: string; entries: number; total_debits: number; entry_numbers: number[] }> {
  const hash = hashDelArchivo(buffer);
  if (hash !== hashDeLaVistaPrevia) {
    throw new MutationError("El archivo no es el mismo que se revisó en la vista previa. Vuelve a subirlo y revísalo.", 409);
  }
  const matriz = leerHojaDeAsientos(buffer);
  const ctx = await cargarContextoDeImportacion(db, tenantId);
  const r = validarImportacion(matriz, ctx);
  if (r.errores.length > 0) {
    throw new MutationError(
      `El archivo tiene ${r.errores.length} error${r.errores.length === 1 ? "" : "es"}. No se registró nada.`,
      422
    );
  }
  const { data, error } = await ledgerDb.rpc("post_journal_entries_batch", {
    p_tenant_id: tenantId,
    p_file_name: fileName,
    p_file_hash: hash,
    p_rows_count: r.filasLeidas,
    p_entries: r.asientos.map((a) => ({
      group_label: a.group_label,
      first_row: a.first_row,
      transaction_date: a.transaction_date,
      description: a.description,
      reference: a.reference,
      lines: a.lines,
    })),
    p_created_by: userId,
  });
  if (error) {
    // Los mensajes del motor ya vienen redactados; y nada quedó escrito.
    throw new MutationError(`No se registró nada: ${error.message}`, 422, error);
  }
  const d = data as { import_id: string; entries: number; total_debits: number; entry_numbers: number[] };
  return { ...d, total_debits: Number(d.total_debits) };
}

/** Los asientos de un lote, con sus líneas, y cuáles ya están reversados. */
export async function cargarAsientosDeImportacion(db: DB, tenantId: string, importId: string) {
  const { data: vinc } = await db
    .from("journal_import_entries")
    .select("entry_id, group_label, first_row, orden")
    .eq("tenant_id", tenantId)
    .eq("import_id", importId)
    .order("orden");
  const vinculos = (vinc ?? []) as { entry_id: string; group_label: string; first_row: number; orden: number }[];
  const ids = vinculos.map((v) => v.entry_id);
  if (ids.length === 0) return [];

  const [cab, lin, rev] = await Promise.all([
    db.from("journal_entries").select("id, entry_number, transaction_date, description, reference").eq("tenant_id", tenantId).in("id", ids),
    db
      .from("journal_entry_lines")
      .select("entry_id, line_order, debit, credit, line_description, chart_of_accounts!inner(code, name)")
      .eq("tenant_id", tenantId)
      .in("entry_id", ids)
      .order("line_order"),
    db.from("journal_entries").select("entry_number, reverses_entry_id").eq("tenant_id", tenantId).in("reverses_entry_id", ids),
  ]);
  const cabeceras = new Map(((cab.data ?? []) as { id: string; entry_number: number; transaction_date: string; description: string; reference: string | null }[]).map((c) => [c.id, c]));
  const lineas = new Map<string, AsientoAReversar["lines"]>();
  for (const l of (lin.data ?? []) as unknown as { entry_id: string; debit: number | string; credit: number | string; line_description: string | null; chart_of_accounts: { code: string; name: string } }[]) {
    const lista = lineas.get(l.entry_id) ?? [];
    lista.push({ account_code: l.chart_of_accounts.code, account_name: l.chart_of_accounts.name, debit: Number(l.debit), credit: Number(l.credit), description: l.line_description });
    lineas.set(l.entry_id, lista);
  }
  const reversadoPor = new Map(((rev.data ?? []) as { entry_number: number; reverses_entry_id: string }[]).map((r) => [r.reverses_entry_id, Number(r.entry_number)]));

  return vinculos
    .filter((v) => cabeceras.has(v.entry_id))
    .map((v) => {
      const c = cabeceras.get(v.entry_id)!;
      const ls = lineas.get(v.entry_id) ?? [];
      return {
        asiento: { id: c.id, entry_number: Number(c.entry_number), transaction_date: c.transaction_date, description: c.description, reference: c.reference, lines: ls } as AsientoAReversar & { lines: { account_code: string; account_name: string; debit: number; credit: number; description: string | null }[] },
        group_label: v.group_label,
        first_row: v.first_row,
        total: Math.round(ls.reduce((s, l) => s + l.debit, 0) * 100) / 100,
        reversado_por: reversadoPor.get(v.entry_id) ?? null,
      };
    });
}

export async function deshacerImportacion(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  importId: string,
  motivo: string
): Promise<{ reversados: number; ya_reversados: number }> {
  const m = motivo.trim();
  if (m.length < 3 || m.length > 1000) {
    throw new MutationError("El motivo debe tener entre 3 y 1000 caracteres.", 400);
  }
  const { data: imp } = await db
    .from("journal_imports")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("id", importId)
    .maybeSingle();
  if (!imp) throw new MutationError("Importación no encontrada", 404);
  if ((imp as { status: string }).status !== "contabilizada") {
    throw new MutationError("Esta importación ya se deshizo.", 409);
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const asientos = await cargarAsientosDeImportacion(db, tenantId, importId);
  const espejos = [];
  for (const a of asientos) {
    if (a.reversado_por !== null) continue;
    // La MISMA función que arma todas las reversiones del libro.
    const armado = construirAsientoDeReversion(a.asiento, { hoy, motivo: m, source_id: null });
    if (!armado.ok) throw new MutationError(armado.mensaje, 422);
    espejos.push({
      entry_id: a.asiento.id,
      description: armado.asiento.description,
      lines: armado.asiento.lines.map((l) => ({ account_code: l.account_code, debit: l.debit, credit: l.credit, description: l.description ?? null })),
    });
  }

  const { data, error } = await ledgerDb.rpc("reverse_journal_import", {
    p_tenant_id: tenantId,
    p_import_id: importId,
    p_reason: m,
    p_transaction_date: hoy,
    p_mirrors: espejos,
    p_created_by: userId,
  });
  if (error) throw new MutationError(`No se deshizo nada: ${error.message}`, 422, error);
  return data as { reversados: number; ya_reversados: number };
}

export interface ImportacionResumen {
  id: string;
  file_name: string;
  entries_count: number;
  total_debits: number;
  status: string;
  created_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export async function listarImportaciones(db: DB, tenantId: string): Promise<ImportacionResumen[]> {
  const { data } = await db
    .from("journal_imports")
    .select("id, file_name, entries_count, total_debits, status, created_at, reversed_at, reversal_reason")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    file_name: String(r.file_name),
    entries_count: Number(r.entries_count),
    total_debits: Number(r.total_debits),
    status: String(r.status),
    created_at: String(r.created_at),
    reversed_at: (r.reversed_at as string | null) ?? null,
    reversal_reason: (r.reversal_reason as string | null) ?? null,
  }));
}

export async function getImportacion(db: DB, tenantId: string, id: string): Promise<ImportacionResumen | null> {
  const lista = await db
    .from("journal_imports")
    .select("id, file_name, entries_count, total_debits, status, created_at, reversed_at, reversal_reason")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  const r = lista.data as Record<string, unknown> | null;
  if (!r) return null;
  return {
    id: String(r.id),
    file_name: String(r.file_name),
    entries_count: Number(r.entries_count),
    total_debits: Number(r.total_debits),
    status: String(r.status),
    created_at: String(r.created_at),
    reversed_at: (r.reversed_at as string | null) ?? null,
    reversal_reason: (r.reversal_reason as string | null) ?? null,
  };
}

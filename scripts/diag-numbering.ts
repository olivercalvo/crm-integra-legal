import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TENANT = "a0000000-0000-0000-0000-000000000001";

if (!url || !key) {
  console.error("Missing env vars");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

type Check = {
  sequence_type: string;
  table: string;
  column: string;
  pattern: RegExp;
};

const CHECKS: Check[] = [
  { sequence_type: "client",       table: "clients",      column: "client_number",      pattern: /^CLI-0*(\d+)$/ },
  { sequence_type: "quote",        table: "quotes",       column: "quote_number",       pattern: /^COT-0*(\d+)$/ },
  { sequence_type: "invoice_hon",  table: "invoices",     column: "invoice_number",     pattern: /^FAC-HON-0*(\d+)$/ },
  { sequence_type: "invoice_reim", table: "invoices",     column: "invoice_number",     pattern: /^FAC-REI-0*(\d+)$/ },
  { sequence_type: "credit_note",  table: "credit_notes", column: "credit_note_number", pattern: /^NC-0*(\d+)$/ },
];

async function main() {
  // Cargar las 5 secuencias del tenant
  const seqs = await db
    .from("numbering_sequences")
    .select("sequence_type, last_number, updated_at")
    .eq("tenant_id", TENANT);
  if (seqs.error) { console.error("seq err", seqs.error); return; }
  const seqMap = new Map<string, { last_number: number; updated_at: string }>();
  for (const r of seqs.data ?? []) seqMap.set((r as any).sequence_type, r as any);

  const rows: any[] = [];
  for (const c of CHECKS) {
    const all = await db.from(c.table).select(c.column).eq("tenant_id", TENANT);
    if (all.error) {
      rows.push({ sequence_type: c.sequence_type, last_number: "ERR", max_real: "ERR", gap: "ERR", note: all.error.message });
      continue;
    }
    const nums: number[] = [];
    let total = 0;
    for (const r of (all.data ?? []) as any[]) {
      total++;
      const v = r[c.column] ?? "";
      const m = c.pattern.exec(v);
      if (m) nums.push(parseInt(m[1], 10));
    }
    const max_real = nums.length ? Math.max(...nums) : 0;
    const seq = seqMap.get(c.sequence_type);
    const last_number = seq?.last_number ?? null;
    const gap = last_number === null ? null : (max_real - last_number);
    rows.push({
      sequence_type: c.sequence_type,
      last_number,
      max_real,
      gap,
      estado: last_number === null ? "NO_SEQ_ROW" : (gap! > 0 ? "DESALINEADA" : (gap! < 0 ? "ADELANTADA(ok)" : "OK")),
      total_rows: total,
      matched: nums.length,
      seq_updated_at: seq?.updated_at ?? null,
    });
  }
  console.log(`\n=== Resumen secuencias vs realidad (tenant ${TENANT}) ===\n`);
  console.table(rows);

  // Detalle de no-match (envenenadores potenciales) por cada tipo
  for (const c of CHECKS) {
    const all = await db.from(c.table).select(c.column).eq("tenant_id", TENANT);
    if (all.error) continue;
    const weird = ((all.data ?? []) as any[])
      .map((r) => r[c.column])
      .filter((v) => v && !c.pattern.test(v));
    if (weird.length) {
      console.log(`\n!!! ${c.table}.${c.column} con ${weird.length} valor(es) que NO matchean ${c.pattern}:`);
      console.log(weird.slice(0, 10));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

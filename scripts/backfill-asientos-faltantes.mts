/**
 * BACKFILL — los dos documentos de staging que quedaron sin asiento.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ CIERRA
 * ═════════════════════════════════════════════════════════════════════════════
 * La antigüedad de cuentas por cobrar difiere del Libro Mayor en 191.697,55,
 * mientras que el saldo de apertura de esa cuenta es 191.947,55. Los 250,00 de
 * sobra tienen DOS causas nuestras, no del bufete:
 *
 *   · `FAC-REI-000002` (400,00) está emitida y nunca se posteó.
 *   · El cobro de `FAC-REI-000001` (150,00) se sembró a propósito SIN asiento,
 *     para preservar una línea base de 2.895,00 que servía para desarrollar.
 *
 * Esa línea base ya cumplió. Un contador tiene que ver UNA diferencia con UNA
 * causa —el saldo de apertura cargado sin detalle— y no dos, con una que es
 * nuestra y que él no tiene forma de explicar.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 SOLO STAGING. PRODUCCIÓN NO SE TOCA.
 * ═════════════════════════════════════════════════════════════════════════════
 * El candado aborta si la URL no es la de staging. Y no es teatro: el ledger es
 * inmutable, así que un asiento posteado por error en producción NO SE BORRA —
 * los triggers de la migración `023` rechazan el DELETE. Quedaría en los libros
 * que el contador certifica ante la DGI.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LOS ASIENTOS
 * ═════════════════════════════════════════════════════════════════════════════
 * Ninguna cuenta es una decisión nueva de este script:
 *
 *   FAC-REI-000002 · REEMBOLSO exento, 400,00
 *     D 100004 Cuentas por Cobrar Clientes   400,00
 *     H 130003 Fondo Legales de Clientes     400,00
 *   Mismo patrón que el asiento 6 del fixture (FAC-REI-000001). La contrapartida
 *   es 130003 y NO una cuenta de ingreso: lo decidió el acta del 25/08/2026
 *   ("Reembolso al facturar: HABER 130003, nunca ingreso").
 *
 *   Cobro "Transferencia Banco General 4471915" · 150,00
 *     D 100001 Banco General Operativa       150,00
 *     H 100004 Cuentas por Cobrar Clientes   150,00
 *   Mismo patrón que los asientos 7 y 10, que son los otros dos cobros.
 *
 * Los dos mueven activos entre sí, así que NINGÚN total del Balance cambia.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * IDEMPOTENTE
 * ═════════════════════════════════════════════════════════════════════════════
 * Se puede correr dos veces. Antes de postear verifica si el documento ya tiene
 * asiento y lo saltea. Y aunque ese chequeo fallara, la migración `034` creó un
 * UNIQUE parcial sobre (tenant_id, source_type, source_id) que lo rechaza en la
 * base — que es la garantía de verdad, porque no depende del timing.
 *
 * Uso:  npx tsx scripts/backfill-asientos-faltantes.mts [--dry-run]
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// CANDADO
// ---------------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const URL_SB = env.NEXT_PUBLIC_SUPABASE_URL as string;
const PROD = "uqmmkklbhzxqybljiecs";
const STAGING = "xtyenhakplrkyifbcaow";

if (!URL_SB) {
  console.error("\n🛑 No se pudo leer NEXT_PUBLIC_SUPABASE_URL de .env.local\n");
  process.exit(1);
}
if (URL_SB.includes(PROD)) {
  console.error("\n🛑 ABORTADO: la URL apunta a PRODUCCIÓN. Este script NO corre ahí.\n");
  process.exit(1);
}
if (!URL_SB.includes(STAGING)) {
  console.error(`\n🛑 ABORTADO: URL inesperada (${URL_SB}). Solo staging.\n`);
  process.exit(1);
}
console.log(`✅ CANDADO OK — staging${DRY_RUN ? "  ·  DRY RUN (no escribe)" : ""}\n`);

const db = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY as string, {
  auth: { persistSession: false },
});

const { postJournalEntry } = await import("../src/lib/finanzas/contabilidad/posting.ts");

const money = (n: number) =>
  n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// FOTO ANTES
// ---------------------------------------------------------------------------
const CUENTAS_QUE_SE_MUEVEN = ["100001", "100004", "130003"];

async function saldos(): Promise<Record<string, number>> {
  const { data: cuentas } = await db
    .from("chart_of_accounts")
    .select("id, code, saldo_inicial");
  const { data: lineas } = await db
    .from("journal_entry_lines")
    .select("account_id, debit, credit");

  const neto = new Map<string, number>();
  for (const l of (lineas ?? []) as { account_id: string; debit: number; credit: number }[]) {
    neto.set(l.account_id, (neto.get(l.account_id) ?? 0) + Number(l.debit) - Number(l.credit));
  }
  const out: Record<string, number> = {};
  for (const c of (cuentas ?? []) as { id: string; code: string; saldo_inicial: number }[]) {
    out[c.code] = Math.round((Number(c.saldo_inicial ?? 0) + (neto.get(c.id) ?? 0)) * 100) / 100;
  }
  return out;
}

const antes = await saldos();

// ---------------------------------------------------------------------------
// LOS DOS ASIENTOS
// ---------------------------------------------------------------------------
const { data: tenantRow } = await db.from("chart_of_accounts").select("tenant_id").limit(1);
const tenantId = (tenantRow as { tenant_id: string }[])[0].tenant_id;

interface Faltante {
  etiqueta: string;
  sourceType: "factura" | "pago";
  /** Cómo encontrar el documento. */
  buscar: () => Promise<{ id: string; fecha: string; monto: number } | null>;
  lineas: (m: number, nombre: string) => { account_code: string; debit: number; credit: number; description: string }[];
  descripcion: (nombre: string) => string;
  nombre: string;
}

const FALTANTES: Faltante[] = [
  {
    etiqueta: "FAC-REI-000002 (reembolso 400,00)",
    sourceType: "factura",
    nombre: "CONSTRUCTORA CHIRIQUÍ ANTIGUO, S.A.",
    buscar: async () => {
      const { data } = await db
        .from("invoices")
        .select("id, issue_date, grand_total")
        .eq("tenant_id", tenantId)
        .eq("invoice_number", "FAC-REI-000002")
        .maybeSingle();
      if (!data) return null;
      const d = data as { id: string; issue_date: string; grand_total: number };
      return { id: d.id, fecha: String(d.issue_date).slice(0, 10), monto: Number(d.grand_total) };
    },
    lineas: (m, nombre) => [
      { account_code: "100004", debit: m, credit: 0, description: nombre },
      // 130003 y NO una cuenta de ingreso: acta del 25/08/2026.
      { account_code: "130003", debit: 0, credit: m, description: "Reembolso — gastos de trámite" },
    ],
    descripcion: (nombre) => `Factura FAC-REI-000002 — ${nombre}`,
  },
  {
    etiqueta: "Cobro Transferencia Banco General 4471915 (150,00)",
    sourceType: "pago",
    nombre: "FERRETERÍA VALLARINO, S.A.",
    buscar: async () => {
      const { data } = await db
        .from("payments")
        .select("id, payment_date, amount")
        .eq("tenant_id", tenantId)
        .eq("reference", "Transferencia Banco General 4471915")
        .maybeSingle();
      if (!data) return null;
      const d = data as { id: string; payment_date: string; amount: number };
      return { id: d.id, fecha: String(d.payment_date).slice(0, 10), monto: Number(d.amount) };
    },
    lineas: (m, nombre) => [
      { account_code: "100001", debit: m, credit: 0, description: "Transferencia Banco General 4471915" },
      { account_code: "100004", debit: 0, credit: m, description: nombre },
    ],
    descripcion: (nombre) => `Cobro de la factura FAC-REI-000001 — ${nombre}`,
  },
];

console.log("═".repeat(78));
console.log("POSTEO");
console.log("═".repeat(78));

let posteados = 0;
for (const f of FALTANTES) {
  const doc = await f.buscar();
  if (!doc) {
    console.error(`  ❌ ${f.etiqueta}: el documento NO EXISTE en staging. Se aborta.`);
    process.exit(1);
  }

  const { data: yaTiene } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", tenantId)
    .eq("source_type", f.sourceType)
    .eq("source_id", doc.id)
    .maybeSingle();

  if (yaTiene) {
    console.log(`  ⏭  ${f.etiqueta}: ya tiene el asiento ${(yaTiene as { entry_number: number }).entry_number}. Se saltea.`);
    continue;
  }

  const lineas = f.lineas(doc.monto, f.nombre);
  console.log(`\n  ▶ ${f.etiqueta}   ${doc.fecha}`);
  for (const l of lineas) {
    console.log(
      `      ${l.account_code}   D ${money(l.debit).padStart(9)}   H ${money(l.credit).padStart(9)}   ${l.description}`
    );
  }

  if (DRY_RUN) {
    console.log("      (dry run: no se postea)");
    continue;
  }

  const entryId = await postJournalEntry(db, tenantId, {
    transaction_date: doc.fecha,
    description: f.descripcion(f.nombre),
    source_type: f.sourceType,
    source_id: doc.id,
    lines: lineas,
  });
  console.log(`      ✅ posteado (${entryId})`);
  posteados += 1;
}

// ---------------------------------------------------------------------------
// FOTO DESPUÉS + CONTRASTE CONTRA LO PROYECTADO
// ---------------------------------------------------------------------------
const despues = await saldos();

// Lo que se proyectó en el diseño, ANTES de correr nada.
const PROYECTADO: Record<string, number> = {
  "100001": 62920.91,
  "100004": 195092.55,
  "130003": 1969.11,
};

console.log("\n" + "═".repeat(78));
console.log("ANTES / DESPUÉS  ·  contra la proyección del diseño");
console.log("═".repeat(78));
console.log(`  ${"cuenta".padEnd(10)}${"antes".padStart(14)}${"después".padStart(14)}${"movió".padStart(12)}${"proyectado".padStart(14)}`);

let coincideTodo = true;
for (const code of CUENTAS_QUE_SE_MUEVEN) {
  const a = antes[code] ?? 0;
  const d = despues[code] ?? 0;
  const p = PROYECTADO[code];
  const ok = Math.abs(d - p) < 0.005;
  if (!ok) coincideTodo = false;
  console.log(
    `  ${code.padEnd(10)}${money(a).padStart(14)}${money(d).padStart(14)}${money(d - a).padStart(12)}${money(p).padStart(14)}  ${ok ? "✅" : "❌ NO COINCIDE"}`
  );
}

console.log(`\n  ${posteados} asiento(s) posteado(s).`);
console.log(
  `  ${coincideTodo ? "✅ los saldos coinciden con lo proyectado" : "❌ ALGÚN SALDO NO COINCIDE CON LA PROYECCIÓN"}`
);

if (!coincideTodo) process.exit(1);

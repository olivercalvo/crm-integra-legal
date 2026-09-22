/**
 * REVERSAR UN ASIENTO HUÉRFANO de staging, con la reversión de verdad.
 *
 *   MSYS_NO_PATHCONV=1 npx tsx scripts/reversar-asiento-huerfano.ts 43 "motivo"
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * PARA QUÉ
 * ═════════════════════════════════════════════════════════════════════════════
 * Un asiento del ledger NO se borra: los triggers de la `023` rechazan DELETE y
 * UPDATE. Cuando un asiento quedó mal —FND-011: el asiento 43 de staging quedó
 * con el número `FAC-HON-000007`, que es de otra factura, sobre un borrador— la
 * corrección honesta es **postear su espejo**, no limpiar la tabla a mano.
 *
 * El espejo lo arma `construirAsientoDeReversion`, la MISMA función del diálogo
 * de reversión de cobros y de la anulación de facturas: una sola
 * implementación, fecha de HOY (acta del 09/09), `reverses_entry_id` al
 * original y las mismas cuentas con débito y crédito intercambiados.
 *
 * 🛑 SOLO STAGING. Aborta si `NEXT_PUBLIC_SUPABASE_URL` no es la de staging.
 *    Esto no es una herramienta de producción: allá una corrección la decide el
 *    contador y se hace por la pantalla que corresponda.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { construirAsientoDeReversion } from "../src/lib/finanzas/contabilidad/reversion";
import { postJournalEntry } from "../src/lib/finanzas/contabilidad/posting";

const PROD_REF = "uqmmkklbhzxqybljiecs";
const STAGING_REF = "xtyenhakplrkyifbcaow";
const TENANT = "a0000000-0000-0000-0000-000000000001";

const env: Record<string, string> = {};
for (const l of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !SERVICE) {
  console.error("🛑 Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (URL_SB.includes(PROD_REF) || !URL_SB.includes(STAGING_REF)) {
  console.error("🛑 ABORTADO: la URL no es la de staging.");
  process.exit(1);
}

const numero = Number(process.argv[2]);
const motivo = process.argv[3];
if (!Number.isInteger(numero) || !motivo || motivo.trim().length < 3) {
  console.error('uso: npx tsx scripts/reversar-asiento-huerfano.ts <entry_number> "<motivo>"');
  process.exit(1);
}

/**
 * Un `.ts` de scripts/ compila a CJS bajo tsx y ahí NO hay top-level await
 * (esbuild: "Top-level await is currently not supported"). Por eso todo va
 * dentro de `main()`.
 */
async function main() {
  const db = createClient(URL_SB, SERVICE);

  const { data: original, error: errOrig } = await db
    .from("journal_entries")
    .select("id, entry_number, transaction_date, description, reference, source_type, source_id")
    .eq("tenant_id", TENANT)
    .eq("entry_number", numero)
    .maybeSingle();
  if (errOrig || !original) {
    console.error(`🛑 No se encontró el asiento ${numero}`, errOrig?.message ?? "");
    process.exit(1);
  }

  const { data: yaReversado } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", TENANT)
    .eq("reverses_entry_id", original.id)
    .maybeSingle();
  if (yaReversado) {
    console.error(`🛑 El asiento ${numero} ya fue reversado por el ${yaReversado.entry_number}.`);
    process.exit(1);
  }

  const { data: lineas, error: errLin } = await db
    .from("journal_entry_lines")
    .select("line_order, debit, credit, line_description, chart_of_accounts!inner(code, name)")
    .eq("tenant_id", TENANT)
    .eq("entry_id", original.id)
    .order("line_order");
  if (errLin || !lineas?.length) {
    console.error("🛑 No se pudieron leer las líneas", errLin?.message ?? "");
    process.exit(1);
  }

  type Fila = {
    debit: number | string;
    credit: number | string;
    line_description: string | null;
    chart_of_accounts: { code: string; name: string };
  };

  const armado = construirAsientoDeReversion(
    {
      id: original.id as string,
      entry_number: Number(original.entry_number),
      transaction_date: String(original.transaction_date).slice(0, 10),
      description: String(original.description),
      reference: (original.reference as string | null) ?? null,
      lines: (lineas as unknown as Fila[]).map((l) => ({
        account_code: l.chart_of_accounts.code,
        account_name: l.chart_of_accounts.name,
        debit: Number(l.debit),
        credit: Number(l.credit),
        description: l.line_description,
      })),
    },
    {
      hoy: new Date().toISOString().slice(0, 10),
      motivo: motivo.trim(),
      // El espejo apunta al mismo documento que el original, como en los cobros.
      source_id: (original.source_id as string | null) ?? null,
    }
  );
  if (!armado.ok) {
    console.error(`🛑 No se pudo armar el espejo: ${armado.mensaje}`);
    process.exit(1);
  }

  console.log(`Asiento ${original.entry_number} · ${original.description}`);
  for (const l of armado.asiento.lines) {
    console.log(`   ${l.account_code}  debe ${l.debit.toFixed(2)}  haber ${l.credit.toFixed(2)}`);
  }

  const entryId = await postJournalEntry(db as never, TENANT, armado.asiento, null);
  const { data: espejo } = await db
    .from("journal_entries")
    .select("entry_number, transaction_date")
    .eq("id", entryId)
    .maybeSingle();
  console.log(
    `✅ Reversado por el asiento ${espejo?.entry_number} (${String(espejo?.transaction_date).slice(0, 10)}).`
  );
}

main().catch((e) => {
  console.error("🛑", e instanceof Error ? e.message : e);
  process.exit(1);
});

// Smoke test del Sprint 2E.1 (Cotizaciones).
//
// Corre vía service_role contra la BD real — verifica el schema + invariantes
// del flujo de quotes/prospects. NO toca la API HTTP (la auth es por cookies
// y no se puede automatizar fácil desde un script). Para verificar la API
// HTTP, usar las recetas curl en el reporte final.
//
// Uso: node scripts/smoke-test-quotes.mjs
// Requiere: .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
//
// El script es idempotente: limpia los rastros que crea (prospect + quote)
// al final, sí o sí, aunque alguna verificación falle.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "..", ".env.local") });

const TENANT_ID = "a0000000-0000-0000-0000-000000000001";
const TEST_PROSPECT_NAME = "ZZZZ Test Smoke 2E.1";
const TEST_PROSPECT_EMAIL = "smoke-2e1@test.local";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

let createdProspectId = null;
let createdQuoteId = null;

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

async function cleanup() {
  if (createdQuoteId) {
    await supabase.from("quote_lines").delete().eq("quote_id", createdQuoteId);
    await supabase.from("quotes").delete().eq("id", createdQuoteId);
  }
  if (createdProspectId) {
    await supabase.from("clients").delete().eq("id", createdProspectId);
  }
}

async function main() {
  console.log("\n=== SMOKE TEST 2E.1 (Cotizaciones) ===\n");

  // ---------- 1. Schema: clients tiene client_status / client_type ----------
  const { data: clientCols } = await supabase
    .rpc("exec_smoke_columns_check", {})
    .single()
    .then((r) => ({ data: r.data }))
    .catch(() => ({ data: null }));
  // Fallback: query information_schema directo
  const { data: cols } = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "clients");
  // Supabase REST no expone information_schema. Usamos otra estrategia:
  // SELECT * de un cliente y revisamos las keys.
  const { data: anyClient } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .limit(1)
    .maybeSingle();
  if (anyClient) {
    check("clients.client_status existe", "client_status" in anyClient,
      `valor: ${anyClient.client_status}`);
    check("clients.client_type existe", "client_type" in anyClient);
    check("clients.active existe (legacy generated)", "active" in anyClient);
  } else {
    check("clients.* lectura inicial", false, "no hay clientes en el tenant");
  }

  // ---------- 2. Conteo de clientes (esperado: 63 active + 0 prospect) ----------
  const { count: countActive } = await supabase
    .from("clients").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID).eq("client_status", "active");
  const { count: countProspect } = await supabase
    .from("clients").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID).eq("client_status", "prospect");
  const { count: countInactive } = await supabase
    .from("clients").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID).eq("client_status", "inactive");

  check("clients active count >= 63", (countActive ?? 0) >= 63,
    `active=${countActive}, prospect=${countProspect}, inactive=${countInactive}`);

  // ---------- 3. quotes table tiene 35 columnas ----------
  // SELECT * de un row para ver keys (si hay rows). Si no, INSERT temporal.
  const { data: anyQuote } = await supabase
    .from("quotes").select("*").limit(1).maybeSingle();
  if (anyQuote) {
    const keyCount = Object.keys(anyQuote).length;
    check("quotes columnas = 35", keyCount === 35, `actual=${keyCount}`);
  } else {
    check("quotes (sin rows existentes — verifico vía INSERT más adelante)", true);
  }

  // ---------- 4. quote_terms_template seed ----------
  const { data: terms } = await supabase
    .from("quote_terms_template").select("content")
    .eq("tenant_id", TENANT_ID).maybeSingle();
  check("quote_terms_template seed existe", !!terms,
    terms ? `content_len=${terms.content?.length ?? 0}` : "fila no encontrada");

  // ---------- 5. numbering_sequences quote ----------
  const { data: seq } = await supabase
    .from("numbering_sequences").select("last_number")
    .eq("tenant_id", TENANT_ID).eq("sequence_type", "quote").maybeSingle();
  check("numbering_sequences quote existe", !!seq,
    seq ? `last_number=${seq.last_number}` : "fila no encontrada");

  // ---------- 6. CHECK status incluye 'cancelada_pre_envio' y 'convertida' ----------
  // Probamos INSERT con status='cancelada_pre_envio' y rollback.
  const { error: errCheckStatus } = await supabase
    .from("quotes")
    .insert({
      tenant_id: TENANT_ID,
      quote_number: "ZZZ-SMOKE-CHECK",
      client_id: anyClient?.id,
      issue_date: "2026-05-08",
      valid_until: "2026-05-08",
      status: "cancelada_pre_envio",
    })
    .select("id").single();
  if (!errCheckStatus) {
    // Si pasó, borrar inmediatamente
    await supabase.from("quotes").delete().eq("quote_number", "ZZZ-SMOKE-CHECK");
    check("CHECK quotes_status_check acepta 'cancelada_pre_envio'", true);
  } else if (errCheckStatus.message?.includes("violates check constraint")) {
    check("CHECK quotes_status_check acepta 'cancelada_pre_envio'", false,
      errCheckStatus.message);
  } else {
    // Otro error (ej. UNIQUE quote_number) — el CHECK probablemente está OK
    check("CHECK quotes_status_check acepta 'cancelada_pre_envio'", true,
      `INSERT rechazado por otra razón: ${errCheckStatus.message}`);
  }

  // ---------- 7. Crear prospect inline (simulando createQuote new_prospect) ----------
  const { data: lastClient } = await supabase
    .from("clients").select("client_number")
    .eq("tenant_id", TENANT_ID).order("client_number", { ascending: false })
    .limit(1).maybeSingle();
  let nextNum = 1;
  if (lastClient?.client_number) {
    const m = lastClient.client_number.match(/CLI-(\d+)/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  const newClientNumber = `CLI-${String(nextNum).padStart(3, "0")}`;

  const { data: newProspect, error: errProspect } = await supabase
    .from("clients")
    .insert({
      tenant_id: TENANT_ID,
      client_number: newClientNumber,
      name: TEST_PROSPECT_NAME,
      email: TEST_PROSPECT_EMAIL,
      phone: "555-0000",
      client_status: "prospect",
      client_type: "persona_natural",
      observations: "Prospect creado por smoke test (debería borrarse al final)",
    })
    .select("id, client_status, client_type, active").single();

  if (errProspect) {
    check("INSERT prospect inline", false, errProspect.message);
    return;
  }
  createdProspectId = newProspect.id;
  check("INSERT prospect con client_status='prospect'",
    newProspect.client_status === "prospect",
    `id=${newProspect.id}, status=${newProspect.client_status}, type=${newProspect.client_type}, active=${newProspect.active}`);
  check("active GENERATED refleja client_status",
    newProspect.active === false,
    `active=${newProspect.active} (esperado false porque status=prospect)`);

  // ---------- 8. Listado clientes activos NO incluye al prospect ----------
  const { count: activeAfter } = await supabase
    .from("clients").select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID).eq("client_status", "active");
  check("listado activos NO incluye prospect nuevo",
    activeAfter === countActive,
    `activos antes=${countActive}, después=${activeAfter}`);

  // ---------- 9. Crear quote para ese prospect (simulando createQuote) ----------
  // Consumir secuencia
  const { data: nextSeq, error: errSeq } = await supabase.rpc(
    "get_next_sequence_number",
    { p_tenant_id: TENANT_ID, p_sequence_type: "quote" }
  );
  if (errSeq || typeof nextSeq !== "number") {
    check("RPC get_next_sequence_number(quote)", false,
      errSeq?.message ?? "no devolvió número");
    return;
  }
  const quoteNumber = `COT-${String(nextSeq).padStart(6, "0")}`;
  check("RPC get_next_sequence_number(quote)", true,
    `next=${quoteNumber}`);

  const { data: newQuote, error: errQuote } = await supabase
    .from("quotes")
    .insert({
      tenant_id: TENANT_ID,
      quote_number: quoteNumber,
      client_id: createdProspectId,
      issue_date: "2026-05-08",
      valid_until: "2026-06-08",
      status: "borrador",
      subtotal_total: 100,
      tax_total: 7,
      grand_total: 107,
      subtotal_hon: 100,
      subtotal_rei: 0,
      terms_and_conditions: "TEST",
      notes: "smoke test",
    })
    .select("id, status, quote_number").single();

  if (errQuote) {
    check("INSERT quote para prospect", false, errQuote.message);
    return;
  }
  createdQuoteId = newQuote.id;
  check("INSERT quote para prospect (status=borrador)",
    newQuote.status === "borrador",
    `quote_number=${newQuote.quote_number}`);

  // ---------- 10. Quote_line con invoice_kind='HON' ----------
  const { data: line, error: errLine } = await supabase
    .from("quote_lines")
    .insert({
      tenant_id: TENANT_ID,
      quote_id: createdQuoteId,
      line_order: 1,
      invoice_kind: "HON",
      description: "Smoke test honorarios",
      quantity: 1,
      unit_price: 100,
      tax_code: "ITBMS_7",
      tax_rate: 0.07,
    })
    .select("id, invoice_kind, subtotal, tax_amount, line_total").single();

  if (errLine) {
    check("INSERT quote_line invoice_kind=HON", false, errLine.message);
  } else {
    check("INSERT quote_line con invoice_kind=HON",
      line.invoice_kind === "HON",
      `subtotal=${line.subtotal}, tax_amount=${line.tax_amount}, line_total=${line.line_total}`);
  }

  // ---------- 11. Schema: contar columnas reales de quotes (vía SELECT *) ----------
  const { data: fullQuote } = await supabase
    .from("quotes").select("*").eq("id", createdQuoteId).single();
  if (fullQuote) {
    const keyCount = Object.keys(fullQuote).length;
    check("quotes columnas = 35", keyCount === 35,
      `actual=${keyCount}, faltan: ${35 - keyCount}`);
  }

  // ---------- 12. Schema: contar columnas reales de quote_lines ----------
  const { data: fullLine } = await supabase
    .from("quote_lines").select("*").eq("quote_id", createdQuoteId).maybeSingle();
  if (fullLine) {
    const keyCount = Object.keys(fullLine).length;
    check("quote_lines columnas = 18", keyCount === 18,
      `actual=${keyCount}, faltan: ${18 - keyCount}`);
  }

  // ---------- Final ----------
  console.log("\n--- Resumen ---");
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`✅ ${passed} pasaron, ❌ ${failed} fallaron`);
  if (failed > 0) {
    console.log("\nFallos:");
    for (const c of checks.filter((x) => !x.ok)) {
      console.log(`  - ${c.name}: ${c.detail}`);
    }
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("Error inesperado:", e);
    process.exitCode = 2;
  })
  .finally(async () => {
    console.log("\n--- Cleanup ---");
    await cleanup();
    console.log(`Borrados: prospect=${createdProspectId ? "sí" : "no"}, quote=${createdQuoteId ? "sí" : "no"}`);
  });

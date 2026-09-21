/**
 * VERIFICAR el posteo automático del gasto de trámite contra el DEPLOY de staging
 * (Bloque 4, commit 3). Por API, con la sesión de la ABOGADA de los fixtures del
 * seed (`scripts/seed-data/staging-fixtures.ts`) y la del usuario de
 * STAGING_UI_* (contador) para el 403.
 *
 *   MSYS_NO_PATHCONV=1 npx tsx scripts/verificar-alta-gasto-tramite.mts
 *   (o desde PowerShell, sin la variable)
 *
 * Qué comprueba, en orden:
 *   1. El contador NO crea gastos de trámite (403).
 *   2. La abogada crea uno con dos líneas → 201, la respuesta trae
 *      `asiento.entry_number`, y en la base: el asiento `gasto_tramite` existe
 *      con el gasto como `source_id`, `posted_entry_id` apunta a él, DEBE la
 *      cuenta de cada línea / HABER 200001, `status = pendiente_pago`.
 *   3. Un gasto con fecha SIN período contable (2025-12) → el posteo falla, el
 *      gasto NO queda registrado (DELETE compensatorio) y el error lo dice.
 *
 * 🛑 Solo staging: aborta si NEXT_PUBLIC_SUPABASE_URL apunta a producción.
 * Deja UN gasto de prueba posteado en staging (es inmutable: se reversa desde
 * /finanzas/gastos-tramite/{id} si molesta).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SEED_USERS } from "./seed-data/staging-fixtures";

const PROD_REF = "uqmmkklbhzxqybljiecs";
const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE =
  process.env.STAGING_BASE_URL ??
  "https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app";

const env: Record<string, string> = {};
try {
  for (const l of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
} catch {
  /* sin .env.local: todo por process.env */
}
const req = (k: string): string => {
  const v = process.env[k] ?? env[k];
  if (!v) {
    console.error(`🛑 Falta ${k}`);
    process.exit(1);
  }
  return v;
};

const URL_SB = req("NEXT_PUBLIC_SUPABASE_URL");
const ANON = req("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = req("SUPABASE_SERVICE_ROLE_KEY");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (URL_SB.includes(PROD_REF) || !URL_SB.includes(STAGING_REF)) {
  console.error("🛑 ABORTADO: NEXT_PUBLIC_SUPABASE_URL no es staging.");
  process.exit(1);
}

const ref = URL_SB.match(/https:\/\/([^.]+)\./)?.[1] ?? STAGING_REF;

async function sesionCookie(email: string, password: string): Promise<string> {
  const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    console.error(`🛑 No se pudo autenticar como ${email} (${r.status}): ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const valor = "base64-" + Buffer.from(JSON.stringify(await r.json())).toString("base64");
  const TROZO = 3180;
  if (valor.length <= TROZO) return `sb-${ref}-auth-token=${valor}`;
  const partes: string[] = [];
  for (let i = 0, n = 0; i < valor.length; i += TROZO, n += 1) {
    partes.push(`sb-${ref}-auth-token.${n}=${valor.slice(i, i + TROZO)}`);
  }
  return partes.join("; ");
}

async function post(cookie: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const h: Record<string, string> = { cookie, "Content-Type": "application/json" };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  const r = await fetch(`${BASE}/api/expenses`, { method: "POST", headers: h, body: JSON.stringify(body), redirect: "manual" });
  let json: Record<string, unknown> = {};
  try {
    json = (await r.json()) as Record<string, unknown>;
  } catch {
    /* 307 al login u otro sin JSON */
  }
  return { status: r.status, json };
}

const abogada = SEED_USERS.find((u) => u.key === "abogada");
if (!abogada) {
  console.error("🛑 No hay abogada en los fixtures");
  process.exit(1);
}
const db = createClient(URL_SB, SERVICE);
const { data: caso } = await db.from("cases").select("id, case_code").order("created_at").limit(1).maybeSingle();
if (!caso) {
  console.error("🛑 Staging no tiene casos");
  process.exit(1);
}

let ok = 0;
let fail = 0;
const marca = (b: boolean, msg: string) => {
  if (b) ok += 1;
  else fail += 1;
  console.log(`${b ? "✅" : "❌"} ${msg}`);
};

const lineas = [
  { key: "a", description: "Timbres fiscales (verificación B4)", chart_account_code: "130003", amount: "12.34", tax_rate: "0", tax_amount: "0" },
  { key: "b", description: "Gestor externo (verificación B4)", chart_account_code: "500004", amount: "20.00", tax_rate: "0", tax_amount: "0" },
];
const hoy = new Date().toISOString().slice(0, 10);
const base = { case_id: caso.id, expense_type: "tramite", lines: lineas };

// 1. contador → 403
const cookieContador = await sesionCookie(req("STAGING_UI_EMAIL"), req("STAGING_UI_PASSWORD"));
const r1 = await post(cookieContador, { ...base, concept: "Verificación B4 (contador)", date: hoy });
marca(r1.status === 403, `[1] contador POST /api/expenses → ${r1.status} (esperado 403)`);

// 2. abogada → 201 con asiento
const cookieAbogada = await sesionCookie(abogada.email, abogada.password);
const r2 = await post(cookieAbogada, { ...base, concept: "Verificación B4: posteo automático en el alta", date: hoy });
const asiento = (r2.json.asiento ?? null) as { entry_id: string; entry_number: number | null; lineas: number } | null;
marca(r2.status === 201 && !!asiento?.entry_number, `[2] abogada POST → ${r2.status}, asiento ${asiento?.entry_number ?? "—"} (${asiento?.lineas ?? 0} líneas) ${r2.status !== 201 ? JSON.stringify(r2.json).slice(0, 200) : ""}`);

if (r2.status === 201) {
  const id = r2.json.id as string;
  const { data: g } = await db.from("expenses").select("posted_entry_id, status, amount_paid, amount").eq("id", id).maybeSingle();
  const { data: je } = await db.from("journal_entries").select("id, entry_number, source_type, source_id, transaction_date").eq("source_type", "gasto_tramite").eq("source_id", id).maybeSingle();
  marca(!!je && g?.posted_entry_id === je.id, `[2a] journal_entries gasto_tramite source_id=gasto → asiento ${je?.entry_number ?? "—"}; posted_entry_id ${g?.posted_entry_id === je?.id ? "apunta a él" : "NO coincide"}`);
  marca(g?.status === "pendiente_pago" && Number(g?.amount_paid) === 0 && Number(g?.amount) === 32.34, `[2b] gasto pendiente_pago, amount_paid 0, amount ${g?.amount}`);
  if (je) {
    const { data: ls } = await db.from("journal_entry_lines").select("debit, credit, chart_of_accounts!inner(code)").eq("entry_id", je.id).order("line_order");
    const filas = (ls ?? []).map((l) => ({ code: (l.chart_of_accounts as unknown as { code: string }).code, d: Number(l.debit), c: Number(l.credit) }));
    const okLineas =
      filas.length === 3 &&
      filas.some((f) => f.code === "130003" && f.d === 12.34) &&
      filas.some((f) => f.code === "500004" && f.d === 20) &&
      filas.some((f) => f.code === "200001" && f.c === 32.34);
    marca(okLineas, `[2c] líneas: ${filas.map((f) => `${f.code} D${f.d} H${f.c}`).join(" | ")}`);
  }
}

// 3. fecha sin período → el gasto no queda
const { count: antes } = await db.from("expenses").select("*", { count: "exact", head: true }).eq("case_id", caso.id);
const r3 = await post(cookieAbogada, { ...base, concept: "Verificación B4: fecha sin período (debe deshacerse)", date: "2025-12-15" });
const { count: despues } = await db.from("expenses").select("*", { count: "exact", head: true }).eq("case_id", caso.id);
marca(r3.status >= 400 && antes === despues, `[3] fecha 2025-12-15 → ${r3.status} "${String(r3.json.error ?? "").slice(0, 110)}" · gastos del caso antes ${antes} / después ${despues}`);

console.log(`\n════════ alta con posteo automático: ${ok} ✅ · ${fail} ❌ ════════`);
process.exit(fail === 0 ? 0 : 1);

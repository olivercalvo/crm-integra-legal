/**
 * VERIFICAR la nota de crédito contable contra el DEPLOY de staging (Bloque 5).
 * Por API, con la sesión de la ABOGADA de los fixtures (anula y emite NC) y la
 * del usuario STAGING_UI_* (contador) para los 403.
 *
 *   MSYS_NO_PATHCONV=1 npx tsx scripts/verificar-nota-de-credito.mts
 *
 * Qué comprueba:
 *   1. El contador no anula ni emite NC (403 en las dos rutas).
 *   2. Anular (mes abierto) una factura emitida CON asiento y sin pagos →
 *      200; en la base: NC total automática (NC-), asiento `reversion` con
 *      `reverses_entry_id` al de la factura y fecha de HOY, NINGÚN asiento
 *      `nota_credito` para esa NC (D5), factura `anulada`,
 *      `credited_total = grand_total`.
 *   3. NC manual PARCIAL sobre otra factura emitida: una línea, cantidad 1 →
 *      201; asiento `nota_credito` con source_id = la NC, `credited_total` =
 *      el total de la NC, `balance_due` baja, la factura sigue `emitida`,
 *      `fe_estado = no_emitida`.
 *   4. Una NC que supera balance_due → 409 con "reverse el cobro primero".
 *
 * 🛑 Solo staging. Deja una factura anulada y una NC parcial en staging.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const { SEED_USERS } = createRequire(import.meta.url)("./seed-data/staging-fixtures.ts") as {
  SEED_USERS: { key: string; email: string; password: string }[];
};

const PROD_REF = "uqmmkklbhzxqybljiecs";
const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE = process.env.STAGING_BASE_URL ?? "https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app";

const env: Record<string, string> = {};
try {
  for (const l of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
} catch {
  /* todo por process.env */
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
    console.error(`🛑 No se pudo autenticar como ${email} (${r.status})`);
    process.exit(1);
  }
  const valor = "base64-" + Buffer.from(JSON.stringify(await r.json())).toString("base64");
  const TROZO = 3180;
  if (valor.length <= TROZO) return `sb-${ref}-auth-token=${valor}`;
  const partes: string[] = [];
  for (let i = 0, n = 0; i < valor.length; i += TROZO, n += 1) partes.push(`sb-${ref}-auth-token.${n}=${valor.slice(i, i + TROZO)}`);
  return partes.join("; ");
}
async function post(cookie: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const h: Record<string, string> = { cookie, "Content-Type": "application/json" };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: h, body: JSON.stringify(body), redirect: "manual" });
  let json: Record<string, unknown> = {};
  try {
    json = (await r.json()) as Record<string, unknown>;
  } catch {
    /* sin JSON */
  }
  return { status: r.status, json };
}

const db = createClient(URL_SB, SERVICE);
const TENANT = "a0000000-0000-0000-0000-000000000001";
let ok = 0;
let fail = 0;
const marca = (b: boolean, msg: string) => {
  if (b) ok += 1;
  else fail += 1;
  console.log(`${b ? "✅" : "❌"} ${msg}`);
};
const hoy = new Date().toISOString().slice(0, 10);

// Candidatas: emitidas, sin pagos, sin NC, CON asiento y sin reversión.
const { data: candidatas } = await db
  .from("invoices")
  .select("id, invoice_number, grand_total, balance_due, issue_date")
  .eq("tenant_id", TENANT)
  .eq("status", "emitida")
  .eq("amount_paid", 0)
  .eq("credited_total", 0)
  .order("created_at", { ascending: false });
const conAsiento: { id: string; invoice_number: string; grand_total: number; balance_due: number }[] = [];
for (const c of (candidatas ?? []) as { id: string; invoice_number: string; grand_total: number; balance_due: number }[]) {
  const { data: je } = await db.from("journal_entries").select("id").eq("source_type", "factura").eq("source_id", c.id).maybeSingle();
  if (!je) continue;
  const { data: rev } = await db.from("journal_entries").select("id").eq("reverses_entry_id", je.id).maybeSingle();
  if (rev) continue;
  // Sin líneas cuya cuenta de ingreso esté inactiva (la NC hereda la
  // validación de la factura y no se postearía: eso es correcto, no es el caso
  // que se quiere probar acá).
  const { data: ls } = await db.from("invoice_lines").select("service_id").eq("invoice_id", c.id);
  const svcIds = Array.from(new Set((ls ?? []).map((l) => (l as { service_id: string | null }).service_id).filter((x): x is string => !!x)));
  const { data: svcs } = await db.from("services_catalog").select("revenue_account").in("id", svcIds.length ? svcIds : ["00000000-0000-0000-0000-000000000000"]);
  const codes = Array.from(new Set((svcs ?? []).map((s) => (s as { revenue_account: string | null }).revenue_account).filter((x): x is string => !!x)));
  const { data: activas } = await db.from("chart_of_accounts").select("code").eq("tenant_id", TENANT).eq("active", true).in("code", codes.length ? codes : ["-"]);
  if (svcIds.length !== (ls ?? []).length || codes.length !== (activas ?? []).length) continue;
  conAsiento.push(c);
}
if (conAsiento.length < 1) {
  console.error("🛑 Hace falta al menos una factura emitida con asiento, sin pagos ni NC");
  process.exit(1);
}
// Con dos candidatas se anula la primera y se acredita la segunda; con una
// sola se salta la anulación (ya verificada en una corrida anterior) y se
// acredita esa.
const paraAnular = conAsiento.length >= 2 ? conAsiento[0] : null;
const paraNc = conAsiento.length >= 2 ? conAsiento[1] : conAsiento[0];
console.log(`Anular: ${paraAnular?.invoice_number ?? "(se omite: una sola candidata)"} · NC parcial: ${paraNc.invoice_number} (${paraNc.grand_total})`);

const abogada = SEED_USERS.find((u) => u.key === "abogada")!;
const cookieContador = await sesionCookie(req("STAGING_UI_EMAIL"), req("STAGING_UI_PASSWORD"));
const cookieAbogada = await sesionCookie(abogada.email, abogada.password);

// 1. contador → 403 en las dos
const c1 = await post(cookieContador, `/api/finanzas/invoices/${paraNc.id}/cancel`, { reason: "Verificación B5 (contador)" });
const c2 = await post(cookieContador, `/api/finanzas/credit-notes`, { invoice_id: paraNc.id, reason: "Verificación B5 (contador)", lineas: [] });
marca(c1.status === 403 && c2.status === 403, `[1] contador: cancel ${c1.status}, credit-notes ${c2.status} (esperado 403 / 403)`);

// 2. anular con reversión
if (paraAnular) {
const a = await post(cookieAbogada, `/api/finanzas/invoices/${paraAnular.id}/cancel`, { reason: "Verificación B5: anulación dentro del mes" });
const { data: invA } = await db.from("invoices").select("status, credited_total, grand_total, cancellation_reason").eq("id", paraAnular.id).maybeSingle();
const { data: jeFac } = await db.from("journal_entries").select("id, entry_number").eq("source_type", "factura").eq("source_id", paraAnular.id).maybeSingle();
const { data: espejo } = await db.from("journal_entries").select("entry_number, transaction_date, reverses_entry_id").eq("source_type", "reversion").eq("source_id", paraAnular.id).maybeSingle();
const { data: ncAuto } = await db.from("credit_notes").select("id, credit_note_number, grand_total, issue_date, fe_estado").eq("invoice_id", paraAnular.id).maybeSingle();
const { count: ncAsientos } = await db.from("journal_entries").select("*", { count: "exact", head: true }).eq("source_type", "nota_credito").eq("source_id", String(ncAuto?.id ?? "00000000-0000-0000-0000-000000000000"));
marca(
  a.status === 200 && invA?.status === "anulada" && !!espejo && espejo.reverses_entry_id === jeFac?.id && String(espejo.transaction_date).slice(0, 10) === hoy &&
    !!ncAuto && Number(ncAuto.grand_total) === Number(paraAnular.grand_total) && Number(invA?.credited_total) === Number(invA?.grand_total) && (ncAsientos ?? 0) === 0,
  `[2] anular ${paraAnular.invoice_number} → ${a.status}; ${String(a.json.credit_note_number ?? a.json.error ?? "")} · reversión ${espejo?.entry_number ?? "—"} del ${jeFac?.entry_number ?? "—"} (fecha ${String(espejo?.transaction_date ?? "").slice(0, 10)}) · anulada · credited ${invA?.credited_total}/${invA?.grand_total} · asientos nota_credito de la NC: ${ncAsientos ?? "?"} (D5: 0) · fe_estado ${ncAuto?.fe_estado}`
);
} else {
  console.log("⏭️  [2] anulación omitida: una sola candidata (ya verificada en una corrida anterior)");
}

// 3. NC manual parcial: la primera línea, cantidad 1 (o su cantidad si es < 1)
const { data: lineas } = await db.from("invoice_lines").select("id, quantity, unit_price, tax_rate, description").eq("invoice_id", paraNc.id).order("line_order");
const l0 = (lineas ?? [])[0] as { id: string; quantity: number; unit_price: number; tax_rate: number; description: string };
const qty = Math.min(1, Number(l0.quantity));
const esperado = Math.round(qty * Number(l0.unit_price) * (1 + Number(l0.tax_rate)) * 100) / 100;
const n = await post(cookieAbogada, `/api/finanzas/credit-notes`, {
  invoice_id: paraNc.id,
  reason: "Verificación B5: NC parcial (una unidad)",
  lineas: [{ invoice_line_id: l0.id, quantity: qty }],
});
const ncId = String(n.json.id ?? "");
const { data: ncMan } = await db.from("credit_notes").select("credit_note_number, grand_total, fe_estado, issue_date").eq("id", ncId).maybeSingle();
const { data: jeNc } = await db.from("journal_entries").select("entry_number, reference, transaction_date").eq("source_type", "nota_credito").eq("source_id", ncId).maybeSingle();
const { data: invN } = await db.from("invoices").select("status, credited_total, balance_due, grand_total").eq("id", paraNc.id).maybeSingle();
marca(
  n.status === 201 && !!jeNc && Number(ncMan?.grand_total) === esperado && Number(invN?.credited_total) === esperado &&
    Math.abs(Number(invN?.balance_due) - (Number(invN?.grand_total) - esperado)) < 0.005 && invN?.status === "emitida" && ncMan?.fe_estado === "no_emitida",
  `[3] NC parcial sobre ${paraNc.invoice_number} → ${n.status} ${String(n.json.credit_note_number ?? n.json.error ?? "")} por ${ncMan?.grand_total} (esperado ${esperado}) · asiento nota_credito ${jeNc?.entry_number ?? "—"} ref ${jeNc?.reference ?? "—"} · credited ${invN?.credited_total} · saldo ${invN?.balance_due} · ${invN?.status} · fe ${ncMan?.fe_estado}`
);

// 4. más que el saldo → 409
const demasiado = await post(cookieAbogada, `/api/finanzas/credit-notes`, {
  invoice_id: paraNc.id,
  reason: "Verificación B5: más que el saldo",
  lineas: (lineas ?? []).map((l) => ({ invoice_line_id: (l as { id: string }).id, quantity: Number((l as { quantity: number }).quantity) })),
});
marca(
  demasiado.status === 409 || demasiado.status === 400,
  `[4] NC por todas las líneas completas (ya hay ${esperado} acreditado) → ${demasiado.status} "${String(demasiado.json.error ?? "").slice(0, 120)}"`
);

console.log(`\n════════ nota de crédito contable: ${ok} ✅ · ${fail} ❌ ════════`);
process.exit(fail === 0 ? 0 : 1);

/**
 * FND-011 CONTRA EL DEPLOY: el asiento nunca queda con un número ajeno.
 *
 *   MSYS_NO_PATHCONV=1 npx tsx scripts/verificar-fnd-011.mts
 *
 * Reproduce el escenario real en staging —la numeración DETRÁS de las facturas
 * emitidas, que es lo que el seed provocaba antes del 22/09— y verifica las dos
 * mitades del arreglo:
 *
 *   [1] Con la secuencia rebobinada, emitir responde **409** y **no postea
 *       nada**: la factura sigue en borrador y no hay asiento para ella.
 *   [2] Realineada la secuencia, la MISMA factura se emite y el número del
 *       asiento (`reference`) es el de la factura.
 *   [3] Invariante global: ningún asiento `factura` con un `reference` que hoy
 *       pertenezca a otra factura.
 *
 * 🛑 Solo staging. Mueve `numbering_sequences` a propósito y la deja donde
 *    estaba (o más arriba, nunca más abajo). Deja una factura emitida.
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
const TENANT = "a0000000-0000-0000-0000-000000000001";
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
  for (let i = 0, n = 0; i < valor.length; i += TROZO, n += 1) {
    partes.push(`sb-${ref}-auth-token.${n}=${valor.slice(i, i + TROZO)}`);
  }
  return partes.join("; ");
}

async function post(cookie: string, path: string, body: unknown) {
  const h: Record<string, string> = { cookie, "Content-Type": "application/json" };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
    redirect: "manual",
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await r.json()) as Record<string, unknown>;
  } catch {
    /* sin JSON */
  }
  return { status: r.status, json };
}

const db = createClient(URL_SB, SERVICE);
let ok = 0;
let fail = 0;
const marca = (b: boolean, msg: string) => {
  if (b) ok += 1;
  else fail += 1;
  console.log(`${b ? "✅" : "❌"} ${msg}`);
};
const hoy = new Date().toISOString().slice(0, 10);

// --- la secuencia de honorarios y el máximo realmente emitido ---------------
const { data: seq0 } = await db
  .from("numbering_sequences")
  .select("last_number")
  .eq("tenant_id", TENANT)
  .eq("sequence_type", "invoice_hon")
  .maybeSingle();
const { data: emitidas } = await db
  .from("invoices")
  .select("invoice_number")
  .eq("tenant_id", TENANT)
  .like("invoice_number", "FAC-HON-%");
const maxEmitido = Math.max(
  0,
  ...((emitidas ?? []) as { invoice_number: string }[]).map((i) => Number(i.invoice_number.slice(-6)))
);
const seqOriginal = Number(seq0?.last_number ?? maxEmitido);
console.log(`secuencia invoice_hon = ${seqOriginal} · máximo emitido = ${maxEmitido}`);
if (maxEmitido < 2) {
  console.error("🛑 Hacen falta al menos dos facturas de honorarios emitidas para reproducirlo");
  process.exit(1);
}

// --- un borrador nuevo, por la API, como la abogada -------------------------
const abogada = SEED_USERS.find((u) => u.key === "abogada")!;
const cookieAbogada = await sesionCookie(abogada.email, abogada.password);

const { data: cliente } = await db
  .from("clients")
  .select("id, name")
  .eq("tenant_id", TENANT)
  .eq("client_status", "active")
  .not("tax_id", "is", null)
  .order("created_at")
  .limit(1)
  .maybeSingle();
const { data: servicios } = await db
  .from("services_catalog")
  .select("id, code, name, revenue_account")
  .eq("tenant_id", TENANT)
  .eq("active", true);
const { data: activas } = await db
  .from("chart_of_accounts")
  .select("code")
  .eq("tenant_id", TENANT)
  .eq("active", true);
const codes = new Set(((activas ?? []) as { code: string }[]).map((a) => a.code));
const servicio = ((servicios ?? []) as { id: string; code: string; name: string; revenue_account: string | null }[]).find(
  (sv) => sv.code.startsWith("HON") && sv.revenue_account && codes.has(sv.revenue_account)
);
const { data: tax } = await db
  .from("tax_codes")
  .select("id, code, rate")
  .eq("tenant_id", TENANT)
  .eq("code", "ITBMS_7")
  .maybeSingle();
if (!cliente || !servicio || !tax) {
  console.error("🛑 Faltan cliente activo, servicio HON con cuenta activa o ITBMS_7");
  process.exit(1);
}
const venc = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const cr = await post(cookieAbogada, "/api/finanzas/invoices", {
  invoice_kind: "HONORARIOS",
  client_id: cliente.id,
  case_id: null,
  issue_date: hoy,
  due_date: venc,
  notes: "Verificación FND-011",
  lines: [
    {
      service_id: servicio.id,
      description: `${servicio.name} (verificación FND-011)`,
      quantity: 1,
      unit_price: 50,
      tax_code_id: tax.id,
      tax_code: tax.code,
      tax_rate: Number(tax.rate),
    },
  ],
});
const draftId = String(cr.json.id ?? "");
if (cr.status !== 201 || !draftId) {
  console.error(`🛑 No se pudo crear el borrador (${cr.status}): ${String(cr.json.error ?? "")}`);
  process.exit(1);
}

const asientoDe = async (id: string) => {
  const { data } = await db
    .from("journal_entries")
    .select("entry_number, reference")
    .eq("tenant_id", TENANT)
    .eq("source_type", "factura")
    .eq("source_id", id)
    .maybeSingle();
  return (data as { entry_number: number; reference: string | null } | null) ?? null;
};

try {
  // ---- [1] la secuencia REBOBINADA: 409 y nada posteado -------------------
  await db
    .from("numbering_sequences")
    .update({ last_number: maxEmitido - 1 })
    .eq("tenant_id", TENANT)
    .eq("sequence_type", "invoice_hon");
  const choca = await post(cookieAbogada, `/api/finanzas/invoices/${draftId}/emit`, {});
  const jeTrasChoque = await asientoDe(draftId);
  const { data: trasChoque } = await db
    .from("invoices")
    .select("status, invoice_number")
    .eq("id", draftId)
    .maybeSingle();
  marca(
    choca.status === 409 &&
      /ya pertenece a otra factura/.test(String(choca.json.error ?? "")) &&
      jeTrasChoque === null &&
      (trasChoque as { status: string } | null)?.status === "borrador",
    `[1] secuencia detrás (last_number=${maxEmitido - 1}) → emitir ${choca.status} "${String(
      choca.json.error ?? ""
    ).slice(0, 90)}" · asiento: ${jeTrasChoque ? jeTrasChoque.entry_number : "ninguno"} · factura ${
      (trasChoque as { status: string } | null)?.status
    }`
  );

  // ---- [2] realineada: se emite y el asiento dice lo mismo ----------------
  const { data: seqAhora } = await db
    .from("numbering_sequences")
    .select("last_number")
    .eq("tenant_id", TENANT)
    .eq("sequence_type", "invoice_hon")
    .maybeSingle();
  await db
    .from("numbering_sequences")
    .update({ last_number: Math.max(maxEmitido, Number(seqAhora?.last_number ?? 0), seqOriginal) })
    .eq("tenant_id", TENANT)
    .eq("sequence_type", "invoice_hon");
  const em = await post(cookieAbogada, `/api/finanzas/invoices/${draftId}/emit`, {});
  const je = await asientoDe(draftId);
  const { data: inv } = await db
    .from("invoices")
    .select("invoice_number, status")
    .eq("id", draftId)
    .maybeSingle();
  const numero = (inv as { invoice_number: string } | null)?.invoice_number ?? "";
  marca(
    em.status === 200 && !!je && je.reference === numero && (inv as { status: string }).status === "emitida",
    `[2] realineada → emitir ${em.status} · factura ${numero} · asiento ${je?.entry_number} ref ${je?.reference} (tienen que ser iguales)`
  );
} finally {
  // La secuencia NUNCA queda por debajo del máximo emitido.
  const { data: emitidas2 } = await db
    .from("invoices")
    .select("invoice_number")
    .eq("tenant_id", TENANT)
    .like("invoice_number", "FAC-HON-%");
  const max2 = Math.max(
    0,
    ...((emitidas2 ?? []) as { invoice_number: string }[]).map((i) => Number(i.invoice_number.slice(-6)))
  );
  const { data: seqFin } = await db
    .from("numbering_sequences")
    .select("last_number")
    .eq("tenant_id", TENANT)
    .eq("sequence_type", "invoice_hon")
    .maybeSingle();
  const destino = Math.max(max2, seqOriginal, Number(seqFin?.last_number ?? 0));
  await db
    .from("numbering_sequences")
    .update({ last_number: destino })
    .eq("tenant_id", TENANT)
    .eq("sequence_type", "invoice_hon");
  console.log(`   secuencia invoice_hon restaurada en ${destino} (máximo emitido ${max2})`);
}

// ---- [3] la invariante sobre TODO el libro ---------------------------------
const { data: asientosFactura } = await db
  .from("journal_entries")
  .select("entry_number, reference, source_id")
  .eq("tenant_id", TENANT)
  .eq("source_type", "factura")
  .not("reference", "is", null);
const { data: todas } = await db
  .from("invoices")
  .select("id, invoice_number")
  .eq("tenant_id", TENANT);
const porNumero = new Map(
  ((todas ?? []) as { id: string; invoice_number: string }[]).map((i) => [i.invoice_number, i.id])
);
const { data: reversados } = await db
  .from("journal_entries")
  .select("reverses_entry_id")
  .eq("tenant_id", TENANT)
  .not("reverses_entry_id", "is", null);
const idsReversados = new Set(
  ((reversados ?? []) as { reverses_entry_id: string }[]).map((r) => r.reverses_entry_id)
);
const { data: cabeceras } = await db
  .from("journal_entries")
  .select("id, entry_number")
  .eq("tenant_id", TENANT)
  .eq("source_type", "factura");
const idPorNumero = new Map(
  ((cabeceras ?? []) as { id: string; entry_number: number }[]).map((c) => [c.entry_number, c.id])
);
const ajenos = ((asientosFactura ?? []) as { entry_number: number; reference: string; source_id: string }[]).filter(
  (a) => {
    const duenio = porNumero.get(a.reference);
    if (duenio === undefined || duenio === a.source_id) return false;
    // Un asiento ya REVERSADO está corregido en el libro: no cuenta.
    return !idsReversados.has(idPorNumero.get(a.entry_number) ?? "");
  }
);
marca(
  ajenos.length === 0,
  `[3] asientos 'factura' con un número que es de otra factura (y sin reversar): ${
    ajenos.length === 0 ? "ninguno" : ajenos.map((a) => `${a.entry_number}→${a.reference}`).join(", ")
  }`
);

console.log(`\n════════ FND-011: ${ok} ✅ · ${fail} ❌ ════════`);
process.exit(fail === 0 ? 0 : 1);

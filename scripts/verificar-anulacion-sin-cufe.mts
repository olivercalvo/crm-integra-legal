/**
 * Prueba en STAGING de la anulación de una factura SIN CUFE (06/10/2026).
 *
 *   npx tsx scripts/verificar-anulacion-sin-cufe.mts [FAC-HON-000030]   (con `npm run dev` arriba)
 *
 * Es el caso de FAC-HON-000489 y FAC-HON-000503 de producción: emitida, sin
 * CUFE, sin cobros, mes abierto. Antes, si el libro fallaba, el mensaje decía
 * «El documento quedó ANULADO ante la DGI» sin haberle hablado al PAC.
 *
 * A. FALLA FORZADA DEL LIBRO. Se corre el orquestador REAL contra staging con
 *    el cliente de servicio envuelto: la llamada a `cancel_invoice_with_reversal`
 *    sale con la primera línea descuadrada en B/. 1.00. La base la rechaza de
 *    verdad y la NC total se compensa de verdad. Nada de DDL en staging.
 *    Se verifica: estado `no_se_anulo_en_el_libro`, el mensaje no nombra a la
 *    DGI, y la factura quedó IGUAL (status, fe_estado, credited_total, sin NC,
 *    sin asiento de anulación, sin intento ante el PAC).
 * B. ANULACIÓN NORMAL de la misma factura por la ruta HTTP, como la pantalla:
 *    200, `alcance = solo_crm`, mensaje «anulada en el CRM», `fe_estado` sin
 *    tocar y ningún intento en `fe_anulaciones`.
 *
 * 🛑 Sólo staging. Deja la factura ANULADA (con su NC total y su reversión), y
 *    un hueco en la serie `NC-` (el número que tomó la NC compensada en A,
 *    criterio de SOP-031).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import pg from "pg";

const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE = process.env.STAGING_BASE_URL ?? "http://localhost:3000";
const T = "a0000000-0000-0000-0000-000000000001";
const NUMERO = process.argv[2] ?? "FAC-HON-000030";
const MOTIVO = "Prueba de anulación sin CUFE en staging";

const env: Record<string, string> = {};
for (const f of [".env.local", ".env.staging-db.local"]) {
  for (const l of readFileSync(resolve(process.cwd(), f), "utf8").split(/\r?\n/)) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
const URL_SB = env.NEXT_PUBLIC_SUPABASE_URL;
const CONN = env.STAGING_DATABASE_URL;
if (!URL_SB?.includes(STAGING_REF) || !CONN?.includes(STAGING_REF)) {
  console.error("🛑 ABORTADO: no es staging.");
  process.exit(1);
}
// `createAdminClient` lee estas dos de process.env al llamarse.
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_SB;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const cargar = async <M,>(ruta: string): Promise<M> => {
  const m = (await import(ruta)) as M & { default?: M };
  return (m.default ?? m) as M;
};
const { anularFacturaAnteDgi } = await cargar<typeof import("../src/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi")>(
  "../src/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi"
);
const { createAdminClient } = await cargar<typeof import("../src/lib/supabase/admin")>("../src/lib/supabase/admin");

const { SEED_USERS } = createRequire(import.meta.url)("./seed-data/staging-fixtures.ts") as {
  SEED_USERS: { key: string; email: string; password: string }[];
};
const ref = URL_SB.match(/https:\/\/([^.]+)\./)?.[1] ?? STAGING_REF;

const db = new pg.Client({ connectionString: CONN });
await db.connect();
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as R[];

async function sesion(key: string) {
  const u = SEED_USERS.find((x) => x.key === key)!;
  const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const json = (await r.json()) as { access_token: string; user: { id: string } };
  const v = "base64-" + Buffer.from(JSON.stringify(json)).toString("base64");
  const TR = 3180;
  let cookie: string;
  if (v.length <= TR) cookie = `sb-${ref}-auth-token=${v}`;
  else {
    const partes: string[] = [];
    for (let i = 0, n = 0; i < v.length; i += TR, n += 1) partes.push(`sb-${ref}-auth-token.${n}=${v.slice(i, i + TR)}`);
    cookie = partes.join("; ");
  }
  return { token: json.access_token, userId: json.user.id, cookie };
}

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`   ${cond ? "✅" : "❌"} ${que}`);
  if (!cond) fallas += 1;
};

const [inv] = await q<{ id: string }>(
  "select id from invoices where tenant_id = $1 and invoice_number = $2",
  [T, NUMERO]
);
if (!inv) {
  console.error(`🛑 No existe ${NUMERO} en staging.`);
  process.exit(1);
}

async function foto() {
  const [f] = await q(
    `select i.status, i.fe_estado, i.dgi_cufe, i.credited_total::text, i.amount_paid::text,
            (select count(*)::int from credit_notes cn where cn.invoice_id = i.id) as ncs,
            (select count(*)::int from journal_entries je
               where je.tenant_id = i.tenant_id and je.source_id = i.id and je.source_type <> 'factura') as asientos_de_anulacion,
            (select count(*)::int from fe_anulaciones fa where fa.invoice_id = i.id) as intentos_dgi,
            (select last_number from numbering_sequences s where s.tenant_id = i.tenant_id and s.sequence_type = 'credit_note') as ultima_nc
       from invoices i where i.id = $1`,
    [inv.id]
  );
  return f as Record<string, unknown>;
}

const antes = await foto();
console.log(`\n▶ ${NUMERO} antes:`, antes);
if (antes.status !== "emitida" || antes.dgi_cufe) {
  console.error("🛑 La factura tiene que estar emitida y sin CUFE.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A. Falla forzada del libro
// ---------------------------------------------------------------------------
console.log("\nA. Anulación con falla forzada del libro (líneas descuadradas en B/. 1.00)");
const admin = await sesion("admin");
// Lecturas y escrituras de la sesión con el cliente de servicio (actor = admin
// en la bitácora): la parte A prueba el orquestador, no RLS. La B va por la
// ruta con la sesión real.
const servicio = createAdminClient(admin.userId);
const dbSesion = servicio;
let saboteadas = 0;
const saboteado = new Proxy(servicio, {
  get(target, prop, recv) {
    if (prop === "rpc") {
      return (fn: string, args: Record<string, unknown>) => {
        if (fn === "cancel_invoice_with_reversal" && Array.isArray(args.p_lines) && args.p_lines.length > 0) {
          saboteadas += 1;
          const lines = (args.p_lines as Record<string, number>[]).map((l) => ({ ...l }));
          if (Number(lines[0].debit) > 0) lines[0].debit = Number(lines[0].debit) + 1;
          else lines[0].credit = Number(lines[0].credit) + 1;
          return target.rpc(fn, { ...args, p_lines: lines });
        }
        return target.rpc(fn, args);
      };
    }
    return Reflect.get(target, prop, recv);
  },
});

const rA = await anularFacturaAnteDgi(dbSesion as never, saboteado as never, T, admin.userId, inv.id, MOTIVO, null, new Date());
console.log("   resultado:", JSON.stringify(rA, null, 2).replace(/\n/g, "\n   "));
ok(saboteadas === 1, "el RPC del libro se llamó una vez, descuadrado");
ok(rA.estado === "no_se_anulo_en_el_libro", `estado no_se_anulo_en_el_libro (vino ${rA.estado})`);
ok(/no se completó en el libro contable/.test(rA.mensaje), "el mensaje dice que no se completó en el libro");
ok(/sigue emitida, sin cambios/.test(rA.mensaje), "el mensaje dice que la factura quedó igual");
ok(!/DGI/.test(rA.mensaje), "el mensaje NO nombra a la DGI");

const tras = await foto();
console.log("   después de A:", tras);
for (const k of ["status", "fe_estado", "credited_total", "amount_paid", "ncs", "asientos_de_anulacion", "intentos_dgi"]) {
  ok(tras[k] === antes[k], `${k} igual (${String(antes[k])})`);
}
console.log(`   ℹ️ serie NC-: ${String(antes.ultima_nc)} → ${String(tras.ultima_nc)} (hueco aceptado, SOP-031)`);

// ---------------------------------------------------------------------------
// B. Anulación normal por la ruta
// ---------------------------------------------------------------------------
console.log("\nB. Anulación normal por POST /api/finanzas/invoices/[id]/cancel (abogada)");
const abogada = await sesion("abogada");
const res = await fetch(`${BASE}/api/finanzas/invoices/${inv.id}/cancel`, {
  method: "POST",
  headers: { cookie: abogada.cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ reason: MOTIVO }),
});
const cuerpo = (await res.json()) as Record<string, unknown>;
console.log(`   HTTP ${res.status}:`, JSON.stringify(cuerpo, null, 2).replace(/\n/g, "\n   "));
ok(res.status === 200, "HTTP 200");
ok(cuerpo.estado === "anulada", "estado anulada");
ok(cuerpo.alcance === "solo_crm", "alcance solo_crm (la pantalla dice «Anulada en el CRM. No se envió nada a la DGI»)");
ok(/quedó anulada en el CRM/.test(String(cuerpo.mensaje)), "mensaje: anulada en el CRM");
ok(/No se envió nada a la DGI/.test(String(cuerpo.mensaje)), "mensaje: no se envió nada a la DGI");
ok(!/anulada ante la DGI/i.test(String(cuerpo.mensaje)), "mensaje: no dice «anulada ante la DGI»");

const fin = await foto();
console.log("   después de B:", fin);
ok(fin.status === "anulada", "status anulada");
ok(fin.fe_estado === antes.fe_estado, `fe_estado sin tocar (${String(antes.fe_estado)})`);
ok(fin.intentos_dgi === 0, "ningún intento ante el PAC");
ok(fin.ncs === 1, "una NC total");
ok(Number(fin.asientos_de_anulacion) >= 1, "con su asiento de reversión");

await db.end();
console.log(fallas === 0 ? "\n✅ TODO OK" : `\n❌ ${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);

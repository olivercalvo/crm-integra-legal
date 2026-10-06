/**
 * Prueba en STAGING del inicio contable (096, 06/10/2026). Necesita la 096
 * aplicada y `npm run dev` arriba (las partes HTTP).
 *
 *   npx tsx scripts/verificar-inicio-contable.mts
 *
 * Con el código REAL de la app (emitInvoice, createPayment, cancelInvoice,
 * createBusinessExpense, createSupplierPayment, POST /api/expenses, PUT del
 * inicio), contra staging, con el inicio en su valor por defecto (01/07/2026):
 *
 *   A. factura del 30/06 (día ANTERIOR): se emite, SIN asiento
 *   B. factura del 01/07 (MISMO día): se emite, CON asiento
 *   C. factura del 02/07 (POSTERIOR): con asiento
 *   D. cobro de hoy aplicado a A (cobro cruzado): CON asiento, DEBE banco /
 *      HABER 100004 con el cliente de tercero
 *   E. otra factura del 30/06, anulada: anulada sin ningún asiento
 *   F. compra del 15/06: registrada SIN asiento; su pago de hoy: CON asiento
 *      (DEBE 200001 del proveedor / HABER banco)
 *   G. gasto de trámite del 15/06 por la ruta: 201 sin asiento; el reintento
 *      «Registrar en el libro»: 409
 *   H. mover el inicio al 02/07 por la ruta: 409, nombra B (tiene asiento)
 *   I. mover el inicio al 30/06 por la ruta: 409, nombra E y A (sin asiento)
 *
 * 🛑 Sólo staging. Deja los documentos creados (cliente ficticio CLI-016,
 *    proveedor PRV-002): el libro no se borra. Los números quedan en la salida.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import pg from "pg";

const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE = process.env.STAGING_BASE_URL ?? "http://localhost:3000";
const T = "a0000000-0000-0000-0000-000000000001";

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
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_SB;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const cargar = async <M,>(ruta: string): Promise<M> => {
  const m = (await import(ruta)) as M & { default?: M };
  return (m.default ?? m) as M;
};
const { createInvoice, emitInvoice, cancelInvoice } = await cargar<typeof import("../src/lib/finanzas/api/invoices")>("../src/lib/finanzas/api/invoices");
const { createPayment } = await cargar<typeof import("../src/lib/finanzas/api/payments")>("../src/lib/finanzas/api/payments");
const { createBusinessExpense } = await cargar<typeof import("../src/lib/finanzas/api/business-expenses")>("../src/lib/finanzas/api/business-expenses");
const { createSupplierPayment } = await cargar<typeof import("../src/lib/finanzas/api/supplier-payments")>("../src/lib/finanzas/api/supplier-payments");
const { createAdminClient } = await cargar<typeof import("../src/lib/supabase/admin")>("../src/lib/supabase/admin");

const { SEED_USERS } = createRequire(import.meta.url)("./seed-data/staging-fixtures.ts") as {
  SEED_USERS: { key: string; email: string; password: string }[];
};
const ref = URL_SB.match(/https:\/\/([^.]+)\./)?.[1] ?? STAGING_REF;

const pgc = new pg.Client({ connectionString: CONN });
await pgc.connect();
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pgc.query(sql, p)).rows as R[];

async function sesion(key: string) {
  const u = SEED_USERS.find((x) => x.key === key)!;
  const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const json = (await r.json()) as { user: { id: string } };
  const v = "base64-" + Buffer.from(JSON.stringify(json)).toString("base64");
  const TR = 3180;
  const partes: string[] = [];
  if (v.length <= TR) partes.push(`sb-${ref}-auth-token=${v}`);
  else for (let i = 0, n = 0; i < v.length; i += TR, n += 1) partes.push(`sb-${ref}-auth-token.${n}=${v.slice(i, i + TR)}`);
  return { userId: json.user.id, cookie: partes.join("; ") };
}

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`   ${cond ? "✅" : "❌"} ${que}`);
  if (!cond) fallas += 1;
};
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama" }).format(new Date());

const [{ inicio }] = await q<{ inicio: string }>("select to_char(public.finanzas_inicio_contable($1), 'YYYY-MM-DD') inicio", [T]);
console.log(`▶ inicio contable de staging: ${inicio} · hoy: ${hoy}`);
if (inicio !== "2026-07-01") {
  console.error("🛑 La prueba está escrita para el valor por defecto (01/07/2026).");
  process.exit(1);
}

const admin = await sesion("admin");
const abogada = await sesion("abogada");
const db = createAdminClient(admin.userId);

const [cli] = await q<{ id: string }>("select id from clients where tenant_id=$1 and client_number='CLI-016'", [T]);
const [serv] = await q<{ id: string }>("select id from services_catalog where tenant_id=$1 and code='HON-COR'", [T]);
const [itbms] = await q<{ id: string }>("select id from tax_codes where tenant_id=$1 and code='ITBMS_7'", [T]);
const [exento] = await q<{ id: string }>("select id from tax_codes where tenant_id=$1 and code='EXENTO'", [T]);
const [prov] = await q<{ id: string }>("select id from suppliers where tenant_id=$1 and supplier_number='PRV-002'", [T]);
const [caso] = await q<{ id: string }>(
  "select c.id from cases c join clients cl on cl.id=c.client_id where c.tenant_id=$1 and not coalesce(cl.es_de_prueba,false) order by c.case_code limit 1",
  [T]
);

const asientosDe = async (sourceType: string, id: string) =>
  q<{ entry_number: number }>("select entry_number from journal_entries where tenant_id=$1 and source_type=$2 and source_id=$3", [T, sourceType, id]);

async function factura(issue: string, etiqueta: string) {
  const creada = (await createInvoice(db as never, T, admin.userId, {
    invoice_kind: "HONORARIOS",
    client_id: cli.id,
    case_id: null,
    issue_date: issue,
    due_date: issue,
    notes: `Prueba del inicio contable (${etiqueta})`,
    lines: [
      {
        service_id: serv.id,
        description: `Honorarios de prueba, inicio contable (${etiqueta})`,
        quantity: 1,
        unit_price: 100,
        tax_code_id: itbms.id,
        tax_code: "ITBMS_7",
        tax_rate: 0.07,
      },
    ],
  })) as { id: string };
  const emitida = await emitInvoice(db as never, T, creada.id, db as never, admin.userId);
  return { id: creada.id, numero: emitida.invoice_number };
}

// ── A, B, C ──────────────────────────────────────────────────────────────────
console.log("\nA/B/C. Facturas del día anterior, del mismo día y del día siguiente");
const A = await factura("2026-06-30", "día anterior");
const B = await factura("2026-07-01", "mismo día");
const C = await factura("2026-07-02", "día siguiente");
ok((await asientosDe("factura", A.id)).length === 0, `A ${A.numero} (30/06): emitida SIN asiento`);
ok((await asientosDe("factura", B.id)).length === 1, `B ${B.numero} (01/07): CON asiento`);
ok((await asientosDe("factura", C.id)).length === 1, `C ${C.numero} (02/07): CON asiento`);

// ── D: cobro cruzado ─────────────────────────────────────────────────────────
console.log("\nD. Cobro de hoy aplicado a la factura del 30/06");
const cobro = await createPayment(
  db as never,
  T,
  admin.userId,
  {
    payment_account_code: "100001",
    applications: [{ invoice_id: A.id, amount: 50 }],
    payment_date: hoy,
    amount: 50,
    method: "transferencia",
    reference: "PRUEBA-096-COBRO",
    notes: null,
  } as never,
  db as never
);
const lineasCobro = await q<{ code: string; debit: string; credit: string; client_id: string | null }>(
  `select c.code, l.debit::text, l.credit::text, l.client_id
     from journal_entries j join journal_entry_lines l on l.entry_id = j.id
     join chart_of_accounts c on c.id = l.account_id
    where j.tenant_id=$1 and j.source_type='pago' and j.source_id=$2 order by l.debit desc`,
  [T, cobro.id]
);
console.log("   asiento del cobro:", lineasCobro);
ok(lineasCobro.length === 2, `${cobro.payment_number}: CON asiento`);
ok(
  lineasCobro.some((l) => l.code === "100004" && Number(l.credit) === 50 && l.client_id === cli.id),
  "HABER 100004 por 50.00 con el cliente de tercero (la CxC viene del saldo inicial)"
);
ok(lineasCobro.some((l) => l.code === "100001" && Number(l.debit) === 50), "DEBE 100001 (banco) por 50.00");

// ── E: anulación de una factura anterior ─────────────────────────────────────
console.log("\nE. Anular una factura del 30/06");
const E = await factura("2026-06-30", "para anular");
const antesE = await q<{ n: number }>("select count(*)::int n from journal_entries where tenant_id=$1", [T]);
await cancelInvoice(db as never, db as never, T, admin.userId, E.id, "Prueba del inicio contable: anular una factura contabilizada fuera");
const despuesE = await q<{ n: number }>("select count(*)::int n from journal_entries where tenant_id=$1", [T]);
const [estE] = await q<{ status: string }>("select status from invoices where id=$1", [E.id]);
ok(estE.status === "anulada", `${E.numero}: anulada`);
ok(despuesE[0].n === antesE[0].n, "ningún asiento nuevo (ni reversión ni NC)");

// ── F: compra anterior y su pago de hoy ──────────────────────────────────────
console.log("\nF. Compra del 15/06 y su pago de hoy");
const compra = (await createBusinessExpense(
  db as never,
  T,
  admin.userId,
  {
    expense_date: "2026-06-15",
    due_date: "2026-07-15",
    supplier_id: prov.id,
    supplier_name: null,
    supplier_ruc: null,
    supplier_invoice_number: "PRUEBA-096",
    lineas: [{ description: "Servicio de prueba, inicio contable", chart_account_code: "500001", amount: 80, tax_code_id: exento.id, tax_rate: 0, tax_amount: 0 }],
    description: "Compra de prueba del inicio contable (15/06)",
    subtotal: 80,
    tax_rate: 0,
    tax_amount: 0,
    status: "pendiente_pago",
    payment_date: null,
    payment_method: null,
    notes: null,
  } as never,
  db as never
)) as { id: string };
ok((await asientosDe("gasto", compra.id)).length === 0, "compra del 15/06: registrada SIN asiento");
const pago = await createSupplierPayment(
  db as never,
  T,
  admin.userId,
  {
    business_expense_id: compra.id,
    expense_id: null,
    payment_date: hoy,
    amount: 80,
    method: "transferencia",
    payment_account_code: "100001",
    reference: "PRUEBA-096-PAGO",
    notes: null,
  } as never,
  db as never
);
const lineasPago = await q<{ code: string; debit: string; supplier_id: string | null }>(
  `select c.code, l.debit::text, l.supplier_id
     from journal_entries j join journal_entry_lines l on l.entry_id = j.id
     join chart_of_accounts c on c.id = l.account_id
    where j.tenant_id=$1 and j.source_type='pago_proveedor' and j.source_id=$2`,
  [T, pago.id]
);
ok(lineasPago.length === 2, `${pago.payment_number}: el pago de hoy CON asiento`);
ok(
  lineasPago.some((l) => l.code === "200001" && Number(l.debit) === 80 && l.supplier_id === prov.id),
  "DEBE 200001 por 80.00 con el proveedor de tercero (la CxP viene del saldo inicial)"
);

// ── G: gasto de trámite anterior por la ruta ─────────────────────────────────
console.log("\nG. Gasto de trámite del 15/06 por POST /api/expenses");
const resG = await fetch(`${BASE}/api/expenses`, {
  method: "POST",
  headers: { cookie: abogada.cookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    case_id: caso.id,
    concept: "Trámite de prueba del inicio contable (15/06)",
    date: "2026-06-15",
    supplier_id: prov.id,
    lines: [{ key: "k1", description: "Timbres de prueba", chart_account_code: "130003", amount: "25.00", tax_rate: "0", tax_amount: "0" }],
  }),
});
const cuerpoG = (await resG.json()) as { id?: string; asiento?: unknown; contabilizado_fuera?: boolean; error?: string };
ok(resG.status === 201, `HTTP 201 (vino ${resG.status} ${cuerpoG.error ?? ""})`);
ok(cuerpoG.asiento === null && cuerpoG.contabilizado_fuera === true, "sin asiento, contabilizado_fuera");
if (cuerpoG.id) {
  const resG2 = await fetch(`${BASE}/api/expenses/${cuerpoG.id}/post-to-ledger`, {
    method: "POST",
    headers: { cookie: abogada.cookie },
  });
  const c2 = (await resG2.json()) as { error?: string };
  ok(resG2.status === 409 && /contabilizado fuera/.test(c2.error ?? ""), `«Registrar en el libro»: 409 · ${c2.error ?? ""}`);
}

// ── H, I: mover el inicio ────────────────────────────────────────────────────
console.log("\nH/I. Mover el inicio contable por la ruta (admin)");
for (const [fecha, debe] of [
  ["2026-07-02", B.numero],
  ["2026-06-30", A.numero],
] as const) {
  const res = await fetch(`${BASE}/api/finanzas/configuracion/inicio-contable`, {
    method: "PUT",
    headers: { cookie: admin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ fecha_inicio_contable: fecha }),
  });
  const c = (await res.json()) as { error?: string };
  console.log(`   → ${fecha}: HTTP ${res.status} · ${c.error ?? ""}`);
  ok(res.status === 409 && (c.error ?? "").includes(debe), `bloqueado, y nombra ${debe}`);
}
const [{ inicio: sigue }] = await q<{ inicio: string }>("select to_char(public.finanzas_inicio_contable($1), 'YYYY-MM-DD') inicio", [T]);
ok(sigue === "2026-07-01", "el inicio sigue en el 01/07/2026");

console.log("\nDocumentos que quedan en staging:", {
  A: A.numero, B: B.numero, C: C.numero, cobro: cobro.payment_number, E: E.numero,
  compra: compra.id, pago: pago.payment_number, gasto_tramite: cuerpoG.id,
});
await pgc.end();
console.log(fallas === 0 ? "\n✅ TODO OK" : `\n❌ ${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);

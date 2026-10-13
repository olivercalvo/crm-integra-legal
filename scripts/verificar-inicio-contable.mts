/**
 * Prueba en STAGING del inicio contable (096, 06/10/2026). Necesita la 096
 * aplicada y `npm run dev` arriba (las partes HTTP).
 *
 *   npx tsx scripts/verificar-inicio-contable.mts
 *
 * Con el código REAL de la app, contra staging, con el inicio en su valor por
 * defecto (01/07/2026):
 *
 *   0. FIXTURE: una factura del 20/06 emitida, con saldo y SIN asiento, como las
 *      de producción. Se crea por SQL con los dos triggers de fecha de la 096
 *      desactivados SÓLO en esa transacción (ninguna llave del producto).
 *   A. ALTAS con fecha anterior al inicio: factura, cobro, compra, gasto de
 *      trámite (HTTP), pago a proveedor, FAC-EXT y NC de compra → 422 con el
 *      mensaje, sin número ni asiento.
 *   B. EDICIÓN: un borrador de hoy movido al 30/06 → 422.
 *   C. ANULAR la factura del 20/06 por la ruta → 409 «contabilizada fuera … nota
 *      de crédito», sin PAC; la base también lo rechaza (UPDATE directo, ROLLBACK).
 *   D. NC de HOY de esa factura → CON asiento (DEBE ingreso / HABER 100004).
 *   E. COBRO de hoy aplicado a esa factura → CON asiento (HABER 100004 del cliente).
 *   F. ELIMINAR un cobro anterior (REC-000002, 20/04) y un gasto de trámite
 *      anterior (HTTP) → 409; la base también lo rechaza.
 *   G. «Registrar en el libro» de un gasto de trámite anterior → 409.
 *   H. MOVER el inicio: adelante sobre una factura del 01/07 con asiento, y atrás
 *      sobre la del 20/06 sin asiento → 409 nombrando cada una.
 *
 * 🛑 Sólo staging. Deja: la factura del 20/06 (FAC-HON-900002), su NC y su cobro,
 *    la factura del 01/07 y el borrador de hoy. El libro no se borra.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import pg from "pg";

const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE = process.env.STAGING_BASE_URL ?? "http://localhost:3000";
const T = "a0000000-0000-0000-0000-000000000001";
const FIXTURE = "FAC-HON-900002";

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
const inv = await cargar<typeof import("../src/lib/finanzas/api/invoices")>("../src/lib/finanzas/api/invoices");
const { createPayment, deletePayment } = await cargar<typeof import("../src/lib/finanzas/api/payments")>("../src/lib/finanzas/api/payments");
const { createBusinessExpense } = await cargar<typeof import("../src/lib/finanzas/api/business-expenses")>("../src/lib/finanzas/api/business-expenses");
const { createSupplierPayment } = await cargar<typeof import("../src/lib/finanzas/api/supplier-payments")>("../src/lib/finanzas/api/supplier-payments");
const { emitCreditNote } = await cargar<typeof import("../src/lib/finanzas/api/credit-notes")>("../src/lib/finanzas/api/credit-notes");
const { registrarFacturaExterna } = await cargar<typeof import("../src/lib/finanzas/api/facturas-externas")>("../src/lib/finanzas/api/facturas-externas");
const { createSupplierCreditNote } = await cargar<typeof import("../src/lib/finanzas/api/supplier-credit-notes")>("../src/lib/finanzas/api/supplier-credit-notes");
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
/** Corre `fn` y espera un MutationError con ese status y ese texto. */
async function rechaza(que: string, status: number, texto: RegExp, fn: () => Promise<unknown>) {
  try {
    await fn();
    ok(false, `${que}: NO se rechazó`);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    ok(e.status === status && texto.test(String(e.message)), `${que}: ${e.status} · ${e.message}`);
  }
}
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama" }).format(new Date());
const ANTES = /es anterior al inicio contable \(01\/07\/2026\)\. Lo anterior al inicio está en los libros del contador/;

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
const asientosDe = async (st: string, id: string) =>
  q<{ entry_number: number }>("select entry_number from journal_entries where tenant_id=$1 and source_type=$2 and source_id=$3", [T, st, id]);
const lineaFactura = {
  service_id: serv.id,
  description: "Honorarios de prueba, inicio contable",
  quantity: 1,
  unit_price: 100,
  tax_code_id: itbms.id,
  tax_code: "ITBMS_7",
  tax_rate: 0.07,
};

// ── 0. Fixture: una factura de junio como las de producción ──────────────────
console.log(`\n0. Fixture ${FIXTURE}: factura del 20/06, emitida, con saldo y sin asiento`);
let [fix] = await q<{ id: string }>("select id from invoices where tenant_id=$1 and invoice_number=$2", [T, FIXTURE]);
if (!fix) {
  const [modelo] = await q<{ id: string }>(
    "select id from invoices where tenant_id=$1 and invoice_number='FAC-HON-000031'",
    [T]
  );
  await pgc.query("BEGIN");
  await pgc.query("ALTER TABLE invoices DISABLE TRIGGER trg_documento_desde_el_inicio");
  await pgc.query("ALTER TABLE invoices DISABLE TRIGGER trg_factura_estado_desde_el_inicio");
  const cols = (await q<{ c: string }>(
    "select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='invoices' and is_generated='NEVER'"
  ))[0].c;
  const [nueva] = await q<{ id: string }>(
    `insert into invoices (${cols}) select ${cols} from jsonb_populate_record(null::invoices,
       (select to_jsonb(i) || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'DRAFT-${FIXTURE}', 'status', 'borrador',
          'client_id', $2::uuid, 'issue_date', '2026-06-20', 'accounting_date', '2026-06-20', 'due_date', '2026-07-20',
          'dgi_cufe', null, 'dgi_cufe_origen', null, 'fe_estado', 'no_emitida', 'amount_paid', 0, 'credited_total', 0,
          'de_prueba', false, 'notes', 'Fixture de staging: factura de junio contabilizada fuera (096)')
        from invoices i where i.id = $1)) returning id`,
    [modelo.id, cli.id]
  );
  const lcols = (await q<{ c: string }>(
    "select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='invoice_lines' and is_generated='NEVER' and column_name not in ('id','invoice_id')"
  ))[0].c;
  await q(`insert into invoice_lines (invoice_id, ${lcols}) select $2, ${lcols} from invoice_lines where invoice_id = $1`, [modelo.id, nueva.id]);
  await q("update invoices set status='emitida', invoice_number=$2 where id=$1", [nueva.id, FIXTURE]);
  await pgc.query("ALTER TABLE invoices ENABLE TRIGGER trg_documento_desde_el_inicio");
  await pgc.query("ALTER TABLE invoices ENABLE TRIGGER trg_factura_estado_desde_el_inicio");
  await pgc.query("COMMIT");
  fix = nueva;
}
const [estFix] = await q<{ status: string; balance_due: string; issue_date: string }>(
  "select status, balance_due::text, issue_date::text from invoices where id=$1",
  [fix.id]
);
console.log("   ", estFix);
ok(estFix.issue_date === "2026-06-20" && (await asientosDe("factura", fix.id)).length === 0, `${FIXTURE}: del 20/06 y sin asiento`);

// ── A. Altas con fecha anterior ──────────────────────────────────────────────
console.log("\nA. Altas con fecha anterior al inicio → 422, sin número ni asiento");
const antesSeq = await q<{ sequence_type: string; last_number: number }>("select sequence_type, last_number from numbering_sequences where tenant_id=$1", [T]);
await rechaza("factura del 30/06", 422, /La fecha de la factura \(30\/06\/2026\)/, () =>
  inv.createInvoice(db as never, T, admin.userId, { invoice_kind: "HONORARIOS", client_id: cli.id, case_id: null, issue_date: "2026-06-30", due_date: "2026-07-30", notes: null, lines: [lineaFactura] })
);
await rechaza("nota de débito del 30/06", 422, /La fecha de la nota de débito/, () =>
  inv.createInvoice(db as never, T, admin.userId, { invoice_kind: "NOTA_DEBITO", client_id: cli.id, case_id: null, issue_date: "2026-06-30", due_date: "2026-07-30", notes: null, lines: [lineaFactura] })
);
await rechaza("cobro del 30/06", 422, /La fecha del cobro/, () =>
  createPayment(db as never, T, admin.userId, { payment_account_code: "100001", applications: [{ invoice_id: fix.id, amount: 1 }], payment_date: "2026-06-30", amount: 1, method: "transferencia", reference: "PRUEBA-096-ALTA", notes: null } as never, db as never)
);
await rechaza("compra del 15/06", 422, /La fecha de la compra/, () =>
  createBusinessExpense(db as never, T, admin.userId, {
    expense_date: "2026-06-15", due_date: "2026-07-15", supplier_id: prov.id, supplier_name: null, supplier_ruc: null,
    supplier_invoice_number: "PRUEBA-096", description: "Compra de prueba (15/06)", subtotal: 80, tax_rate: 0, tax_amount: 0,
    lineas: [{ description: "x", chart_account_code: "500001", amount: 80, tax_code_id: exento.id, tax_rate: 0, tax_amount: 0 }],
    status: "pendiente_pago", payment_date: null, payment_method: null, notes: null,
  } as never, db as never)
);
await rechaza("pago a proveedor del 30/06", 422, /La fecha del pago al proveedor/, () =>
  createSupplierPayment(db as never, T, admin.userId, { business_expense_id: "00000000-0000-0000-0000-000000000000", expense_id: null, payment_date: "2026-06-30", amount: 1, method: "transferencia", payment_account_code: "100001", reference: "x", notes: null } as never, db as never)
);
await rechaza("factura emitida fuera (FAC-EXT) del 30/06", 422, /La fecha de la factura emitida fuera/, () =>
  registrarFacturaExterna(db as never, db as never, T, admin.userId, {
    invoice_kind: "HONORARIOS", client_id: cli.id, case_id: null, issue_date: "2026-06-30", accounting_date: "2026-06-30", due_date: "2026-07-30",
    notes: null, cufe: "FE0120000000000000-00-0000-0000000000000000000000000000000000000", punto: "050", numero_documento: 1,
    base_autorizada: 100, itbms_autorizado: 7, lines: [lineaFactura],
  } as never)
);
await rechaza("NC de compra con documento del 30/06", 422, /La fecha de la nota de crédito del proveedor/, () =>
  createSupplierCreditNote(db as never, db as never, T, admin.userId, {
    business_expense_id: null, supplier_id: prov.id, supplier_document_number: "PRUEBA-096", supplier_document_date: "2026-06-30",
    reason: "Prueba del inicio contable", lineas: [],
  } as never)
);
const resG = await fetch(`${BASE}/api/expenses`, {
  method: "POST",
  headers: { cookie: abogada.cookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    case_id: caso.id, concept: "Trámite de prueba (15/06)", date: "2026-06-15", supplier_id: prov.id,
    lines: [{ key: "k1", description: "Timbres de prueba", chart_account_code: "130003", amount: "25.00", tax_rate: "0", tax_amount: "0" }],
  }),
});
const cG = (await resG.json()) as { error?: string; fieldErrors?: { date?: string } };
ok(resG.status === 422 && ANTES.test(cG.error ?? "") && !!cG.fieldErrors?.date, `gasto de trámite del 15/06 (HTTP): ${resG.status} · ${cG.error}`);
const despuesSeq = await q<{ sequence_type: string; last_number: number }>("select sequence_type, last_number from numbering_sequences where tenant_id=$1", [T]);
ok(JSON.stringify(antesSeq) === JSON.stringify(despuesSeq), "ninguna secuencia se movió (no se quemó ningún número)");

// ── B. Edición de la fecha ───────────────────────────────────────────────────
console.log("\nB. Un borrador de hoy movido al 30/06");
const borrador = (await inv.createInvoice(db as never, T, admin.userId, {
  invoice_kind: "HONORARIOS", client_id: cli.id, case_id: null, issue_date: hoy, due_date: hoy, notes: "Prueba 096: edición de fecha", lines: [lineaFactura],
})) as { id: string };
await rechaza("updateInvoice al 30/06", 422, /La fecha de la factura \(30\/06\/2026\)/, () =>
  inv.updateInvoice(db as never, T, admin.userId, borrador.id, {
    invoice_kind: "HONORARIOS", client_id: cli.id, case_id: null, issue_date: "2026-06-30", due_date: "2026-07-30", notes: null,
    lines: [{ ...lineaFactura, _key: "k", id: null }],
  } as never)
);

// ── C. Anular la factura de junio ────────────────────────────────────────────
console.log(`\nC. Anular ${FIXTURE} por POST /api/finanzas/invoices/[id]/cancel`);
const resC = await fetch(`${BASE}/api/finanzas/invoices/${fix.id}/cancel`, {
  method: "POST",
  headers: { cookie: abogada.cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "Prueba del inicio contable: anular una factura de junio" }),
});
const cC = (await resC.json()) as { error?: string };
ok(
  resC.status === 409 && /contabilizada fuera/.test(cC.error ?? "") && /nota de crédito con fecha igual o posterior al inicio/.test(cC.error ?? ""),
  `HTTP ${resC.status} · ${cC.error}`
);
const intentos = await q<{ n: number }>("select count(*)::int n from fe_anulaciones where invoice_id=$1", [fix.id]);
ok(intentos[0].n === 0, "ni un intento ante el PAC");
await pgc.query("BEGIN");
try {
  await pgc.query("update invoices set status='anulada' where id=$1", [fix.id]);
  ok(false, "la base dejó anularla con un UPDATE directo");
} catch (e) {
  ok(/contabilizada fuera/.test((e as Error).message), `la base también: ${(e as Error).message}`);
}
await pgc.query("ROLLBACK");

// ── D. NC de hoy ─────────────────────────────────────────────────────────────
console.log(`\nD. NC de hoy de ${FIXTURE}`);
const [lin] = await q<{ id: string }>("select id from invoice_lines where invoice_id=$1 order by line_order limit 1", [fix.id]);
// Reintento: si una corrida anterior ya la emitió, se usa esa (el saldo no alcanza para otra).
let [nc] = await q<{ id: string; credit_note_number: string }>(
  "select id, credit_note_number from credit_notes where invoice_id=$1 and reason='Prueba del inicio contable: NC posterior' limit 1",
  [fix.id]
);
if (!nc) {
  const r = await emitCreditNote(db as never, db as never, T, admin.userId, {
    invoice_id: fix.id, reason: "Prueba del inicio contable: NC posterior", observations: null,
    lineas: [{ invoice_line_id: lin.id, quantity: 1, unit_price: 5 }],
  } as never);
  nc = { id: r.id, credit_note_number: r.credit_note_number };
}
const lineasNc = await q<{ code: string; debit: string; credit: string; client_id: string | null }>(
  `select c.code, l.debit::text, l.credit::text, l.client_id from journal_entries j join journal_entry_lines l on l.entry_id=j.id
     join chart_of_accounts c on c.id=l.account_id where j.tenant_id=$1 and j.source_type='nota_credito' and j.source_id=$2`,
  [T, nc.id]
);
ok(lineasNc.length > 0, `${nc.credit_note_number}: CON asiento`);
ok(lineasNc.some((l) => l.code === "100004" && Number(l.credit) > 0 && l.client_id === cli.id), "HABER 100004 del cliente");

// ── E. Cobro de hoy ──────────────────────────────────────────────────────────
console.log(`\nE. Cobro de hoy aplicado a ${FIXTURE}`);
let [cobro] = await q<{ id: string; payment_number: string }>(
  "select id, payment_number from payments where tenant_id=$1 and reference='PRUEBA-096-COBRO' limit 1",
  [T]
);
if (!cobro) {
  cobro = await createPayment(db as never, T, admin.userId, {
    payment_account_code: "100001", applications: [{ invoice_id: fix.id, amount: 2 }], payment_date: hoy, amount: 2,
    method: "transferencia", reference: "PRUEBA-096-COBRO", notes: null,
  } as never, db as never);
}
const lineasCobro = await q<{ code: string; credit: string; client_id: string | null }>(
  `select c.code, l.credit::text, l.client_id from journal_entries j join journal_entry_lines l on l.entry_id=j.id
     join chart_of_accounts c on c.id=l.account_id where j.tenant_id=$1 and j.source_type='pago' and j.source_id=$2`,
  [T, cobro.id]
);
ok(lineasCobro.some((l) => l.code === "100004" && Number(l.credit) === 2 && l.client_id === cli.id), `${cobro.payment_number}: HABER 100004 del cliente por 2.00`);

// ── F. Eliminar lo anterior ──────────────────────────────────────────────────
console.log("\nF. Eliminar un cobro y un gasto de trámite anteriores");
const [rec2] = await q<{ id: string }>("select id from payments where tenant_id=$1 and payment_number='REC-000002'", [T]);
await rechaza("deletePayment REC-000002 (20/04)", 409, /El cobro REC-000002 \(20\/04\/2026\) está contabilizado fuera.*asiento de diario/, () =>
  deletePayment(db as never, T, rec2.id)
);
const [gastoViejo] = await q<{ id: string }>(
  "select id from expenses where tenant_id=$1 and date < '2026-07-01' and posted_entry_id is null and not de_prueba order by date desc limit 1",
  [T]
);
const resF = await fetch(`${BASE}/api/expenses/${gastoViejo.id}`, { method: "DELETE", headers: { cookie: abogada.cookie } });
const cF = (await resF.json()) as { error?: string };
ok(resF.status === 409 && /contabilizado fuera.*nota de crédito del proveedor/.test(cF.error ?? ""), `DELETE gasto de trámite (HTTP): ${resF.status} · ${cF.error}`);
await pgc.query("BEGIN");
try {
  await pgc.query("delete from payments where id=$1", [rec2.id]);
  ok(false, "la base dejó borrar el cobro");
} catch (e) {
  ok(/contabilizado fuera/.test((e as Error).message), "la base también rechaza el DELETE");
}
await pgc.query("ROLLBACK");

// ── G. «Registrar en el libro» de un gasto anterior ──────────────────────────
console.log("\nG. «Registrar en el libro» de un gasto de trámite anterior");
const resGl = await fetch(`${BASE}/api/expenses/${gastoViejo.id}/post-to-ledger`, { method: "POST", headers: { cookie: abogada.cookie } });
const cGl = (await resGl.json()) as { error?: string };
ok(resGl.status === 409 && /contabilizado fuera/.test(cGl.error ?? ""), `HTTP ${resGl.status} · ${cGl.error}`);

// ── H. Mover el inicio ───────────────────────────────────────────────────────
console.log("\nH. Mover el inicio contable por la ruta (admin)");
let [julio] = await q<{ id: string; invoice_number: string }>(
  "select i.id, i.invoice_number from invoices i where i.tenant_id=$1 and i.issue_date='2026-07-01' and exists (select 1 from journal_entries j where j.source_type='factura' and j.source_id=i.id) limit 1",
  [T]
);
if (!julio) {
  const c = (await inv.createInvoice(db as never, T, admin.userId, {
    invoice_kind: "HONORARIOS", client_id: cli.id, case_id: null, issue_date: "2026-07-01", due_date: "2026-07-31", notes: "Prueba 096: mismo día del inicio", lines: [lineaFactura],
  })) as { id: string };
  const e = await inv.emitInvoice(db as never, T, c.id, db as never, admin.userId);
  julio = { id: c.id, invoice_number: e.invoice_number };
}
ok((await asientosDe("factura", julio.id)).length === 1, `${julio.invoice_number} (01/07): CON asiento`);
for (const [fecha, debe] of [["2026-07-02", julio.invoice_number], ["2026-06-20", FIXTURE]] as const) {
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
  fixture: FIXTURE, nc: nc.credit_note_number, cobro: cobro.payment_number, julio: julio.invoice_number, borrador: borrador.id,
});
await pgc.end();
console.log(fallas === 0 ? "\n✅ TODO OK" : `\n❌ ${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);

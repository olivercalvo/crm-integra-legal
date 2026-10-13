/**
 * Prueba en STAGING de los documentos de prueba (094 + filtros de los reportes).
 *
 *   npx tsx scripts/verificar-documentos-de-prueba.mts      (con `npm run dev` arriba)
 *
 * A. Una factura emitida SIN asiento (como las de prueba de producción: el libro
 *    de producción está vacío) que se marca de prueba. Antes y después se mide
 *    cada lugar que la lee: antigüedad por cobrar (y su cuadre), estado de
 *    cuenta, ITBMS, Pendientes DGI y sus contadores (listado, hub, dashboard de
 *    la abogada), el aviso de errores DGI, los selectores de cobro, NC y ND, el
 *    libro (Estado de Resultado y Balance) y las exportaciones (antigüedad e
 *    ITBMS, por HTTP). Después de marcarla tiene que desaparecer de todo menos
 *    del libro, donde nunca estuvo.
 * B. El caso FAC-HON-000463: una factura REAL, con asiento, de un cliente que se
 *    marca de prueba. Todo tiene que quedar IGUAL. Y un cobro nuevo para ese
 *    cliente se rechaza ANTES de tomar número (409). Al final el cliente se
 *    desmarca con la llave (queda como estaba).
 *
 * 🛑 Sólo staging. Deja la factura FAC-HON-900001 (de prueba, marcada). La crea
 * por SQL a propósito: la app ya no emite sin asiento.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import pg from "pg";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const cargar = async <M,>(ruta: string): Promise<M> => {
  const m = (await import(ruta)) as M & { default?: M };
  return (m.default ?? m) as M;
};
const { loadAntiguedad } = await cargar<typeof import("../src/lib/finanzas/reports/antiguedad-source")>("../src/lib/finanzas/reports/antiguedad-source");
const { buildAntiguedad } = await cargar<typeof import("../src/lib/finanzas/reports/antiguedad")>("../src/lib/finanzas/reports/antiguedad");
const { loadClientesConMovimiento, loadMovimientosDeCliente } = await cargar<typeof import("../src/lib/finanzas/reports/estado-cuenta-source")>("../src/lib/finanzas/reports/estado-cuenta-source");
const { getVatSummary } = await cargar<typeof import("../src/lib/finanzas/reports/vat-summary")>("../src/lib/finanzas/reports/vat-summary");
const { listarPendientesDgi, contarPendientesDgi } = await cargar<typeof import("../src/lib/finanzas/queries/pendientes-dgi")>("../src/lib/finanzas/queries/pendientes-dgi");
const { contarFacturasConErrorDgi } = await cargar<typeof import("../src/lib/finanzas/queries/fe-emisiones")>("../src/lib/finanzas/queries/fe-emisiones");
const { listInvoicesCobrables } = await cargar<typeof import("../src/lib/finanzas/queries/payments")>("../src/lib/finanzas/queries/payments");
const { facturasAbiertasParaNc, facturasConSaldoDelCliente } = await cargar<typeof import("../src/lib/finanzas/queries/notas-credito")>("../src/lib/finanzas/queries/notas-credito");
const { facturasAjustables } = await cargar<typeof import("../src/lib/finanzas/queries/invoices")>("../src/lib/finanzas/queries/invoices");
const { loadReportAccounts } = await cargar<typeof import("../src/lib/finanzas/reports/accounting-source")>("../src/lib/finanzas/reports/accounting-source");
const { buildAccountingReports } = await cargar<typeof import("../src/lib/finanzas/reports/accounting-reports")>("../src/lib/finanzas/reports/accounting-reports");

const { SEED_USERS } = createRequire(import.meta.url)("./seed-data/staging-fixtures.ts") as {
  SEED_USERS: { key: string; email: string; password: string }[];
};

const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE = process.env.STAGING_BASE_URL ?? "http://localhost:3000";
const T = "a0000000-0000-0000-0000-000000000001";
const MES = "2026-09";
const NUM_A = "FAC-HON-900001";
const NUM_B = "FAC-HON-000023";

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
const ref = URL_SB.match(/https:\/\/([^.]+)\./)?.[1] ?? STAGING_REF;
const sb = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: CONN });
await db.connect();
const q = async <R = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as R[];

async function cookie(key: string): Promise<string> {
  const u = SEED_USERS.find((x) => x.key === key)!;
  const r = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const v = "base64-" + Buffer.from(JSON.stringify(await r.json())).toString("base64");
  const TR = 3180;
  if (v.length <= TR) return `sb-${ref}-auth-token=${v}`;
  const partes: string[] = [];
  for (let i = 0, n = 0; i < v.length; i += TR, n += 1) partes.push(`sb-${ref}-auth-token.${n}=${v.slice(i, i + TR)}`);
  return partes.join("; ");
}
const COOKIE_ADMIN = await cookie("admin");

async function textoDelXlsx(path: string): Promise<string> {
  const r = await fetch(BASE + path, { headers: { cookie: COOKIE_ADMIN } });
  if (r.status !== 200) {
    console.log(`   ⚠️ ${path}: HTTP ${r.status}`);
    return `HTTP ${r.status}`;
  }
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()));
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Todo lo que se mide, como texto comparable. */
async function medir(numero: string, clientId: string) {
  const ag = await loadAntiguedad(sb as never, T, "cobrar");
  const aging = buildAntiguedad(ag.documentos, ag.control);
  const clientes = await loadClientesConMovimiento(sb as never, T);
  const movs = await loadMovimientosDeCliente(sb as never, T, clientId);
  const vat = await getVatSummary(sb as never, { tenantId: T, month: MES });
  const pend = await listarPendientesDgi(sb as never, T);
  const creador = (await q<{ created_by: string }>("select created_by from invoices where invoice_number = $1", [numero]))[0]?.created_by ?? null;
  const cuentas = await loadReportAccounts(sb as never, T);
  const { estadoResultado, balanceGeneral } = buildAccountingReports(cuentas);
  const saldo = (code: string) => r2(cuentas.find((c) => c.code === code)?.saldo ?? 0);
  const listado = await (await fetch(`${BASE}/finanzas/facturas?q=${encodeURIComponent(numero)}`, { headers: { cookie: COOKIE_ADMIN } })).text();
  return {
    "antigüedad: la factura está": ag.documentos.some((d) => d.numero === numero),
    "antigüedad: total": r2(aging.total),
    "antigüedad: diferencia con 100004": r2(aging.control.diferencia),
    "estado de cuenta: el cliente está": clientes.some((c) => c.id === clientId),
    "estado de cuenta: la factura está": movs.some((m) => m.documento === numero),
    "estado de cuenta: saldo del cliente": r2(movs.reduce((s, m) => s + m.debito - m.credito, 0)),
    "ITBMS: la factura está": vat.detail.invoices.some((i) => i.invoice_number === numero),
    "ITBMS: líneas": vat.lines.map((l) => `${l.number}=${r2(l.value)}`).join(" "),
    "Pendientes DGI: la factura está": pend.some((p) => p.numero === numero),
    "Pendientes DGI: cantidad (listado de facturas y hub de reportes)": await contarPendientesDgi(sb as never, T),
    "Pendientes DGI: cantidad en el dashboard de quien la creó": creador ? await contarPendientesDgi(sb as never, T, creador) : null,
    "aviso «facturas con error en la DGI»": await contarFacturasConErrorDgi(sb as never, T),
    "selector de cobros: la factura está": (await listInvoicesCobrables(sb as never, T)).some((f) => f.invoice_number === numero),
    "selector de NC: la factura está": (await facturasAbiertasParaNc(sb as never, T)).some((f) => f.invoice_number === numero),
    "selector de NC del cliente: la factura está": (await facturasConSaldoDelCliente(sb as never, T, clientId)).some((f) => f.numero === numero),
    "selector de ND: la factura está": (await facturasAjustables(sb as never, T)).some((f) => f.invoice_number === numero),
    "libro: 100004": saldo("100004"),
    "libro: ingresos del Estado de Resultado": r2(estadoResultado.ingresos.total),
    "libro: activos del Balance": r2(balanceGeneral.activos.total),
    "export antigüedad: la factura está": (await textoDelXlsx("/api/finanzas/reportes/aging/export?tipo=cobrar")).includes(numero),
    "export ITBMS: la factura está": (await textoDelXlsx(`/api/finanzas/reportes/vat-summary/export?month=${MES}&format=xlsx`)).includes(numero),
    "listado de facturas: badge «Prueba»": listado.includes(numero) && /Prueba<\/span>/.test(listado),
  };
}

function comparar(titulo: string, antes: Record<string, unknown>, despues: Record<string, unknown>) {
  console.log(`\n── ${titulo}`);
  for (const k of Object.keys(antes)) {
    const a = JSON.stringify(antes[k]);
    const d = JSON.stringify(despues[k]);
    console.log(`  ${a === d ? "  =" : "  ≠"} ${k.padEnd(62)} ${a}${a === d ? "" : ` → ${d}`}`);
  }
}

let ok = 0;
let fail = 0;
const marca = (b: boolean, msg: string) => {
  if (b) ok += 1;
  else fail += 1;
  console.log(`${b ? "✅" : "❌"} ${msg}`);
};

// ════════════════════════════════════════════════════════════════════════════
// A. Una factura de prueba sin asiento
// ════════════════════════════════════════════════════════════════════════════
let a = (await q<{ id: string; client_id: string; de_prueba: boolean; grand_total: string; tax_total: string }>(
  "select id, client_id, de_prueba, grand_total, tax_total from invoices where tenant_id = $1 and invoice_number = $2", [T, NUM_A]))[0];
if (a?.de_prueba) {
  // Segunda corrida: se desmarca con la llave para volver a medir el «antes».
  await q("begin");
  await q("select set_config('finanzas.de_prueba_override', 'on', true)");
  await q("update invoices set de_prueba = false where id = $1", [a.id]);
  await q("commit");
  console.log(`(segunda corrida: ${NUM_A} se desmarcó con la llave para medir otra vez)`);
}
if (!a) {
  // Copia de FAC-HON-000022 (CLI-009, con ITBMS), con su línea, sin asiento: como
  // una factura de producción anterior al libro. Fecha de septiembre (mes del ITBMS).
  const base = (await q<{ id: string }>("select id from invoices where tenant_id = $1 and invoice_number = 'FAC-HON-000022'", [T]))[0];
  const cols = (await q<{ c: string }>(
    "select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='invoices' and is_generated='NEVER' and column_name <> 'id'"))[0].c;
  await q("begin");
  const nuevo = (await q<{ id: string }>(
    `insert into invoices (${cols})
     select ${cols.split(", ").map((c) => ({
       invoice_number: `'${NUM_A}'`, issue_date: "'2026-09-30'", accounting_date: "'2026-09-30'", due_date: "'2026-10-30'",
       status: "'borrador'", amount_paid: "0", credited_total: "0", fe_estado: "'error'",
       fe_motivo_pendiente: "'Prueba 05/10: factura sin asiento para marcar de prueba'", fe_motivo_pendiente_en: "now()",
       dgi_cufe: "null", dgi_cufe_origen: "null", dgi_numero_documento: "null", dgi_fecha_autorizacion: "null", numero_documento: "null",
       notes: "'Prueba 05/10 de documentos de prueba (verificar-documentos-de-prueba.mts)'", created_at: "now()", updated_at: "now()",
     } as Record<string, string>)[c] ?? c).join(", ")}
       from invoices where id = $1 returning id`, [base.id]))[0];
  const lcols = (await q<{ c: string }>(
    "select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='invoice_lines' and is_generated='NEVER' and column_name not in ('id','invoice_id')"))[0].c;
  await q(`insert into invoice_lines (invoice_id, ${lcols}) select $1, ${lcols} from invoice_lines where invoice_id = $2`, [nuevo.id, base.id]);
  // Las líneas se cargan en borrador (después la 038/T4 las congela); recién ahí se emite.
  await q("update invoices set status = 'emitida' where id = $1", [nuevo.id]);
  await q("commit");
  a = (await q<typeof a>("select id, client_id, de_prueba, grand_total, tax_total from invoices where id = $1", [nuevo.id]))[0];
  console.log(`Creada ${NUM_A} (copia de FAC-HON-000022 sin asiento): total ${a.grand_total}, ITBMS ${a.tax_total}`);
}
marca((await q("select 1 from journal_entries where source_id = $1", [a.id])).length === 0, `${NUM_A} no tiene asiento`);

const antesA = await medir(NUM_A, a.client_id);
await q("update invoices set de_prueba = true, de_prueba_motivo = $2 where id = $1",
  [a.id, "Prueba 05/10 en staging: factura creada para probar que lo marcado no sale en ningún reporte."]);
const despuesA = await medir(NUM_A, a.client_id);
comparar(`A. ${NUM_A} sin marca → marcada de prueba`, antesA, despuesA);

const total = Number(a.grand_total);
const tax = Number(a.tax_total);
marca(antesA["antigüedad: la factura está"] === true && despuesA["antigüedad: la factura está"] === false, "antigüedad: sale");
marca(r2((antesA["antigüedad: total"] as number) - (despuesA["antigüedad: total"] as number)) === r2(total), `antigüedad: el total baja ${total}`);
marca(despuesA["estado de cuenta: la factura está"] === false, "estado de cuenta: sale");
marca(r2((antesA["estado de cuenta: saldo del cliente"] as number) - (despuesA["estado de cuenta: saldo del cliente"] as number)) === r2(total), `estado de cuenta: el saldo baja ${total}`);
marca(antesA["ITBMS: la factura está"] === true && despuesA["ITBMS: la factura está"] === false, "ITBMS: sale del detalle");
marca(antesA["ITBMS: líneas"] !== despuesA["ITBMS: líneas"], `ITBMS: el débito baja (${tax} de ITBMS)`);
marca(antesA["Pendientes DGI: la factura está"] === true && despuesA["Pendientes DGI: la factura está"] === false, "Pendientes DGI: sale");
marca((antesA["Pendientes DGI: cantidad (listado de facturas y hub de reportes)"] as number) - 1 === despuesA["Pendientes DGI: cantidad (listado de facturas y hub de reportes)"], "Pendientes DGI: el contador baja 1");
marca((antesA["Pendientes DGI: cantidad en el dashboard de quien la creó"] as number) - 1 === despuesA["Pendientes DGI: cantidad en el dashboard de quien la creó"], "dashboard de la abogada: baja 1");
marca((antesA["aviso «facturas con error en la DGI»"] as number) - 1 === despuesA["aviso «facturas con error en la DGI»"], "aviso de errores DGI: baja 1");
for (const k of ["selector de cobros", "selector de NC", "selector de NC del cliente", "selector de ND"]) {
  marca(antesA[`${k}: la factura está`] === true && despuesA[`${k}: la factura está`] === false, `${k}: sale`);
}
for (const k of ["libro: 100004", "libro: ingresos del Estado de Resultado", "libro: activos del Balance"]) {
  marca(antesA[k] === despuesA[k], `${k}: igual (nunca tuvo asiento)`);
}
marca(antesA["export antigüedad: la factura está"] === true && despuesA["export antigüedad: la factura está"] === false, "export de antigüedad: sale");
marca(antesA["export ITBMS: la factura está"] === true && despuesA["export ITBMS: la factura está"] === false, "export de ITBMS: sale");
marca(despuesA["listado de facturas: badge «Prueba»"] === true, "listado de facturas: sigue, con el badge «Prueba»");

// A2. Lo que ya no se puede hacer con una factura de prueba (API, sin número quemado).
{
  const linea = (await q<{ id: string }>("select id from invoice_lines where invoice_id = $1 limit 1", [a.id]))[0];
  const seq = async () => (await q<{ t: string }>(
    "select string_agg(sequence_type || '=' || last_number, ' ' order by sequence_type) t from numbering_sequences where tenant_id = $1", [T]))[0].t;
  const fe = async () => (await q<{ n: string }>(
    "select (select count(*) from fe_emisiones where invoice_id = $1) || '/' || (select count(*) from fe_anulaciones where invoice_id = $1) n", [a.id]))[0].n;
  const seqAntes = await seq();
  const feAntes = await fe();
  const post = async (path: string, body: unknown) => {
    const r = await fetch(BASE + path, { method: "POST", headers: { cookie: COOKIE_ADMIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
    return { status: r.status, msg: j.error ?? j.message ?? "" };
  };
  const casos: [string, string, unknown][] = [
    ["enviar a la DGI", `/api/finanzas/invoices/${a.id}/emit-efactura`, {}],
    ["registrar cobro", `/api/finanzas/invoices/${a.id}/payments`, { amount: 1, payment_date: "2026-10-05", method: "transferencia", reference: "PRUEBA-0510", payment_account_code: "100001" }],
    ["nota de crédito", "/api/finanzas/credit-notes", { invoice_id: a.id, reason: "Prueba 05/10 de una factura de prueba", lineas: [{ invoice_line_id: linea.id, quantity: 1 }] }],
    ["anular", `/api/finanzas/invoices/${a.id}/cancel`, { reason: "Prueba 05/10: anular una factura de prueba" }],
  ];
  for (const [que, path, body] of casos) {
    const r = await post(path, body);
    marca(r.status === 409 && /de prueba/.test(r.msg), `${NUM_A} — ${que}: ${r.status} «${r.msg}»`);
  }
  marca(seqAntes === (await seq()), "ningún correlativo se movió");
  marca(feAntes === (await fe()), "ningún intento ante el PAC (fe_emisiones y fe_anulaciones igual)");
}

// ════════════════════════════════════════════════════════════════════════════
// B. El caso 463: factura REAL de un cliente marcado de prueba
// ════════════════════════════════════════════════════════════════════════════
const b = (await q<{ id: string; client_id: string; client_number: string }>(
  "select i.id, i.client_id, c.client_number from invoices i join clients c on c.id = i.client_id where i.tenant_id = $1 and i.invoice_number = $2", [T, NUM_B]))[0];
marca((await q("select 1 from journal_entries where source_id = $1", [b.id])).length === 1, `${NUM_B} tiene asiento (cuenta en el libro)`);
const antesB = await medir(NUM_B, b.client_id);
await q("update clients set es_de_prueba = true, es_de_prueba_motivo = $2, es_de_prueba_en = now() where id = $1",
  [b.client_id, "Prueba 05/10 en staging: el caso FAC-HON-000463 (factura real de un cliente de prueba)."]);
const despuesB = await medir(NUM_B, b.client_id);
comparar(`B. ${b.client_number} marcado de prueba; ${NUM_B} sigue real`, antesB, despuesB);
const distintos = Object.keys(antesB).filter((k) => JSON.stringify(antesB[k]) !== JSON.stringify(despuesB[k]));
marca(distintos.length === 0, `${NUM_B} sigue contando en todo (${distintos.length ? distintos.join(", ") : "nada cambió"})`);
for (const k of ["antigüedad: la factura está", "estado de cuenta: la factura está", "ITBMS: la factura está", "Pendientes DGI: la factura está", "export antigüedad: la factura está", "export ITBMS: la factura está"]) {
  marca(despuesB[k] === true, `${NUM_B} — ${k.replace(": la factura está", "")}`);
}

// Un cobro nuevo de ese cliente: 409 antes del número.
const seqAntes = (await q<{ n: string }>("select last_number::text n from numbering_sequences where tenant_id = $1 and sequence_type = 'payment'", [T]))[0]?.n;
const rCobro = await fetch(`${BASE}/api/finanzas/invoices/${b.id}/payments`, {
  method: "POST",
  headers: { cookie: COOKIE_ADMIN, "Content-Type": "application/json" },
  body: JSON.stringify({ amount: 1, payment_date: "2026-10-05", method: "transferencia", reference: "PRUEBA-0510", payment_account_code: "100001" }),
});
const jCobro = (await rCobro.json()) as { error?: string };
const seqDespues = (await q<{ n: string }>("select last_number::text n from numbering_sequences where tenant_id = $1 and sequence_type = 'payment'", [T]))[0]?.n;
marca(rCobro.status === 409 && /marcado de prueba/.test(jCobro.error ?? ""), `cobro nuevo de ${b.client_number}: ${rCobro.status} «${jCobro.error}»`);
marca(seqAntes === seqDespues, `sin número quemado (secuencia 'payment' ${seqAntes} → ${seqDespues})`);

// El cliente vuelve a como estaba (con la llave).
await q("begin");
await q("select set_config('finanzas.de_prueba_override', 'on', true)");
await q("update clients set es_de_prueba = false where id = $1", [b.client_id]);
await q("commit");
console.log(`\n(${b.client_number} desmarcado con la llave: queda como estaba. ${NUM_A} queda marcada de prueba.)`);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${ok} OK, ${fail} FALLAS`);
await db.end();
process.exit(fail === 0 ? 0 : 1);

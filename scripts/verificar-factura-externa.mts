/**
 * VERIFICAR «Registrar factura emitida fuera» (092) en staging, con las 3 del
 * punto 100 que no están en el CRM (datos reales del facturador del 05/10).
 *
 *   STAGING_BASE_URL=http://localhost:3000 MSYS_NO_PATHCONV=1 npx tsx scripts/verificar-factura-externa.mts
 *
 * Por la API, con sesiones reales: contador (STAGING_UI_*), admin y abogada de
 * los fixtures. Lo que la API no puede mostrar se mira en la base (pg).
 *
 * Qué comprueba:
 *   1. La abogada recibe 403.
 *   2. MEI Tower 1C (contador) y MEI Tower 2B (admin), fecha de registro 14/07:
 *      201. FAC-EXT-, emitida, CUFE, origen externo, punto 100 y su número,
 *      fe_estado no_emitida, totales; asiento `factura` del 14/07 con 100004 a
 *      nombre del cliente, el ingreso, el ITBMS, el CUFE y la referencia
 *      externa 100-000000000N; filas en la bitácora contable con el usuario.
 *   3. Mi Condado con fecha de registro 01/08 (agosto CERRADO en staging): 422
 *      y no queda nada. Con la fecha elegida por el contador (hoy): 201.
 *   4. CUFE repetido (otra vez la 1C): 409. El CUFE de una factura del CRM
 *      (051/sandbox) contra el RPC: rechazado. El de la 1C cargado a mano en
 *      otra factura (caso B): 409.
 *   5. CUFE que no coincide con la fecha, y monto que no coincide: 400 en la
 *      API, y el RPC también los rechaza si alguien se saltea la app.
 *   6. Nunca al PAC: fe_secuencias igual, «Enviar a la DGI» 409, el guard de
 *      la base rechaza pasarla a 'pending' o cambiarle el CUFE, sin PDF.
 *   7. Igual que una factura del CRM: Mayor de 100004 y del ingreso, ITBMS de
 *      julio y de octubre, antigüedad por cobrar y Estado de Resultado.
 *   8. FAC-EXT- avanzó exactamente 3 (los rechazos no dejan hueco) y
 *      FAC-HON-/FAC-REI- no se movieron.
 *
 * Re-ejecutable: el libro es inmutable y una factura registrada no se borra, así
 * que si las tres ya están (segunda corrida) el script lo dice, salta el alta y
 * las diferencias de antes/después, y verifica lo que quedó (4, 6, 7e-7g, 9).
 *
 * 🛑 Solo staging. Deja 3 clientes FICTICIOS («CLIENTE EXT PRUEBA 1/2/3», RUC de
 * prueba) y 3 facturas externas registradas.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import pg from "pg";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

// Los módulos de src/ son CJS para tsx: desde un .mts los exports nombrados
// pueden venir dentro de `default`. Se cargan así para no depender de eso.
const cargar = async <M,>(ruta: string): Promise<M> => {
  const m = (await import(ruta)) as M & { default?: M };
  return (m.default ?? m) as M;
};
const { loadReportAccounts } = await cargar<typeof import("../src/lib/finanzas/reports/accounting-source")>(
  "../src/lib/finanzas/reports/accounting-source");
const { buildEstadoResultadoNiif18 } = await cargar<typeof import("../src/lib/finanzas/reports/estado-resultado-niif18")>(
  "../src/lib/finanzas/reports/estado-resultado-niif18");
const { contarPendientesDgi, listarPendientesDgi } = await cargar<typeof import("../src/lib/finanzas/queries/pendientes-dgi")>(
  "../src/lib/finanzas/queries/pendientes-dgi");

const { SEED_USERS } = createRequire(import.meta.url)("./seed-data/staging-fixtures.ts") as {
  SEED_USERS: { key: string; email: string; password: string }[];
};

const PROD_REF = "uqmmkklbhzxqybljiecs";
const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE = process.env.STAGING_BASE_URL ?? "http://localhost:3000";
const T = "a0000000-0000-0000-0000-000000000001";

const env: Record<string, string> = {};
for (const f of [".env.local", ".env.staging-db.local"]) {
  try {
    for (const l of readFileSync(resolve(process.cwd(), f), "utf8").split(/\r?\n/)) {
      const i = l.indexOf("=");
      if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* todo por process.env */
  }
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
const CONN = req("STAGING_DATABASE_URL");
if (URL_SB.includes(PROD_REF) || !URL_SB.includes(STAGING_REF) || CONN.includes(PROD_REF)) {
  console.error("🛑 ABORTADO: no es staging.");
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
async function http(
  cookie: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown>; buf: ArrayBuffer | null }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const tipo = r.headers.get("content-type") ?? "";
  if (tipo.includes("application/json")) return { status: r.status, json: (await r.json()) as Record<string, unknown>, buf: null };
  return { status: r.status, json: {}, buf: await r.arrayBuffer() };
}

const db = new pg.Client({ connectionString: CONN });
await db.connect();
const q = async <R extends object = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as R[];
const uno = async <R extends object = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await q<R>(sql, p))[0];
const sb = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

let ok = 0;
let fail = 0;
const marca = (b: boolean, msg: string, extra?: unknown) => {
  if (b) ok += 1;
  else fail += 1;
  console.log(`${b ? "✅" : "❌"} ${msg}${!b && extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
};
const n2 = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const hoy = (await uno<{ d: string }>("select ((now() at time zone 'America/Panama')::date)::text d")).d;

// ── CUFE, fechas, puntos, números y montos reales del facturador (03_Documentos/
//    facturador-2026-01-01-a-2026-10-05.xlsx). Los CLIENTES son ficticios (Oliver,
//    05/10): staging no lleva nombres ni RUC reales. El RPC no compara ningún RUC
//    con el cliente: el único RUC del CUFE es el del EMISOR. ──
const FACTURAS = [
  { clave: "1C", nombre: "CLIENTE EXT PRUEBA 1, S.A.", ruc: "155000001-2-2026", fecha: "2026-07-14", punto: "100", numero: 2, base: 150, itbms: 10.5,
    cufe: "FE0120000025046169-3-2021-4000002026071400000000021000112431062839" },
  { clave: "2B", nombre: "CLIENTE EXT PRUEBA 2, S.A.", ruc: "155000002-2-2026", fecha: "2026-07-14", punto: "100", numero: 3, base: 150, itbms: 10.5,
    cufe: "FE0120000025046169-3-2021-4000002026071400000000031000112587224588" },
  { clave: "MC", nombre: "CLIENTE EXT PRUEBA 3, S.A.", ruc: "155000003-2-2026", fecha: "2026-08-01", punto: "100", numero: 4, base: 350, itbms: 24.5,
    cufe: "FE0120000025046169-3-2021-4000002026080100000000041000110418925905" },
] as const;

// ── Preparación: los tres clientes (staging no los tiene) ───────────────────
const clientes: Record<string, string> = {};
for (const f of FACTURAS) {
  const ya = await uno<{ id: string }>("select id from clients where tenant_id=$1 and ruc=$2", [T, f.ruc]);
  if (ya) {
    clientes[f.clave] = ya.id;
    continue;
  }
  const seq = await uno<{ n: number }>("select get_next_sequence_number($1,'client') n", [T]);
  const nuevo = await uno<{ id: string }>(
    `insert into clients (tenant_id, client_number, name, ruc, tax_id, tax_id_type, client_type, client_status, email)
     values ($1,$2,$3,$4,$4,'ruc','persona_juridica','active','administracion@ejemplo.invalid') returning id`,
    [T, `CLI-${String(seq.n).padStart(3, "0")}`, f.nombre, f.ruc]
  );
  clientes[f.clave] = nuevo.id;
}
console.log(`Clientes listos: ${Object.entries(clientes).map(([k, v]) => `${k}=${v.slice(0, 8)}`).join(", ")}`);

const servicio = await uno<{ id: string; code: string; revenue_account: string }>(
  "select id, code, revenue_account from services_catalog where tenant_id=$1 and code='HON-COR' and active", [T]);
const tasa = await uno<{ id: string; code: string; rate: string; account_code: string | null }>(
  "select id, code, rate, account_code from tax_codes where tenant_id=$1 and code='ITBMS_7'", [T]);
if (!servicio || !tasa) {
  console.error("🛑 Falta HON-COR o ITBMS_7 en staging");
  process.exit(1);
}
const cuentaItbms = tasa.account_code ?? "200003";

function pedido(f: (typeof FACTURAS)[number], over: Record<string, unknown> = {}) {
  return {
    invoice_kind: "HONORARIOS",
    client_id: clientes[f.clave],
    case_id: null,
    issue_date: f.fecha,
    accounting_date: f.fecha,
    due_date: f.fecha,
    notes: f.clave === "MC" ? "Reemplaza a FAC-HON-000467 (anulada en el CRM tras fallar con la DGI)." : null,
    cufe: f.cufe,
    punto: f.punto,
    numero_documento: String(f.numero),
    base_autorizada: f.base.toFixed(2),
    itbms_autorizado: f.itbms.toFixed(2),
    lines: [
      {
        service_id: servicio.id,
        description: `Honorarios profesionales (documento ${f.punto}-${f.numero} del portal de facturación)`,
        quantity: 1,
        unit_price: f.base,
        tax_code_id: tasa.id,
        tax_code: tasa.code,
        tax_rate: Number(tasa.rate),
      },
    ],
    ...over,
  };
}

// ── Fotos de antes ─────────────────────────────────────────────────────────
const secuencias = async () =>
  Object.fromEntries(
    (await q<{ sequence_type: string; last_number: number }>(
      "select sequence_type, last_number from numbering_sequences where tenant_id=$1 and sequence_type in ('invoice_hon','invoice_reim','invoice_ext','debit_note')", [T]
    )).map((r) => [r.sequence_type, Number(r.last_number)])
  );
const feSecuencias = async () =>
  JSON.stringify(await q("select punto_facturacion, ultimo_numero from fe_secuencias where tenant_id=$1 order by 1", [T]));

async function ventas(desde: string, hasta: string) {
  const cuentas = await loadReportAccounts(sb as never, T, { rango: { desde, hasta }, aperturaDeResultado: "excluir", excluirCierre: true });
  const er = buildEstadoResultadoNiif18(cuentas, { isrRate: 0 });
  const ingreso = cuentas.find((c) => c.code === servicio.revenue_account);
  return { ingresoCuenta: n2(ingreso?.saldo), er: JSON.stringify(er).length };
}

const contador = await sesionCookie(req("STAGING_UI_EMAIL"), req("STAGING_UI_PASSWORD"));
const adminU = SEED_USERS.find((u) => u.key === "admin")!;
const abogadaU = SEED_USERS.find((u) => u.key === "abogada")!;
const admin = await sesionCookie(adminU.email, adminU.password);
const abogada = await sesionCookie(abogadaU.email, abogadaU.password);

async function itbms(mes: string): Promise<number> {
  const r = await http(contador, "GET", `/api/finanzas/reportes/vat-summary/export?month=${mes}&format=xlsx`);
  if (r.status !== 200 || !r.buf) return NaN;
  const wb = XLSX.read(Buffer.from(r.buf));
  const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  // La línea 3 del resumen: «ITBMS cobrado sobre ventas» (el débito fiscal).
  for (const f of filas) {
    const texto = (f as unknown[]).map(String).join(" ").toLowerCase();
    if (texto.includes("itbms cobrado sobre ventas")) {
      const nums = (f as unknown[]).filter((x) => typeof x === "number") as number[];
      if (nums.length) return n2(nums[nums.length - 1]);
    }
  }
  return NaN;
}
/** El HTML de una pantalla, sin los separadores de texto de React. */
async function html(cookie: string, path: string): Promise<string> {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return (await r.text()).replace(/<!-- -->/g, "");
}
/** Lo que dice el aviso «N documentos sin autorización de la DGI» (0 si no está). */
function avisoDe(h: string): number {
  const m = h.match(/(\d+) documentos? (?:tuyos? )?sin autorización de la DGI/);
  return m ? Number(m[1]) : 0;
}
async function avisos() {
  return {
    cuenta: await contarPendientesDgi(sb as never, T),
    facturas: avisoDe(await html(admin, "/finanzas/facturas")),
    reportes: avisoDe(await html(contador, "/finanzas/reportes")),
    legal: avisoDe(await html(admin, "/legal")),
  };
}
async function textoDe(path: string): Promise<string> {
  const r = await http(contador, "GET", path);
  if (r.status !== 200 || !r.buf) return `HTTP ${r.status}`;
  const wb = XLSX.read(Buffer.from(r.buf));
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
}

// ¿Segunda corrida? Las tres ya registradas por una corrida anterior.
const previas = await q<{ id: string; invoice_number: string; dgi_cufe: string }>(
  "select id, invoice_number, dgi_cufe from invoices where tenant_id=$1 and dgi_cufe_origen='externo' and dgi_cufe = any($2)",
  [T, FACTURAS.map((f) => f.cufe)]);
const REVISION = previas.length === FACTURAS.length;
if (previas.length > 0 && !REVISION) {
  console.error(`🛑 Hay ${previas.length} de las 3 registradas: estado a medias, revisar a mano.`);
  process.exit(1);
}
if (REVISION) console.log(`ℹ️ Segunda corrida: ya registradas ${previas.map((p) => p.invoice_number).join(", ")}. Se verifica lo que quedó.`);

const antes = {
  seq: await secuencias(),
  fe: await feSecuencias(),
  ventasJul: await ventas("2026-07-01", "2026-07-31"),
  ventasOct: await ventas(`${hoy.slice(0, 7)}-01`, hoy),
  itbmsJul: await itbms("2026-07"),
  itbmsOct: await itbms(hoy.slice(0, 7)),
  avisos: await avisos(),
};
console.log(`Antes: ${JSON.stringify(antes)}`);

// ═══ 1. Permisos ═══════════════════════════════════════════════════════════
{
  const r = await http(abogada, "POST", "/api/finanzas/facturas-externas", pedido(FACTURAS[0]));
  marca(r.status === 403, `1. la abogada recibe 403 (${r.status})`, r.json);
}

// ═══ 5. Rechazos de la app (antes de registrar nada) ═══════════════════════
{
  const r = await http(contador, "POST", "/api/finanzas/facturas-externas",
    pedido(FACTURAS[0], { issue_date: "2026-07-15", accounting_date: "2026-07-15", due_date: "2026-07-15" }));
  const fe = (r.json.fieldErrors ?? {}) as Record<string, string>;
  marca(r.status === 400 && /14\/07\/2026/.test(fe.issue_date ?? ""), `5a. fecha que no coincide con el CUFE: ${r.status} · «${fe.issue_date}»`, r.json);
  const m = await http(contador, "POST", "/api/finanzas/facturas-externas", pedido(FACTURAS[0], { base_autorizada: "160.00" }));
  const fm = (m.json.fieldErrors ?? {}) as Record<string, string>;
  marca(m.status === 400 && !!fm.base_autorizada, `5b. monto que no coincide con el documento: ${m.status} · «${fm.base_autorizada}»`, m.json);
  const o = await http(contador, "POST", "/api/finanzas/facturas-externas", pedido(FACTURAS[0], { numero_documento: "3" }));
  const fo = (o.json.fieldErrors ?? {}) as Record<string, string>;
  marca(o.status === 400 && !!fo.numero_documento, `5c. el número de la OTRA factura de MEI Tower: ${o.status} · «${fo.numero_documento}»`, o.json);
}

// ═══ 2. MEI Tower 1C (contador) y 2B (admin) ═══════════════════════════════
const registradas: Record<string, { id: string; invoice_number: string }> = {};
for (const p of previas) {
  const f = FACTURAS.find((x) => x.cufe === p.dgi_cufe)!;
  registradas[f.clave] = { id: p.id, invoice_number: p.invoice_number };
}
for (const [f, quien, cookie] of REVISION ? [] : ([[FACTURAS[0], "contador", contador], [FACTURAS[1], "admin", admin]] as const)) {
  const r = await http(cookie, "POST", "/api/finanzas/facturas-externas", pedido(f));
  marca(r.status === 201, `2. MEI Tower ${f.clave} (${quien}): ${r.status} ${r.json.invoice_number ?? r.json.error ?? ""}`, r.json);
  if (r.status === 201) registradas[f.clave] = { id: String(r.json.id), invoice_number: String(r.json.invoice_number) };
}

// ═══ 3. Mi Condado: agosto cerrado, después con la fecha que elige el contador ══
if (!REVISION) {
  const f = FACTURAS[2];
  const seqAntes = (await secuencias()).invoice_ext;
  const r = await http(contador, "POST", "/api/finanzas/facturas-externas", pedido(f));
  const fe = (r.json.fieldErrors ?? {}) as Record<string, string>;
  const queda = await uno("select 1 from invoices where tenant_id=$1 and upper(dgi_cufe)=$2", [T, f.cufe]);
  marca(r.status === 422 && !queda && (await secuencias()).invoice_ext === seqAntes,
    `3a. Mi Condado con registro 01/08 (agosto cerrado): ${r.status} · «${fe.accounting_date ?? r.json.error}» · no quedó nada`, r.json);
  const r2 = await http(contador, "POST", "/api/finanzas/facturas-externas", pedido(f, { accounting_date: hoy }));
  marca(r2.status === 201, `3b. Mi Condado con la fecha de registro elegida (${hoy}): ${r2.status} ${r2.json.invoice_number ?? r2.json.error ?? ""}`, r2.json);
  if (r2.status === 201) registradas.MC = { id: String(r2.json.id), invoice_number: String(r2.json.invoice_number) };
}

// ═══ 2 (cont.). Lo que quedó en la base ════════════════════════════════════
for (const f of FACTURAS) {
  const reg = registradas[f.clave];
  if (!reg) continue;
  const inv = await uno<Record<string, unknown>>(
    `select invoice_number, status, dgi_cufe, dgi_cufe_origen, punto_facturacion, numero_documento, fe_estado,
            subtotal_total, tax_total, grand_total, balance_due, issue_date::text, accounting_date::text, client_id
       from invoices where id=$1`, [reg.id]);
  const registro = f.clave === "MC" ? hoy : f.fecha;
  marca(
    /^FAC-EXT-\d{6}$/.test(String(inv.invoice_number)) && inv.status === "emitida" && inv.dgi_cufe === f.cufe &&
      inv.dgi_cufe_origen === "externo" && inv.punto_facturacion === "100" && Number(inv.numero_documento) === f.numero &&
      inv.fe_estado === "no_emitida" && n2(inv.subtotal_total) === f.base && n2(inv.tax_total) === f.itbms &&
      n2(inv.grand_total) === n2(f.base + f.itbms) && n2(inv.balance_due) === n2(f.base + f.itbms) &&
      inv.issue_date === f.fecha && inv.accounting_date === registro,
    `2·${f.clave}. ${inv.invoice_number}: emitida, CUFE y origen externo, punto 100 n.º ${f.numero}, sin enviar, ${f.base} + ${f.itbms}, documento ${f.fecha}, registro ${registro}`,
    inv
  );
  const asiento = await uno<Record<string, unknown>>(
    `select id, entry_number, source_type, transaction_date::text, reference, referencia_externa, source_cufe, description
       from journal_entries where tenant_id=$1 and source_type='factura' and source_id=$2`, [T, reg.id]);
  const lineas = await q<{ code: string; debit: string; credit: string; client_id: string | null; line_description: string | null }>(
    `select c.code, l.debit, l.credit, l.client_id, l.line_description from journal_entry_lines l
       join chart_of_accounts c on c.id=l.account_id where l.entry_id=$1 order by l.line_order`, [asiento?.id]);
  const cxc = lineas.find((l) => l.code === "100004");
  const ing = lineas.find((l) => l.code === servicio.revenue_account);
  const tax = lineas.find((l) => l.code === cuentaItbms);
  marca(
    !!asiento && asiento.transaction_date === registro && asiento.reference === inv.invoice_number &&
      asiento.referencia_externa === `100-${String(f.numero).padStart(10, "0")}` && asiento.source_cufe === f.cufe &&
      !!cxc && n2(cxc.debit) === n2(f.base + f.itbms) && cxc.client_id === clientes[f.clave] &&
      (cxc.line_description ?? "").includes(String(inv.invoice_number)) &&
      !!ing && n2(ing.credit) === f.base && !!tax && n2(tax.credit) === f.itbms && lineas.length === 3,
    `2·${f.clave}. asiento n.º ${asiento?.entry_number}: factura del ${registro}, 100004 ${n2(f.base + f.itbms)} a nombre del cliente, ${servicio.revenue_account} ${f.base}, ${cuentaItbms} ${f.itbms}, CUFE y referencia ${asiento?.referencia_externa}`,
    { asiento, lineas }
  );
  const bit = await q<{ tabla: string; usuario_nombre: string | null; rol: string | null; accion: string }>(
    `select tabla, usuario_nombre, rol, accion from auditoria.bitacora_contable
      where tenant_id=$1 and (registro_id=$2 or registro_id=$3::text) order by id`, [T, reg.id, asiento?.id]);
  const rolEsperado = f.clave === "2B" ? "admin" : "contador";
  marca(
    bit.some((b) => b.tabla === "invoices") && bit.some((b) => b.tabla === "journal_entries") && bit.every((b) => b.rol === rolEsperado),
    `2·${f.clave}. bitácora contable: ${bit.length} filas (${[...new Set(bit.map((b) => b.tabla))].join(", ")}), todas del ${rolEsperado}`,
    bit
  );
}

// ═══ 4. Un CUFE, una factura ═══════════════════════════════════════════════
{
  const r = await http(contador, "POST", "/api/finanzas/facturas-externas", pedido(FACTURAS[0]));
  const fe = (r.json.fieldErrors ?? {}) as Record<string, string>;
  marca(r.status === 409 && (fe.cufe ?? "").includes(registradas["1C"]?.invoice_number ?? "??"),
    `4a. CUFE repetido (la 1C otra vez): ${r.status} · «${fe.cufe}»`, r.json);

  // El CUFE de una factura del CRM (autorizada por el PAC, origen crm) contra el
  // RPC directo: la app la frenaría antes por el punto y el ambiente.
  const delCrm = await uno<{ invoice_number: string; dgi_cufe: string }>(
    "select invoice_number, dgi_cufe from invoices where tenant_id=$1 and dgi_cufe_origen='crm' order by invoice_number limit 1", [T]);
  await db.query("BEGIN");
  await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',true)`);
  let msg = "";
  try {
    await db.query(
      "select register_external_invoice($1,$2,'HONORARIOS',null,'2026-07-14','2026-07-14','2026-07-14',null,$3,'100',2,150,10.5,$4::jsonb,'[]'::jsonb,null)",
      [T, clientes["1C"], delCrm.dgi_cufe, JSON.stringify([{ service_id: servicio.id, description: "Prueba", quantity: 1, unit_price: 150, tax_code_id: tasa.id, tax_code: tasa.code, tax_rate: Number(tasa.rate) }])]);
  } catch (e) {
    msg = (e as Error).message;
  }
  await db.query("ROLLBACK");
  marca(msg.includes(delCrm.invoice_number), `4b. el CUFE de ${delCrm.invoice_number} (emitida por el CRM) contra el RPC: «${msg}»`);

  // Al revés: el CUFE de la 1C cargado a mano (caso B) en otra factura.
  const otra = await uno<{ id: string; invoice_number: string }>(
    "select id, invoice_number from invoices where tenant_id=$1 and status='emitida' and dgi_cufe is null and dgi_cufe_origen is null order by created_at limit 1", [T]);
  if (otra) {
    const c = await http(abogada, "POST", `/api/finanzas/invoices/${otra.id}/cufe`, { cufe: FACTURAS[0].cufe });
    marca(c.status === 409 && String(c.json.error ?? "").includes(registradas["1C"]?.invoice_number ?? "??"),
      `4c. el CUFE de la 1C cargado a mano en ${otra.invoice_number}: ${c.status} · «${c.json.error}»`, c.json);
  } else {
    console.log("⚪ 4c. no hay una factura emitida sin CUFE para probar la carga manual");
  }

  // Y el índice único, directo en la base.
  let idx = "";
  await db.query("BEGIN");
  try {
    await db.query("update invoices set dgi_cufe=lower($2), dgi_cufe_origen='portal_050' where id=$1", [otra?.id, FACTURAS[1].cufe]);
  } catch (e) {
    idx = `${(e as { code?: string }).code} ${(e as Error).message}`;
  }
  await db.query("ROLLBACK");
  marca(idx.startsWith("23505"), `4d. el índice único rechaza el mismo CUFE en minúsculas en otra factura: «${idx.slice(0, 90)}»`);
}

// ═══ 5 (cont.). El RPC también rechaza si alguien se saltea la app ═════════
{
  const f = FACTURAS[1];
  // El CUFE de la 2B con el dígito final cambiado: no está registrado y se lee igual
  // (fecha, número, punto). Así el RPC llega a las comparaciones.
  const cufeAlt = f.cufe.slice(0, 65) + (f.cufe[65] === "8" ? "9" : "8");
  const linea = JSON.stringify([{ service_id: servicio.id, description: "Prueba", quantity: 1, unit_price: f.base, tax_code_id: tasa.id, tax_code: tasa.code, tax_rate: Number(tasa.rate) }]);
  const intentar = async (fecha: string, base: number) => {
    await db.query("BEGIN");
    await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',true)`);
    let m = "";
    try {
      await db.query(
        "select register_external_invoice($1,$2,'HONORARIOS',null,$3::date,$3::date,$3::date,null,$4,'100',3,$5,10.5,$6::jsonb,'[]'::jsonb,null)",
        [T, clientes["2B"], fecha, cufeAlt, base, linea]);
    } catch (e) {
      m = (e as Error).message;
    }
    await db.query("ROLLBACK");
    return m;
  };
  const mFecha = await intentar("2026-07-15", 150);
  marca(/del 14\/07\/2026/.test(mFecha), `5d. RPC con la fecha distinta del CUFE: «${mFecha}»`);
  const mMonto = await intentar("2026-07-14", 160);
  marca(/no coinciden con el documento autorizado/.test(mMonto), `5e. RPC con el monto distinto del documento: «${mMonto}»`);
}

// ═══ 6. Nunca al PAC ═══════════════════════════════════════════════════════
{
  const ext = registradas["1C"];
  if (ext) {
    const e = await http(admin, "POST", `/api/finanzas/invoices/${ext.id}/emit-efactura`, {});
    marca(e.status === 409 && /emitió fuera del CRM/.test(String(e.json.error ?? "")), `6a. «Enviar a la DGI» sobre ${ext.invoice_number}: ${e.status} · «${e.json.error}»`, e.json);
    const p = await http(contador, "GET", `/api/finanzas/invoices/${ext.id}/pdf`);
    marca(p.status === 409, `6b. sin PDF del CRM: ${p.status} · «${p.json.error}»`, p.json);
    for (const [que, sql] of [
      ["pasarla a pending", "update invoices set fe_estado='pending' where id=$1"],
      ["cambiarle el CUFE", "update invoices set dgi_cufe=dgi_cufe||'X' where id=$1"],
      ["cambiarle el punto", "update invoices set punto_facturacion='051' where id=$1"],
    ] as const) {
      let m = "";
      await db.query("BEGIN");
      try {
        await db.query(sql, [ext.id]);
      } catch (err) {
        m = (err as Error).message;
      }
      await db.query("ROLLBACK");
      marca(/se emitió fuera del CRM/.test(m), `6c. la base no deja ${que}: «${m.slice(0, 80)}…»`);
    }
    let m2 = "";
    await db.query("BEGIN");
    try {
      await db.query("update invoices set dgi_cufe='FE01X', dgi_cufe_origen='externo' where id=(select id from invoices where tenant_id=$1 and dgi_cufe is null limit 1)", [T]);
    } catch (err) {
      m2 = (err as Error).message;
    }
    await db.query("ROLLBACK");
    marca(/sólo se registra con/.test(m2), `6d. nadie marca 'externo' fuera del RPC: «${m2}»`);
  }
  marca((await feSecuencias()) === antes.fe, `6e. fe_secuencias (correlativo del PAC) no se movió: ${await feSecuencias()}`);
}

// ═══ 7. Igual que una factura del CRM ══════════════════════════════════════
{
  const despues = {
    ventasJul: await ventas("2026-07-01", "2026-07-31"),
    ventasOct: await ventas(`${hoy.slice(0, 7)}-01`, hoy),
    itbmsJul: await itbms("2026-07"),
    itbmsOct: await itbms(hoy.slice(0, 7)),
  };
  console.log(`Después: ${JSON.stringify(despues)}`);
  // El saldo de una cuenta de ingreso es ACREEDOR: sube en negativo.
  if (!REVISION) {
  marca(n2(antes.ventasJul.ingresoCuenta - despues.ventasJul.ingresoCuenta) === 300,
    `7a. Estado de Resultado de julio: la cuenta ${servicio.revenue_account} sube 300.00 (las dos de MEI Tower)`, { antes: antes.ventasJul, despues: despues.ventasJul });
  marca(n2(antes.ventasOct.ingresoCuenta - despues.ventasOct.ingresoCuenta) === 350,
    `7b. Estado de Resultado de ${hoy.slice(0, 7)}: sube 350.00 (Mi Condado, registrada hoy)`, { antes: antes.ventasOct, despues: despues.ventasOct });
  marca(n2(despues.itbmsJul - antes.itbmsJul) === 21,
    `7c. ITBMS de julio (exportación del contador): débito ${antes.itbmsJul} → ${despues.itbmsJul} (+21.00)`);
  marca(n2(despues.itbmsOct - antes.itbmsOct) === 24.5,
    `7d. ITBMS de ${hoy.slice(0, 7)}: débito ${antes.itbmsOct} → ${despues.itbmsOct} (+24.50)`);
  }

  const aging = await textoDe("/api/finanzas/reportes/aging/export?tipo=cobrar");
  const enAging = Object.values(registradas).filter((r) => aging.includes(r.invoice_number));
  marca(enAging.length === 3, `7e. antigüedad por cobrar (exportación): las 3 (${enAging.map((r) => r.invoice_number).join(", ")})`);
  for (const nombre of ["CLIENTE EXT PRUEBA 1", "CLIENTE EXT PRUEBA 2", "CLIENTE EXT PRUEBA 3"]) {
    marca(aging.includes(nombre), `7e. antigüedad por cobrar nombra a ${nombre}`);
  }
  const mayorCxc = await textoDe("/api/finanzas/reportes/mayor/export?cuenta=100004&desde=2026-07-01&hasta=" + hoy);
  const enMayor = Object.values(registradas).filter((r) => mayorCxc.includes(r.invoice_number));
  marca(enMayor.length === 3, `7f. Libro Mayor de 100004: las 3 con su número (${enMayor.map((r) => r.invoice_number).join(", ")})`);
  marca(mayorCxc.includes("155000001") && mayorCxc.includes("155000003"), "7f. el Mayor trae el RUC del cliente de cada una");
  const mayorIng = await textoDe(`/api/finanzas/reportes/mayor/export?cuenta=${servicio.revenue_account}&desde=2026-07-01&hasta=${hoy}`);
  marca(Object.values(registradas).every((r) => mayorIng.includes(r.invoice_number)), `7g. Libro Mayor de ${servicio.revenue_account} (ventas): las 3`);
}

// ═══ 9. NO son pendientes de la DGI ni «no emitidas» en ningún aviso ═══════
{
  const despues = await avisos();
  marca(JSON.stringify(despues) === JSON.stringify(antes.avisos),
    `9a. contador de pendientes y avisos iguales antes y después: ${JSON.stringify(despues)}`, { antes: antes.avisos, despues });
  const lista = await listarPendientesDgi(sb as never, T);
  const ids = new Set(Object.values(registradas).map((r) => r.id));
  marca(!lista.some((p) => ids.has((p as { id: string }).id)), `9b. listarPendientesDgi (${lista.length} documentos) no trae ninguna FAC-EXT`);
  const pantalla = await html(contador, "/finanzas/pendientes-dgi");
  marca(!pantalla.includes("FAC-EXT-") && pantalla.length > 1000, "9c. la pantalla /finanzas/pendientes-dgi no muestra ninguna FAC-EXT");
  const listado = await html(admin, "/finanzas/facturas?q=FAC-EXT");
  marca(Object.values(registradas).every((r) => listado.includes(r.invoice_number)), "9d. el listado de facturas sí las muestra (buscando FAC-EXT)");
  marca(listado.includes("Emitida fuera del CRM") && !listado.includes("Sin enviar"),
    "9f. en el listado su estado fiscal dice «Emitida fuera del CRM», ninguna dice «Sin enviar»");
  for (const r of Object.values(registradas)) {
    const d = await html(contador, `/finanzas/facturas/${r.id}`);
    const bien = d.includes("Factura emitida fuera del CRM") && !d.includes("todavía no fue enviada a la DGI") &&
      !d.includes("Enviar a la DGI") && !d.includes("sin autorización de la DGI");
    marca(bien, `9e. detalle de ${r.invoice_number}: «Factura emitida fuera del CRM», sin «Enviar a la DGI» ni aviso de no emitida`);
  }
}

// ═══ 8. La numeración ══════════════════════════════════════════════════════
{
  const s = await secuencias();
  marca(REVISION ? s.invoice_ext === 3 : s.invoice_ext - (antes.seq.invoice_ext ?? 0) === Object.keys(registradas).length,
    `8a. FAC-EXT- avanzó ${s.invoice_ext - (antes.seq.invoice_ext ?? 0)} (= facturas registradas): los rechazos no dejaron hueco`);
  marca(s.invoice_hon === antes.seq.invoice_hon && s.invoice_reim === antes.seq.invoice_reim,
    `8b. FAC-HON- (${s.invoice_hon}) y FAC-REI- (${s.invoice_reim}) no se movieron`);
  const ver = await q("select * from verify_accounting_chain($1)", [T]);
  marca(ver.length === 0, `8c. cadena del libro íntegra (${ver.length} eslabones rotos)`, ver);
}

await db.end();
console.log(`\n${ok} bien · ${fail} mal`);
console.log(`Registradas: ${Object.entries(registradas).map(([k, r]) => `${k} → ${r.invoice_number} (${r.id})`).join(" · ")}`);
process.exit(fail === 0 ? 0 : 1);

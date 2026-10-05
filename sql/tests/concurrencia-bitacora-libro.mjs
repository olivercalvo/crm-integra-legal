/**
 * PRUEBA DE CONCURRENCIA: bitácora y libro, con dos sesiones (desde el 03/10/2026).
 * 🔴 OBLIGATORIA antes de cualquier ventana de producción (runbook, paso −1),
 * junto con verificacion-087-captura-41-tablas.sql.
 * 🛡️ TODO EN ROLLBACK: no deja asientos, documentos, filas de bitácora ni correlativos.
 *
 *   node sql/tests/concurrencia-bitacora-libro.mjs            (20 rondas por combinación)
 *   node sql/tests/concurrencia-bitacora-libro.mjs 50         (otra cantidad)
 *   node sql/tests/concurrencia-bitacora-libro.mjs 3 --control
 *
 * POR QUÉ: hay dos candados por bufete que viven hasta el COMMIT, el del
 * correlativo del libro (J, accounting_sequences FOR UPDATE, post_journal_entry)
 * y el de la bitácora (A, auditoria.escribir). Antes de la 090 la importación de
 * asientos y la NC de compra tomaban A y después J, y un posteo suelto J y después
 * A: intercalados, «deadlock detected» (40P01). La 090 dejó un solo orden (J → A).
 * Esto no cabe en un .sql: hacen falta dos sesiones (no hay dblink en staging).
 *
 * QUÉ HACE, en cada ronda y para cada combinación
 *   X ∈ { importación de asientos (post_journal_entries_batch),
 *         NC de compra (create_supplier_credit_note),
 *         factura emitida fuera (register_external_invoice, 092) }
 *   Y ∈ { emisión de factura, cobro, gasto de trámite }   (escrituras + posteo, en una transacción)
 * fuerza el PEOR orden:
 *   1. X ya pasó su primera escritura auditada (auditoria.tomar_candados, lo mismo que
 *      hace esa escritura desde la 090) y se queda con la transacción abierta;
 *   2. Y arranca su operación completa (tiene que ESPERAR, no trabarse);
 *   3. X corre el RPC real; X ROLLBACK; Y termina; Y ROLLBACK.
 * Falla (exit 1) con un solo 40P01 o cualquier otro error.
 *
 * --control: el paso 1 toma SOLO el candado de la bitácora, como antes de la 090.
 *   Ahí el deadlock tiene que aparecer en todas las rondas. Si no aparece, la prueba
 *   no está midiendo lo que dice, y también sale con exit 1.
 *
 * Lee la credencial de .env.staging-db.local (ignorado por git). Aborta contra producción.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];
const RONDAS = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const CONTROL = process.argv.includes("--control");
const T = "a0000000-0000-0000-0000-000000000001";
const PAUSA = 150;

// ENSAYO_DATABASE_URL: base LOCAL del ensayo de la ventana (sólo localhost).
const ENSAYO = process.env.ENSAYO_DATABASE_URL?.trim();
if (ENSAYO && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(ENSAYO).hostname)) {
  console.error("🛑 ENSAYO_DATABASE_URL sólo puede apuntar a una base local (localhost)."); process.exit(1);
}
const envPath = resolve(ROOT, ".env.staging-db.local");
if (!ENSAYO && !existsSync(envPath)) { console.error(`❌ Falta ${envPath}`); process.exit(1); }
const CONN = ENSAYO || (readFileSync(envPath, "utf8").match(/^STAGING_DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!CONN) { console.error("❌ No se pudo leer STAGING_DATABASE_URL"); process.exit(1); }
for (const ref of PROD_PROJECT_REFS) {
  if (CONN.includes(ref)) { console.error(`\n🛑 ABORTADO: la connection string apunta a PRODUCCIÓN (${ref}).\n`); process.exit(1); }
}

const conectar = async () => { const c = new pg.Client({ connectionString: CONN }); await c.connect(); return c; };
const x = await conectar(), y = await conectar(), ref = await conectar();
const uno = async (sql, p) => (await ref.query(sql, p)).rows[0];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Datos de referencia (sólo lectura) ─────────────────────────────────────
const admin = (await uno("select id from users where tenant_id=$1 and role='admin' and active order by created_at limit 1", [T])).id;
const prov = (await uno("select id from suppliers where tenant_id=$1 and active order by created_at limit 1", [T])).id;
const gasto = (await uno("select code from chart_of_accounts where tenant_id=$1 and active and account_type='expense' and cuenta_control is null order by code limit 1", [T])).code;
const fac = await uno("select id, client_id from invoices where tenant_id=$1 and status in ('emitida','parcialmente_pagada') and balance_due >= 5 order by created_at limit 1", [T]);
const banco = (await uno("select payment_account_code c from payments where tenant_id=$1 and payment_account_code is not null limit 1", [T])).c;
const serv = await uno("select s.id, s.revenue_account from services_catalog s where tenant_id=$1 and active and service_type='honorarios' order by code limit 1", [T]);
const caso = (await uno("select id from cases where tenant_id=$1 order by created_at limit 1", [T])).id;
const hoy = (await uno("select ((now() at time zone 'America/Panama')::date)::text d")).d;
const exento = await uno("select id, code, rate from tax_codes where tenant_id=$1 and rate=0 order by code limit 1", [T]);
if (!admin || !prov || !gasto || !fac || !banco || !serv || !caso || !exento) { console.error("❌ Faltan datos de referencia en staging"); process.exit(1); }

const sesion = async (c) => {
  await c.query("BEGIN");
  await c.query(`select set_config('request.jwt.claims','{"role":"service_role"}',true), set_config('request.headers',$1,true)`, [JSON.stringify({ "x-actor-id": admin })]);
};
const postear = (c, tipo, origen, lineas, refTxt) => c.query(
  "select post_journal_entry($1, $2::date, $3, $4, $5::jsonb, $6, null, null, null, $7, null, $8, null, null) id",
  [T, hoy, `Concurrencia ${tipo}`, tipo, JSON.stringify(lineas), origen, admin, refTxt]);

// ── Lo que hace X: el RPC real ─────────────────────────────────────────────
const X = {
  "importación de asientos": (c, n) => c.query("select post_journal_entries_batch($1,'concurrencia.xlsx',$2,4,$3::jsonb,$4)", [T, `conc-${Date.now()}-${n}`,
    JSON.stringify([1, 2].map((i) => ({ group_label: String(i), first_row: i * 2, transaction_date: hoy, description: `Concurrencia ${i}`, reference: `CONC-${i}`,
      lines: [{ account_code: gasto, debit: 1, credit: 0, description: "a" }, { account_code: gasto, debit: 0, credit: 1, description: "b" }] }))), admin]),
  "NC de compra": (c, n) => c.query("select create_supplier_credit_note($1,null,$2,$3,$4::date,null,'Prueba de concurrencia',$4::date,$5::jsonb,$6::jsonb,$7)", [T, prov, `CONC-${Date.now()}-${n}`, hoy,
    JSON.stringify([{ expense_line_id: null, chart_account_code: gasto, description: "Línea", amount: 1, tax_code_id: null, tax_amount: 0 }]),
    JSON.stringify([{ account_code: "200001", debit: 1, credit: 0, description: "NC", supplier_id: prov }, { account_code: gasto, debit: 0, credit: 1, description: "Línea" }]), admin]),
  // 092: número FAC-EXT-, factura y líneas (auditadas) ANTES del posteo, como la NC de compra.
  // CUFE inventado con la forma de la DGI (punto 100, ambiente 1), distinto en cada ronda; todo en ROLLBACK.
  "factura emitida fuera": (c, n) => {
    const numero = (Date.now() % 1e9) * 10 + (n % 10);
    const cufe = "FE0120000025046169-3-2021-400000" + hoy.replaceAll("-", "") + String(numero).padStart(10, "0") + "1000111234567890";
    return c.query("select register_external_invoice($1,$2,'HONORARIOS',null,$3::date,$3::date,$3::date,null,$4,'100',$5,10,0,$6::jsonb,$7::jsonb,$8)", [T, fac.client_id, hoy, cufe, numero,
      JSON.stringify([{ service_id: serv.id, description: "Concurrencia", quantity: 1, unit_price: 10, tax_code_id: exento.id, tax_code: exento.code, tax_rate: Number(exento.rate) }]),
      JSON.stringify([{ account_code: "100004", debit: 10, credit: 0, description: "Factura {numero}", client_id: fac.client_id },
        { account_code: serv.revenue_account, debit: 0, credit: 10, description: "Concurrencia" }]), admin]);
  },
};

// ── Lo que hace Y: las escrituras del documento y su posteo, en una transacción ──
const Y = {
  "emisión de factura": async (c, n) => {
    const inv = (await c.query(`insert into invoices (tenant_id, invoice_number, invoice_kind, client_id, issue_date, due_date, created_by)
      values ($1,$2,'HONORARIOS',$3,$4,$4,$5) returning id`, [T, `DRAFT-CONC-${Date.now()}-${n}`, fac.client_id, hoy, admin])).rows[0].id;
    await c.query(`insert into invoice_lines (tenant_id, invoice_id, line_order, service_id, description, quantity, unit_price, tax_code, tax_rate)
      values ($1,$2,1,$3,'Concurrencia',1,10,'EXENTO',0)`, [T, inv, serv.id]);
    await postear(c, "factura", inv, [{ account_code: "100004", debit: 10, credit: 0, description: "Cliente", client_id: fac.client_id },
      { account_code: serv.revenue_account, debit: 0, credit: 10, description: "Ingreso" }], `FAC-CONC-${n}`);
    await c.query("update invoices set status='emitida', invoice_number=$2 where id=$1", [inv, `FAC-CONC-${Date.now()}-${n}`]);
  },
  "cobro": async (c, n) => {
    const pago = (await c.query(`insert into payments (tenant_id, payment_number, client_id, payment_date, amount, method, reference, payment_account_code, created_by)
      values ($1,$2,$3,$4,1,'transferencia','CONC',$5,$6) returning id`, [T, `CO-CONC-${Date.now()}-${n}`, fac.client_id, hoy, banco, admin])).rows[0].id;
    await c.query("insert into payment_applications (tenant_id, payment_id, invoice_id, amount_applied, created_by) values ($1,$2,$3,1,$4)", [T, pago, fac.id, admin]);
    await postear(c, "pago", pago, [{ account_code: banco, debit: 1, credit: 0, description: "Banco" },
      { account_code: "100004", debit: 0, credit: 1, description: "Cliente", client_id: fac.client_id }], `CO-CONC-${n}`);
  },
  "gasto de trámite": async (c, n) => {
    const g = (await c.query(`insert into expenses (tenant_id, case_id, amount, concept, registered_by, supplier_id) values ($1,$2,3,'Concurrencia',$3,$4) returning id`,
      [T, caso, admin, prov])).rows[0].id;
    await c.query("insert into expense_lines (tenant_id, expense_id, line_order, description, chart_account_code, amount) values ($1,$2,1,'Timbres',$3,3)", [T, g, "130003"]);
    const e = (await postear(c, "gasto_tramite", g, [{ account_code: "130003", debit: 3, credit: 0, description: "Timbres" },
      { account_code: "200001", debit: 0, credit: 3, description: "Proveedor", supplier_id: prov }], `FAC-CO-CONC-${n}`)).rows[0].id;
    await c.query("update expenses set posted_entry_id=$2 where id=$1", [g, e]);
  },
};

const codigo = (e) => (e ? `${e.code ?? "?"} ${e.message}` : "ok");
const resumen = [];
console.log(`▶ Concurrencia bitácora ↔ libro contra ${ENSAYO ? "la base LOCAL de ensayo" : "staging"} · ${RONDAS} rondas por combinación${CONTROL ? " · MODO CONTROL (orden viejo)" : ""}\n`);

for (const [nx, fx] of Object.entries(X)) {
  for (const [ny, fy] of Object.entries(Y)) {
    const r = { combinacion: `${nx} × ${ny}`, ok: 0, deadlocks: 0, otros: [], esperaMaxY: 0 };
    for (let n = 1; n <= RONDAS; n++) {
      await sesion(x); await sesion(y);
      // 1. X ya pasó su primera escritura auditada.
      await x.query(CONTROL ? "select pg_advisory_xact_lock(hashtextextended('auditoria:' || $1::text, 0))" : "select auditoria.tomar_candados($1)", [T]);
      // 2. Y arranca entero.
      const t0 = Date.now();
      const py = fy(y, n).then(() => null, (e) => e).then((e) => ({ e, ms: Date.now() - t0 }));
      await dormir(PAUSA);
      // 3. X corre el RPC real.
      const ex = await fx(x, n).then(() => null, (e) => e);
      await x.query("ROLLBACK");
      const ry = await py;
      await y.query("ROLLBACK");
      for (const e of [ex, ry.e]) {
        if (!e) continue;
        // Desde la 091 un deadlock dentro de la bitácora sale como AU001 con el
        // código original en el DETAIL («[40P01] deadlock detected»).
        if (e.code === "40P01" || (e.code === "AU001" && /^\[40P01\]/.test(e.detail ?? ""))) r.deadlocks++;
        else r.otros.push(codigo(e));
      }
      if (!ex && !ry.e) r.ok++;
      r.esperaMaxY = Math.max(r.esperaMaxY, ry.ms);
    }
    resumen.push(r);
    console.log(`  ${r.combinacion.padEnd(48)} rondas ${RONDAS} · bien ${r.ok} · deadlocks ${r.deadlocks} · otros errores ${r.otros.length} · espera máx. de Y ${r.esperaMaxY} ms`);
    for (const o of [...new Set(r.otros)]) console.log(`      ${o}`);
  }
}

await x.end(); await y.end(); await ref.end();
const total = resumen.reduce((s, r) => s + RONDAS, 0);
const dl = resumen.reduce((s, r) => s + r.deadlocks, 0);
const otros = resumen.reduce((s, r) => s + r.otros.length, 0);
console.log(`\nTotal: ${total} rondas · deadlocks ${dl} · otros errores ${otros}`);
if (CONTROL) {
  const todas = resumen.every((r) => r.deadlocks === RONDAS);
  console.log(todas ? "✅ control: con el orden viejo el deadlock aparece en todas las rondas (la prueba lo detecta)" : "❌ control: el deadlock NO apareció en todas las rondas; la prueba no mide lo que dice");
  process.exit(todas ? 0 : 1);
}
console.log(dl === 0 && otros === 0 ? "✅ cero deadlocks: bitácora y libro toman los candados en el mismo orden" : "❌ FALLÓ");
process.exit(dl === 0 && otros === 0 ? 0 : 1);

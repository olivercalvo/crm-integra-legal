/**
 * PRUEBA DE CONCURRENCIA: dos corridas del MISMO mes a la vez (097 y 098).
 *
 *   ENSAYO_DATABASE_URL=postgresql://postgres@localhost:54329/posteo \
 *     node sql/tests/concurrencia-posteo-retroactivo.mjs            (5 rondas)
 *   … node sql/tests/concurrencia-posteo-retroactivo.mjs 20
 *
 * 🛑 SÓLO contra una base LOCAL desechable (la copia del ensayo con la ventana
 *    aplicada). Para probar que «una termina y la otra falla» la ganadora tiene
 *    que CONFIRMAR, y un asiento confirmado no se borra: en staging o en
 *    producción quedaría en el libro. Por eso el script rechaza todo lo que no
 *    sea localhost, y no lee .env.staging-db.local.
 *
 * En cada ronda:
 *   1. Fabrica (y confirma) dos facturas del mes del inicio contable.
 *   2. Dos sesiones arrancan A LA VEZ la misma llamada a
 *      post_documentos_existentes con los mismos asientos.
 *   3. La primera que termina confirma. La otra tiene que FALLAR (índice único
 *      del libro), deshacerse entera y no dejar nada: ni asientos, ni lote,
 *      ni correlativo (el número siguiente es el de la ganadora + 1).
 *   4. Mientras la ganadora no confirma, la perdedora tiene que estar ESPERANDO
 *      un candado (no escribiendo en paralelo).
 * Sale con exit 1 si algo de eso no se cumple.
 */
import pg from "pg";

const URL_ = process.env.ENSAYO_DATABASE_URL?.trim();
if (!URL_ || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(URL_).hostname)) {
  console.error("🛑 Esta prueba CONFIRMA asientos: sólo corre contra una base local (ENSAYO_DATABASE_URL en localhost).");
  process.exit(1);
}
const RONDAS = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);
const T = "a0000000-0000-0000-0000-000000000001";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const conectar = async () => { const c = new pg.Client({ connectionString: URL_ }); await c.connect(); return c; };

const ref = await conectar();
const uno = async (sql, p) => (await ref.query(sql, p)).rows[0];
await ref.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);

const ini = (await uno("select public.finanzas_inicio_contable($1)::text d", [T])).d;
const fin = (await uno("select (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text d", [ini])).d;
const base = await uno(
  "select to_jsonb(i) j, client_id from invoices i where tenant_id=$1 and status='emitida' and not de_prueba order by created_at desc limit 1", [T]);
if (!base) { console.error("❌ No hay una factura emitida para copiar."); process.exit(1); }
const ingreso = (await uno(
  "select code from chart_of_accounts where tenant_id=$1 and active and account_type='income' and cuenta_control is null order by code limit 1", [T])).code;
const cols = (await uno(
  "select string_agg(quote_ident(column_name), ', ' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='invoices' and is_generated='NEVER'")).c;
console.log(`▶ ${RONDAS} ronda(s) · mes ${ini} a ${fin} · ingreso ${ingreso}\n`);

let fallas = 0;
for (let r = 1; r <= RONDAS; r++) {
  // 1. Dos facturas nuevas, confirmadas.
  const ids = [];
  for (const k of [1, 2]) {
    const sufijo = `${Date.now()}${r}${k}`.slice(-9);
    const fila = { ...base.j, id: undefined, invoice_number: `CONC-097-${sufijo}`, issue_date: ini, accounting_date: ini,
      due_date: fin, dgi_cufe: null, dgi_cufe_origen: null, amount_paid: 0, credited_total: 0, de_prueba: false };
    delete fila.id;
    const { rows } = await ref.query(
      `insert into invoices (${cols.replace(/(^|, )id(, |$)/, "$1")}) select ${cols.replace(/(^|, )id(, |$)/, "$1")}
         from jsonb_populate_record(null::invoices, $1) returning id`, [fila]);
    ids.push(rows[0].id);
  }
  const lineas = [
    { account_code: "100004", debit: 10, credit: 0, description: "Concurrencia 097", client_id: base.client_id },
    { account_code: ingreso, debit: 0, credit: 10, description: "Concurrencia 097" },
  ];
  const items = ids.map((id, i) => ({ transaction_date: ini, description: `Factura concurrencia ${i + 1}`,
    source_type: "factura", source_id: id, reference: `CONC-${i + 1}`, idempotency_key: `factura:${id}`, lines: lineas }));
  const lotesAntes = Number((await uno("select count(*) n from posteos_retroactivos where tenant_id=$1", [T])).n);
  const seqAntes = Number((await uno("select last_number n from accounting_sequences where tenant_id=$1 and sequence_type='journal_entry'", [T])).n);

  // 2. Dos sesiones, a la vez.
  const [a, b] = [await conectar(), await conectar()];
  for (const s of [a, b]) {
    await s.query("begin");
    await s.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  }
  const pidB = (await b.query("select pg_backend_pid() p")).rows[0].p;
  const pidA = (await a.query("select pg_backend_pid() p")).rows[0].p;
  const llamar = (s, nombre) =>
    s.query("select public.post_documentos_existentes($1, $2, $3, $4, null) r", [T, ini, fin, JSON.stringify(items)])
      .then((x) => ({ nombre, s, ok: true, r: x.rows[0].r }), (e) => ({ nombre, s, ok: false, e }));
  const pa = llamar(a, "A"), pb = llamar(b, "B");
  const primera = await Promise.race([pa, pb]);
  const otra = primera.nombre === "A" ? pb : pa;
  const pidOtra = primera.nombre === "A" ? pidB : pidA;

  // 4. La otra tiene que estar esperando un candado, no escribiendo.
  await dormir(300);
  const espera = await uno("select wait_event_type w from pg_stat_activity where pid=$1", [pidOtra]);
  const esperaba = espera?.w === "Lock";

  // 3. La primera confirma; la otra falla y se deshace.
  if (!primera.ok) { console.log(`❌ ronda ${r}: la primera (${primera.nombre}) falló: ${primera.e.message}`); fallas++; }
  await primera.s.query(primera.ok ? "commit" : "rollback");
  const segunda = await otra;
  await segunda.s.query("rollback");
  await a.end(); await b.end();

  const lotes = Number((await uno("select count(*) n from posteos_retroactivos where tenant_id=$1", [T])).n);
  const porDoc = (await ref.query(
    "select source_id, count(*) n from journal_entries where tenant_id=$1 and source_id = any($2) group by source_id", [T, ids])).rows;
  const seq = Number((await uno("select last_number n from accounting_sequences where tenant_id=$1 and sequence_type='journal_entry'", [T])).n);
  const bien = primera.ok && !segunda.ok && esperaba && lotes === lotesAntes + 1
    && porDoc.length === 2 && porDoc.every((x) => Number(x.n) === 1) && seq === seqAntes + 2;
  console.log(`${bien ? "✅" : "❌"} ronda ${r}: ${primera.nombre} confirmó ${JSON.stringify(primera.r?.asientos?.map((x) => x.entry_number))}; ` +
    `${segunda.nombre} ${segunda.ok ? "TAMBIÉN escribió" : `falló (${segunda.e.code} ${segunda.e.message.split("\n")[0]})`}; ` +
    `esperaba un candado: ${esperaba ? "sí" : "NO"}; lotes +${lotes - lotesAntes}; correlativo +${seq - seqAntes}`);
  if (!bien) fallas++;
}
await ref.end();
console.log(fallas ? `\n❌ ${fallas} ronda(s) mal.` : `\n✅ ${RONDAS} de ${RONDAS}: una termina, la otra falla sin escribir nada.`);
process.exit(fallas ? 1 : 0);

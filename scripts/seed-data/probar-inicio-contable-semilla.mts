/**
 * Prueba del helper de la semilla (096) contra la base LOCAL del ensayo.
 *
 *   ENSAYO_DATABASE_URL=postgresql://postgres@localhost:54329/ventana \
 *     npx tsx scripts/seed-data/probar-inicio-contable-semilla.mts
 *
 * 1. Con el inicio en 01/07/2026, un cobro de junio se rechaza.
 * 2. Con el inicio bajado, el mismo cobro se crea (como en la siembra), y se le
 *    postea asiento.
 * 3. Al restaurar (con ese asiento de junio en el libro, que el guard rechazaría)
 *    el inicio vuelve al 01/07/2026, y un cobro de junio vuelve a rechazarse.
 * Todo lo creado queda en la base local; se rehace con `ensayo.mjs base`.
 */
import pg from "pg";
const semilla = await import("./inicio-contable-semilla.ts");
const { bajarInicioParaSembrar, INICIO_DE_STAGING } = ((semilla as { default?: typeof semilla }).default ?? semilla) as typeof import("./inicio-contable-semilla.ts");

const URL = process.env.ENSAYO_DATABASE_URL;
if (!URL || !URL.includes("localhost")) throw new Error("Sólo contra la base LOCAL del ensayo.");
const T = "a0000000-0000-0000-0000-000000000001";
const c = new pg.Client({ connectionString: URL });
await c.connect();
let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`${cond ? "✅" : "❌"} ${que}`);
  if (!cond) fallas += 1;
};
const [{ cli }] = (await c.query("select client_id as cli from invoices where tenant_id=$1 limit 1", [T])).rows;
const cobroDeJunio = (ref: string) =>
  c.query(
    "insert into payments (tenant_id, client_id, payment_date, amount, method, reference, status) values ($1,$2,'2026-06-15',1,'transferencia',$3,'registrado') returning id",
    [T, cli, ref]
  );

try {
  await cobroDeJunio("SEMILLA-096-ANTES");
  ok(false, "1. con el inicio en 01/07 se creó un cobro de junio");
} catch (e) {
  ok(/La fecha del cobro/.test((e as Error).message), `1. rechazado: ${(e as Error).message.slice(0, 90)}…`);
}

const restaurar = await bajarInicioParaSembrar(T);
let pagoId = "";
try {
  pagoId = (await cobroDeJunio("SEMILLA-096-DURANTE")).rows[0].id;
  await c.query(
    `select post_journal_entry($1, current_date, 'Semilla 096', 'pago',
       jsonb_build_array(jsonb_build_object('account_code','100001','debit',1,'credit',0,'description','x'),
                         jsonb_build_object('account_code','100004','debit',0,'credit',1,'description','x','client_id',$2::text)),
       $3::uuid, null, null, null, null, null, null, 'pago:' || $3, null)`,
    [T, cli, pagoId]
  );
  ok(true, "2. con el inicio bajado: cobro de junio creado y con asiento (como la siembra)");
} finally {
  await restaurar();
}

const [{ f }] = (await c.query("select to_char(public.finanzas_inicio_contable($1),'YYYY-MM-DD') f", [T])).rows;
ok(f === INICIO_DE_STAGING, `3. el inicio volvió a ${f}, aunque el guard lo habría rechazado (asiento de junio en el libro)`);
try {
  await cobroDeJunio("SEMILLA-096-DESPUES");
  ok(false, "3. después de restaurar se creó un cobro de junio");
} catch (e) {
  ok(/La fecha del cobro/.test((e as Error).message), "3. y un cobro de junio vuelve a rechazarse");
}
const [{ g }] = (await c.query("select tgenabled g from pg_trigger where tgname='trg_inicio_contable_guard'")).rows;
ok(g === "O", "el guard quedó activo");
await c.end();
console.log(fallas === 0 ? "\n✅ TODO OK" : `\n❌ ${fallas} FALLA(S)`);
process.exit(fallas === 0 ? 0 : 1);

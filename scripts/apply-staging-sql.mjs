/**
 * Aplica las migraciones en la base de STAGING por conexión directa a Postgres.
 *
 *   node scripts/apply-staging-sql.mjs           → los dos bundles, en orden
 *   node scripts/apply-staging-sql.mjs --check   → solo verifica y no escribe nada
 *
 * CREDENCIAL
 *   Lee `STAGING_DATABASE_URL` de `.env.staging-db.local` (ignorado por git vía
 *   `.env*.local`). Es la connection string del **session pooler** (puerto 5432):
 *   el pooler de transacción (6543) no sirve acá porque no soporta prepared
 *   statements ni settings de sesión.
 *
 * CANDADO
 *   Aborta si el usuario de la conexión referencia un project ref de PRODUCCIÓN.
 *   La lista es la misma de `src/lib/env/app-env.ts`, repetida acá porque este
 *   script corre con `node` y no puede importar el módulo TypeScript.
 *   ⚠️ Si alguna vez cambia el proyecto de producción, hay que tocar TRES
 *   archivos: `src/lib/env/app-env.ts`, `scripts/backup-supabase.mjs` y este.
 *
 * POR QUÉ NO ALCANZA CON LA SERVICE KEY
 *   PostgREST no ejecuta DDL, `/pg/query` da 404 y no hay RPC `exec_sql`.
 *   (Ese 404 es también la razón por la que `scripts/run-migration.mjs` nunca
 *   funcionó: apunta justo a ese endpoint.)
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

import { BUNDLE_1, BUNDLE_2 } from "./staging-migration-order.mjs";
import { AUTH_FUNC_RE } from "./staging-auth-helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];
const SOLO_CHECK = process.argv.includes("--check");

// --------------------------------------------------------------- credencial
const envPath = resolve(ROOT, ".env.staging-db.local");
if (!existsSync(envPath)) {
  console.error(
    `\n❌ Falta ${envPath}\n\n` +
      `   Creá el archivo con una línea:\n` +
      `   STAGING_DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres\n`
  );
  process.exit(1);
}
const CONN = (readFileSync(envPath, "utf8").match(/^STAGING_DATABASE_URL=(.*)$/m) || [])[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");

if (!CONN) {
  console.error("\n❌ No encuentro STAGING_DATABASE_URL en .env.staging-db.local\n");
  process.exit(1);
}

// --------------------------------------------------------------- candado
// En el pooler el usuario tiene la forma `postgres.<project_ref>`, así que el
// ref viaja ahí. Se chequea la cadena entera por si el formato cambia.
const refEnUsuario = (CONN.match(/postgres\.([a-z0-9]+)/) || [])[1] || "(no detectado)";
for (const prod of PROD_PROJECT_REFS) {
  if (CONN.includes(prod)) {
    console.error(
      `\n❌ ABORTADO — la connection string apunta al proyecto de PRODUCCIÓN (${prod}).\n` +
        `   Este script no corre migraciones contra la base real. Nunca.\n`
    );
    process.exit(1);
  }
}

// --------------------------------------------------------------- ejecución
const { Client } = pg;
const client = new Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });

async function correrArchivo(rel, i, total) {
  const crudo = readFileSync(resolve(ROOT, rel), "utf8");

  // Se quitan los CREATE FUNCTION del esquema auth: el rol `postgres` no tiene
  // CREATE ahí. Van en bundle-0, que se pega en el SQL Editor. Ver
  // scripts/staging-auth-helpers.mjs para el detalle de por qué.
  const quitados = (crudo.match(AUTH_FUNC_RE) || []).length;
  const sql = crudo.replace(AUTH_FUNC_RE, "");
  const etiqueta = `[${String(i + 1).padStart(2, " ")}/${total}] ${rel}`;

  if (sql.replace(/--[^\n]*/g, "").trim() === "") {
    console.log(`  ⏭️  ${etiqueta} — solo funciones de auth, ya aplicadas vía bundle-0`);
    return true;
  }

  try {
    await client.query(sql);
    console.log(`  ✅ ${etiqueta}${quitados ? `  (${quitados} función(es) de auth omitidas → bundle-0)` : ""}`);
    return true;
  } catch (err) {
    console.error(`\n  ❌ ${etiqueta}`);
    console.error(`     ${err.message}`);
    if (err.position) console.error(`     posición ${err.position}`);
    if (err.detail) console.error(`     detalle: ${err.detail}`);
    if (err.hint) console.error(`     hint: ${err.hint}`);
    return false;
  }
}

async function verificar() {
  const q = async (sql) => (await client.query(sql)).rows;

  const [{ n: tablas }] = await q(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'`
  );
  const [{ n: policies }] = await q(
    `SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public'`
  );
  const [{ n: triggers }] = await q(
    `SELECT COUNT(DISTINCT tgname)::int AS n FROM pg_trigger t
     JOIN pg_class c ON c.oid=t.tgrelid
     JOIN pg_namespace ns ON ns.oid=c.relnamespace
     WHERE ns.nspname='public' AND NOT t.tgisinternal`
  );
  const ledger = await q(
    `SELECT tgname FROM pg_trigger WHERE tgname IN
      ('trg_je_no_update','trg_je_no_delete','trg_jel_no_update',
       'trg_jel_no_delete','trg_leg_no_update','trg_leg_no_delete')
     ORDER BY tgname`
  );
  // Estas dos dependen de tablas que pueden no existir todavía (correr --check
  // contra una base vacía es un uso legítimo), así que no tumban el reporte.
  const qSuave = async (sql) => {
    try {
      return await q(sql);
    } catch {
      return null;
    }
  };
  const seqs = await qSuave(
    `SELECT sequence_type, last_number FROM numbering_sequences
     WHERE tenant_id='a0000000-0000-0000-0000-000000000001' ORDER BY sequence_type`
  );
  const cuentas = await qSuave(
    `SELECT active, COUNT(*)::int AS n FROM chart_of_accounts
     WHERE tenant_id='a0000000-0000-0000-0000-000000000001'
     GROUP BY active ORDER BY active DESC`
  );

  console.log("\n┌─ VERIFICACIÓN DEL ESQUEMA EN STAGING ────────────");
  console.log(`│ Tablas en public          : ${tablas}`);
  console.log(`│ Políticas RLS             : ${policies}`);
  console.log(`│ Triggers (no internos)    : ${triggers}`);
  console.log(`│ Triggers del ledger       : ${ledger.length}/6 → ${ledger.map((r) => r.tgname).join(", ") || "ninguno"}`);
  console.log(`│ Plan de cuentas           : ${cuentas ? cuentas.map((c) => `${c.n} ${c.active ? "activas" : "inactivas"}`).join(", ") || "vacío" : "tabla inexistente"}`);
  console.log(`│ Secuencias                : ${seqs ? seqs.map((s) => `${s.sequence_type}=${s.last_number}`).join(", ") || "ninguna" : "tabla inexistente"}`);
  console.log("└──────────────────────────────────────────────────");

  return { tablas, policies, triggers, ledger: ledger.length };
}

(async () => {
  console.log(`\n🗄️  Migraciones sobre STAGING (project ref ${refEnUsuario})`);
  console.log(`🔒 Candado OK — no es ninguno de los refs de producción.\n`);

  await client.connect();
  const [{ v }] = (await client.query("SELECT version() AS v")).rows;
  console.log(`   ${v.split(",")[0]}\n`);

  // Las políticas de RLS de todo el esquema llaman a auth.tenant_id(). Si no
  // está, el primer CREATE POLICY revienta y deja la base a medio aplicar.
  const [{ n: helpers }] = (
    await client.query(
      `SELECT COUNT(*)::int AS n FROM pg_proc p
       JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'auth' AND p.proname IN ('tenant_id', 'user_role')`
    )
  ).rows;

  if (helpers < 2 && !SOLO_CHECK) {
    console.error(
      `
❌ FALTAN LOS HELPERS DE RLS (auth.tenant_id / auth.user_role): ${helpers}/2

` +
        `   No se pueden crear desde acá: el rol \`postgres\` no tiene CREATE sobre el
` +
        `   esquema \`auth\` en los proyectos Supabase nuevos, y no se puede escalar.

` +
        `   Pegá sql/staging/bundle-0-auth-helpers.sql en el SQL Editor del dashboard
` +
        `   de staging (corre como dashboard_user, que sí tiene el permiso) y volvé
` +
        `   a correr este script.
`
    );
    await client.end();
    process.exit(1);
  }
  console.log(`   Helpers de RLS en auth: ${helpers}/2
`);

  if (SOLO_CHECK) {
    await verificar();
    await client.end();
    return;
  }

  const grupos = [
    ["BUNDLE 1 — esquema base (supabase/migrations)", BUNDLE_1],
    ["BUNDLE 2 — sql/pending", BUNDLE_2],
  ];

  for (const [titulo, archivos] of grupos) {
    console.log(`\n▶ ${titulo}`);
    for (let i = 0; i < archivos.length; i++) {
      const bien = await correrArchivo(archivos[i], i, archivos.length);
      if (!bien) {
        console.error(
          `\n⛔ Cortado en ${archivos[i]}. Los archivos anteriores YA se aplicaron:\n` +
            `   arreglá ese archivo y volvé a correr desde ahí.\n`
        );
        await client.end();
        process.exit(1);
      }
    }
  }

  await verificar();
  await client.end();
  console.log("\n✅ Esquema aplicado. Siguiente: npm run seed:staging\n");
})().catch(async (err) => {
  console.error(`\n❌ ${err.message}\n`);
  try {
    await client.end();
  } catch {
    /* ya cerrado */
  }
  process.exit(1);
});

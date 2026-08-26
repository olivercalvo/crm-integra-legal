/**
 * Aplica las migraciones en la base de STAGING por conexión directa a Postgres.
 *
 *   node scripts/apply-staging-sql.mjs           → aplica todo, en orden
 *   node scripts/apply-staging-sql.mjs --reset   → borra el esquema public y aplica de cero
 *   node scripts/apply-staging-sql.mjs --check   → solo verifica y no escribe nada
 *
 *   Las migraciones del repo NO son idempotentes entre sí (`CREATE TABLE` y
 *   `CREATE INDEX` pelados, sin IF NOT EXISTS). Si una corrida se corta a la
 *   mitad, reintentar sin `--reset` falla con "already exists" en el archivo 1.
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
 *
 * DIVERGENCIA CON PRODUCCIÓN
 *   En staging los helpers de RLS viven en `public`, no en `auth`: el esquema
 *   `auth` está cerrado en los proyectos Supabase nuevos, para el rol de la
 *   conexión Y para el del SQL Editor. Este script reescribe las referencias
 *   al vuelo. Detalle completo en `scripts/staging-public-helpers.mjs`.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

import { BUNDLE_1, BUNDLE_2 } from "./staging-migration-order.mjs";
import { PRELUDE_SQL, reescribirHelpers } from "./staging-public-helpers.mjs";
import { aplicarFixups } from "./staging-fixups.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];
const SOLO_CHECK = process.argv.includes("--check");
const RESET = process.argv.includes("--reset");

/**
 * Deja la base como recién creada. Las migraciones NO son idempotentes entre
 * sí (`CREATE TABLE` pelado, `CREATE INDEX` pelado), así que si una corrida se
 * corta a la mitad la única forma limpia de reintentar es arrancar de cero.
 *
 * Toca `public` y las políticas propias de `storage.objects`. NO toca el
 * esquema `auth`: los usuarios de prueba sobreviven, y el seed los reutiliza
 * por email.
 */
const RESET_SQL = `
DROP POLICY IF EXISTS "tenant_scoped_read_documents"   ON storage.objects;
DROP POLICY IF EXISTS "tenant_scoped_insert_documents" ON storage.objects;
DROP POLICY IF EXISTS "tenant_scoped_update_documents" ON storage.objects;
DROP POLICY IF EXISTS "tenant_scoped_delete_documents" ON storage.objects;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

GRANT USAGE, CREATE ON SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
`;

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
  // Se reescriben auth.tenant_id / auth.user_role → public.*: el esquema `auth`
  // está cerrado en los proyectos Supabase nuevos. Es cambio de nombre, no de
  // lógica. Ver scripts/staging-public-helpers.mjs.
  const crudo = readFileSync(resolve(ROOT, rel), "utf8");
  const reescrito = reescribirHelpers(crudo);
  const { sql, aplicados } = aplicarFixups(rel, reescrito);
  const notas = [];
  if (reescrito !== crudo) notas.push("helpers auth.* → public.*");
  notas.push(...aplicados);
  const etiqueta = `[${String(i + 1).padStart(2, " ")}/${total}] ${rel}`;

  try {
    await client.query(sql);
    console.log(`  ✅ ${etiqueta}${notas.length ? `\n       ↳ ${notas.join("\n       ↳ ")}` : ""}`);
    return true;
  } catch (err) {
    console.error(`
  ❌ ${etiqueta}`);
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

  if (RESET) {
    await client.query(RESET_SQL);
    console.log("   🧹 Esquema public recreado desde cero (auth intacto)\n");
  }

  // Prelude: los helpers en `public`. Van antes de todo porque las tablas de
  // Finanzas usan public.get_tenant_id() como DEFAULT de la columna tenant_id,
  // y las políticas de RLS llaman a public.tenant_id().
  if (!SOLO_CHECK) {
    await client.query(PRELUDE_SQL);
    console.log("   Prelude aplicado: helpers en el esquema public\n");
  }

  const [{ n: helpers }] = (
    await client.query(
      `SELECT COUNT(*)::int AS n FROM pg_proc p
       JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public'
         AND p.proname IN ('tenant_id', 'user_role', 'get_tenant_id', 'get_user_role')`
    )
  ).rows;
  console.log(`   Helpers en public: ${helpers}/4\n`);

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

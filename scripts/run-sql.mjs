/**
 * Corre UN archivo .sql contra staging.
 *
 *   node scripts/run-sql.mjs sql/pending/030_ledger_permisos_y_periodos.sql
 *   node scripts/run-sql.mjs sql/tests/motor-posteo.test.sql
 *
 * PARA QUÉ:
 *   · Aplicar una migración incremental sin rehacer la base entera con
 *     `apply-staging-sql.mjs --reset`.
 *   · Correr las pruebas de `sql/tests/`, que necesitan una sesión SQL de
 *     verdad (transacciones, RAISE NOTICE, ROLLBACK) y no se pueden hacer por
 *     PostgREST.
 *
 * Imprime los RAISE NOTICE, que es donde las migraciones cuentan qué hicieron.
 * Leerlos NO es opcional: así se detectó que la primera versión de la 028
 * dropeaba dos constraints donde debía dropear una.
 *
 * CANDADO ANTI-PRODUCCIÓN: el mismo que `apply-staging-sql.mjs`. Si la
 * connection string apunta a un project ref de producción, aborta sin ejecutar.
 * Lee la credencial de `.env.staging-db.local`, que está ignorado por git.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// La raíz del repo es el padre de scripts/, no hace falta pasarla.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SQL_REL = process.argv[2];
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];

if (!SQL_REL) {
  console.error("uso: node scripts/run-sql.mjs <ruta-al-.sql>");
  process.exit(1);
}

const envPath = resolve(ROOT, ".env.staging-db.local");
if (!existsSync(envPath)) {
  console.error(`❌ Falta ${envPath}`);
  process.exit(1);
}
const CONN = (readFileSync(envPath, "utf8").match(/^STAGING_DATABASE_URL=(.*)$/m) || [])[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");

if (!CONN) {
  console.error("❌ No se pudo leer STAGING_DATABASE_URL");
  process.exit(1);
}

// ---- CANDADO: nunca contra producción ----
for (const ref of PROD_PROJECT_REFS) {
  if (CONN.includes(ref)) {
    console.error(`\n🛑 ABORTADO: la connection string apunta a PRODUCCIÓN (${ref}).\n`);
    process.exit(1);
  }
}

const sqlPath = resolve(ROOT, SQL_REL);
const sql = readFileSync(sqlPath, "utf8");
console.log(`▶ Aplicando ${SQL_REL} contra staging…\n`);

const client = new pg.Client({ connectionString: CONN });
await client.connect();

client.on("notice", (n) => console.log(`   [NOTICE] ${n.message}`));

try {
  const res = await client.query(sql);
  const results = Array.isArray(res) ? res : [res];
  for (const r of results) {
    if (r?.rows?.length) {
      console.table(r.rows);
    }
  }
  console.log("\n✅ Aplicado sin errores.");
} catch (err) {
  console.error(`\n❌ FALLÓ: ${err.message}`);
  if (err.position) console.error(`   posición: ${err.position}`);
  if (err.detail) console.error(`   detalle: ${err.detail}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

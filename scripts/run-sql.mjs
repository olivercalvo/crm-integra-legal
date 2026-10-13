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
import { destinoPermitido } from "./destino-sql.mjs";

// La raíz del repo es el padre de scripts/, no hace falta pasarla.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SQL_REL = process.argv[2];

if (!SQL_REL) {
  console.error("uso: node scripts/run-sql.mjs <ruta-al-.sql>");
  process.exit(1);
}

// ENSAYO DE LA VENTANA (05/10/2026): ENSAYO_DATABASE_URL apunta a una base
// LOCAL (scripts/ensayo-ventana/). Sólo se acepta si el host es esta máquina;
// en ese caso no se leen las credenciales de staging.
const ENSAYO = process.env.ENSAYO_DATABASE_URL?.trim();
if (ENSAYO && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(ENSAYO).hostname)) {
  console.error("🛑 ENSAYO_DATABASE_URL sólo puede apuntar a una base local (localhost).");
  process.exit(1);
}
const envPath = resolve(ROOT, ".env.staging-db.local");
if (!ENSAYO && !existsSync(envPath)) {
  console.error(`❌ Falta ${envPath}`);
  process.exit(1);
}
const CONN = ENSAYO || (readFileSync(envPath, "utf8").match(/^STAGING_DATABASE_URL=(.*)$/m) || [])[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");

if (!CONN) {
  console.error("❌ No se pudo leer STAGING_DATABASE_URL");
  process.exit(1);
}

// ---- CANDADO: sólo staging o una base local, ANTES de conectar ----
// Lista blanca (07/10/2026): antes sólo se rechazaba el ref de producción.
try {
  destinoPermitido(CONN);
} catch (e) {
  console.error(`\n🛑 ${e.message}\n`);
  process.exit(1);
}

const sqlPath = resolve(ROOT, SQL_REL);
const sql = readFileSync(sqlPath, "utf8");
console.log(`▶ Aplicando ${SQL_REL} contra ${ENSAYO ? "la base LOCAL de ensayo" : "staging"}…\n`);

const client = new pg.Client({ connectionString: CONN });
await client.connect();

client.on("notice", (n) => console.log(`   [NOTICE] ${n.message}`));

// LLAVE DE SESIÓN (06/10/2026): RUN_SQL_SET="finanzas.inicio_contable_existentes=aceptar"
// la fija antes del archivo, para toda la sesión. Así una llave que sólo vale en
// staging se ve en el comando y no vive escrita en la migración.
const SET = process.env.RUN_SQL_SET?.trim();
if (SET) {
  const m = SET.match(/^([a-z_]+\.[a-z_]+)=([A-Za-z0-9_-]+)$/);
  if (!m) {
    console.error("❌ RUN_SQL_SET tiene que ser «esquema.llave=valor».");
    process.exit(1);
  }
  await client.query("SELECT set_config($1, $2, false)", [m[1], m[2]]);
  console.log(`   [SET] ${m[1]} = ${m[2]} (sólo esta sesión)
`);
}

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

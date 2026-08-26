/**
 * Arma los bundles de SQL para levantar el esquema en STAGING.
 *
 *   node scripts/build-staging-bundle.mjs
 *
 * Salida: sql/staging/bundle-1-schema-base.sql y sql/staging/bundle-2-pending.sql
 *
 * POR QUÉ EXISTE
 *   El proyecto no usa `supabase db push`: las migraciones se corren a mano en el
 *   SQL Editor (convención desde 2026-04-05). Y con la service_role key NO se puede
 *   ejecutar DDL: PostgREST solo habla de tablas, `/pg/query` responde 404 y no hay
 *   RPC de tipo `exec_sql`. Así que levantar staging es pegar SQL en el editor, y
 *   este script arma ese SQL en el orden correcto en vez de que alguien abra 48
 *   archivos a mano.
 *
 *   (`scripts/run-migration.mjs` apunta a `${SUPABASE_URL}/pg/query`, un endpoint
 *   interno de pg-meta que no está expuesto. Verificado el 2026-08-25: da 404.
 *   Ese script no funciona; este lo reemplaza.)
 *
 * El orden y las exclusiones viven en ./staging-migration-order.mjs.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

import { BUNDLE_1, BUNDLE_2 } from "./staging-migration-order.mjs";
import { PRELUDE_SQL, reescribirHelpers } from "./staging-public-helpers.mjs";
import { aplicarFixups } from "./staging-fixups.mjs";

const HEADER = (titulo, archivos) => `-- ${"=".repeat(75)}
-- ${titulo}
-- ${"-".repeat(75)}
-- GENERADO por scripts/build-staging-bundle.mjs — NO editar a mano.
-- Regenerar con: node scripts/build-staging-bundle.mjs
--
-- ⚠️  SOLO PARA STAGING. Contra producción no se corre NADA de esto: prod ya
--     tiene todo aplicado (ver docs/staging/inventario-migraciones.md).
--
-- Cómo se usa: pegar entero en el SQL Editor del proyecto de STAGING y correr.
-- Si algo falla, el separador "ARCHIVO n/N" de arriba del error dice exactamente
-- en qué migración se cortó, y desde dónde retomar.
--
-- ${archivos.length} archivos en este bundle.
-- ${"=".repeat(75)}

`;

function build(nombre, titulo, archivos, prelude = "") {
  let out = HEADER(titulo, archivos) + prelude;
  let lineas = 0;

  archivos.forEach((rel, i) => {
    // auth.tenant_id / auth.user_role → public.*: el esquema auth está cerrado
    // en los proyectos Supabase nuevos. Ver scripts/staging-public-helpers.mjs.
    const sql = aplicarFixups(rel, reescribirHelpers(readFileSync(resolve(ROOT, rel), "utf8"))).sql;
    lineas += sql.split("\n").length;
    out += `\n\n-- ${"█".repeat(73)}\n`;
    out += `-- ARCHIVO ${i + 1}/${archivos.length}: ${rel}\n`;
    out += `-- ${"█".repeat(73)}\n\n`;
    out += sql.trimEnd() + "\n";
  });

  const dest = resolve(ROOT, "sql/staging", nombre);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out, "utf8");
  console.log(`✅ sql/staging/${nombre} — ${archivos.length} archivos, ${lineas} líneas de SQL`);
}

build("bundle-1-schema-base.sql", "STAGING — BUNDLE 1: esquema base (supabase/migrations)", BUNDLE_1, PRELUDE_SQL);
build("bundle-2-pending.sql", "STAGING — BUNDLE 2: migraciones de sql/pending", BUNDLE_2);

console.log(
  "\nOrden: node scripts/apply-staging-sql.mjs → npm run seed:staging.\n" +
    "(los bundles son el respaldo pegable a mano de exactamente lo que aplica el script.)"
);

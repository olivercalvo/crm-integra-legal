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
import { AUTH_HELPERS_SQL, AUTH_FUNC_RE } from "./staging-auth-helpers.mjs";

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

function build(nombre, titulo, archivos) {
  let out = HEADER(titulo, archivos);
  let lineas = 0;

  archivos.forEach((rel, i) => {
    // Los CREATE FUNCTION del esquema auth salen de acá: van en bundle-0,
    // porque necesitan dashboard_user y el resto no.
    const sql = readFileSync(resolve(ROOT, rel), "utf8").replace(
      AUTH_FUNC_RE,
      "-- [movido a bundle-0-auth-helpers.sql: requiere dashboard_user]"
    );
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

writeFileSync(resolve(ROOT, "sql/staging", "bundle-0-auth-helpers.sql"), AUTH_HELPERS_SQL, "utf8");
console.log("✅ sql/staging/bundle-0-auth-helpers.sql — 2 funciones (va en el SQL Editor)");

build("bundle-1-schema-base.sql", "STAGING — BUNDLE 1: esquema base (supabase/migrations)", BUNDLE_1);
build("bundle-2-pending.sql", "STAGING — BUNDLE 2: migraciones de sql/pending", BUNDLE_2);

console.log(
  "\nOrden: pegar bundle-0 en el SQL Editor → node scripts/apply-staging-sql.mjs → npm run seed:staging.\n" +
    "(bundle-1 y bundle-2 son el respaldo pegable a mano de lo que aplica el script.)"
);

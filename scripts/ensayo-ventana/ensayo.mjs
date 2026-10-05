/**
 * ENSAYO DE LA VENTANA DE PRODUCCIÓN contra una base Postgres LOCAL.
 *
 *   node scripts/ensayo-ventana/ensayo.mjs base        → arma `prod_024`: igual a producción
 *   node scripts/ensayo-ventana/ensayo.mjs ventana     → copia `prod_024` a `ventana` y aplica A, B y C
 *   node scripts/ensayo-ventana/ensayo.mjs bitacoras   → sobre `ventana`, la ventana aparte de las bitácoras
 *
 * La base local: Postgres 17 en localhost:54329 (ENSAYO_PORT), superusuario
 * `supabase_admin` y `postgres` SIN superusuario, como en Supabase. Cómo se
 * levanta: docs/finanzas/runbooks/ventana-bloque-1.md, «Cómo se ensaya».
 *
 * 🛑 Sólo escribe en localhost. De staging sólo LEE (sesión READ ONLY) para
 * copiar los datos del seed de pruebas; producción no se toca.
 *
 * Cada paso deja su registro en docs/finanzas/ensayo-ventana/<fase>.json:
 * archivo, bloque, milisegundos, NOTICE/WARNING y el error si lo hubo.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import pg from "pg";

import {
  COMMIT_PRODUCCION, BASE_PRODUCCION, HOTFIX_PRODUCCION,
  BLOQUE_A, BLOQUE_B, BLOQUE_C, BITACORAS, VERIFICACIONES,
} from "./orden.mjs";
import { PRELUDE_SQL } from "../staging-public-helpers.mjs";
import { aplicarFixups } from "../staging-fixups.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.ENSAYO_PORT ?? 54329);
const LOCAL = { host: "localhost", port: PORT };
const T = "a0000000-0000-0000-0000-000000000001";
const SALIDA = resolve(ROOT, "docs/finanzas/ensayo-ventana");

const cliente = async (user, database) => {
  const c = new pg.Client({ ...LOCAL, user, database });
  await c.connect();
  return c;
};
const sql = (ruta, commit) =>
  commit
    ? execSync(`git show ${commit}:${ruta}`, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    : readFileSync(resolve(ROOT, ruta), "utf8");

/** Corre un archivo entero en una conexión nueva y devuelve el registro. */
async function correr(user, database, ruta, { commit, bloque, fixups } = {}) {
  const c = await cliente(user, database);
  const avisos = [];
  c.on("notice", (n) => avisos.push({ nivel: n.severity, texto: n.message }));
  let texto = sql(ruta, commit);
  // Los dos parches de staging-fixups.mjs describen cómo quedó PRODUCCIÓN al
  // aplicar a mano esos archivos (verificado allí): sólo para la base.
  if (fixups) {
    const f = aplicarFixups(ruta, texto);
    texto = f.sql;
    for (const a of f.aplicados) avisos.push({ nivel: "FIXUP", texto: a });
  }
  const t0 = performance.now();
  let error = null;
  try {
    await c.query(texto);
  } catch (e) {
    error = { mensaje: e.message, detalle: e.detail ?? null, donde: e.where ?? null, codigo: e.code ?? null };
  }
  const ms = Math.round(performance.now() - t0);
  await c.end().catch(() => {});
  return { archivo: ruta.replace(/^.*\//, ""), bloque, ms, error, avisos };
}

function imprimir(r) {
  const advert = r.avisos.filter((a) => a.nivel === "WARNING").length;
  const marca = r.error ? "❌" : advert ? "⚠️" : "✅";
  console.log(`${marca} ${r.bloque.padEnd(14)} ${r.archivo.padEnd(56)} ${String(r.ms).padStart(6)} ms · ${r.avisos.length} avisos${advert ? ` (${advert} WARNING)` : ""}`);
  if (r.error) console.log(`     ${r.error.codigo ?? ""} ${r.error.mensaje}${r.error.detalle ? `\n     detalle: ${r.error.detalle}` : ""}${r.error.donde ? `\n     en: ${r.error.donde.split("\n")[0]}` : ""}`);
}

function guardar(fase, datos) {
  mkdirSync(SALIDA, { recursive: true });
  writeFileSync(resolve(SALIDA, `${fase}.json`), JSON.stringify(datos, null, 2) + "\n");
}

async function recrear(nombre, plantilla) {
  const a = await cliente("supabase_admin", "postgres");
  await a.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [nombre]);
  await a.query(`DROP DATABASE IF EXISTS ${nombre}`);
  await a.query(`CREATE DATABASE ${nombre} OWNER postgres${plantilla ? ` TEMPLATE ${plantilla}` : ""}`);
  await a.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// Datos: el seed de pruebas de staging, recortado a lo que producción tiene
// ─────────────────────────────────────────────────────────────────────────────

/** Tablas que en producción están VACÍAS hoy (relevamiento del 22/09). */
const VACIAS_EN_PRODUCCION = new Set([
  // El libro: «journal_entries 0, el motor entra en una base limpia».
  "journal_entries", "journal_entry_lines", "accounting_periods", "accounting_sequences", "accounting_legajos",
  // «business_expenses 0: el módulo de compras nunca se usó».
  "business_expenses",
]);

/**
 * Filas que crea una migración o una función POSTERIOR a la 024: en producción
 * todavía no existen. Las facturas FAC-EXT- (092) pasan los CHECK de la 024
 * (la columna del origen no existe todavía) pero su secuencia no: sin este
 * filtro la 092 numera desde 1 y choca con ellas.
 */
const facturasPosteriores = new Set();
const CREADAS_DESPUES = {
  chart_of_accounts: (f) => ["200004", "300004", "400009", "440001", "400010"].includes(f.code),
  services_catalog: (f) => ["OTR-ING"].includes(f.code),
  invoices: (f) => facturasPosteriores.has(f.id),
  invoice_lines: (f) => facturasPosteriores.has(f.invoice_id),
  fe_emisiones: (f) => facturasPosteriores.has(f.invoice_id),
  payment_applications: (f) => facturasPosteriores.has(f.invoice_id),
};

/**
 * Valores que staging tiene porque ya pasó por migraciones posteriores, vueltos
 * a como estaban en la 024. Sólo lo que la 024 rechazaría; el resto se copia tal cual.
 */
const A_LA_024 = {
  chart_of_accounts: (f) => ({ ...f, account_type: f.account_type === "cost" ? "expense" : f.account_type }),
};

async function cargarDatos(db) {
  const env = readFileSync(resolve(ROOT, ".env.staging-db.local"), "utf8");
  const CONN = (env.match(/^STAGING_DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  if (!CONN || CONN.includes("uqmmkklbhzxqybljiecs") || !CONN.includes("xtyenhakplrkyifbcaow")) {
    throw new Error("La fuente de datos tiene que ser STAGING (xtyenhakplrkyifbcaow).");
  }
  const st = new pg.Client({ connectionString: CONN });
  await st.connect();
  await st.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  for (const r of (await st.query("SELECT id FROM public.invoices WHERE invoice_number LIKE 'FAC-EXT-%'")).rows) {
    facturasPosteriores.add(r.id);
  }

  const loc = await cliente("supabase_admin", db);
  const tablas = (await loc.query(`
    SELECT c.relname AS tabla
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)).rows.map((r) => r.tabla);

  // Lo que dejaron las migraciones de la base (catálogos del seed_data, el
  // tenant) se reemplaza por lo de staging, que es el mismo seed más completo.
  await loc.query(`TRUNCATE ${tablas.map((t) => `public."${t}"`).join(", ")} CASCADE`);
  await loc.query("SET session_replication_role = replica");
  await loc.query("BEGIN");

  const informe = [];
  for (const t of tablas) {
    if (VACIAS_EN_PRODUCCION.has(t)) { informe.push({ tabla: t, staging: null, cargadas: 0, nota: "vacía en producción" }); continue; }
    const colsLoc = (await loc.query(`
      SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''`, [`public."${t}"`])).rows.map((r) => r.attname);
    const colsSt = new Set((await st.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t])).rows.map((r) => r.column_name));
    if (colsSt.size === 0) { informe.push({ tabla: t, staging: null, cargadas: 0, nota: "no existe en staging" }); continue; }
    const cols = colsLoc.filter((c) => colsSt.has(c));
    let filas = (await st.query(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM public."${t}"`)).rows;
    const total = filas.length;
    const fuera = CREADAS_DESPUES[t] ? filas.filter(CREADAS_DESPUES[t]).length : 0;
    if (CREADAS_DESPUES[t]) filas = filas.filter((f) => !CREADAS_DESPUES[t](f));
    if (A_LA_024[t]) filas = filas.map(A_LA_024[t]);

    const lista = cols.map((c) => `"${c}"`).join(", ");
    const insertar = (lote) =>
      loc.query(`INSERT INTO public."${t}" (${lista}) SELECT ${lista} FROM json_populate_recordset(NULL::public."${t}", $1::json)`, [JSON.stringify(lote)]);
    let cargadas = 0;
    const rechazos = [];
    if (filas.length) {
      try {
        await loc.query("SAVEPOINT lote");
        await insertar(filas);
        cargadas = filas.length;
      } catch {
        await loc.query("ROLLBACK TO SAVEPOINT lote");
        for (const f of filas) {
          try {
            await loc.query("SAVEPOINT fila");
            await insertar([f]);
            cargadas += 1;
          } catch (e) {
            await loc.query("ROLLBACK TO SAVEPOINT fila");
            rechazos.push(e.message);
          }
        }
      }
    }
    const motivos = [...new Set(rechazos)].slice(0, 3);
    informe.push({ tabla: t, staging: total, cargadas, creadas_despues: fuera || undefined, rechazadas: rechazos.length || undefined, motivos: motivos.length ? motivos : undefined });
  }

  // auth.users para cada usuario (la FK de users), con el tenant y el rol en app_metadata.
  const usuarios = (await st.query("SELECT id, email, tenant_id, role FROM public.users")).rows;
  for (const u of usuarios) {
    await loc.query(
      `INSERT INTO auth.users (id, email, aud, role, raw_app_meta_data) VALUES ($1, $2, 'authenticated', 'authenticated', $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.email, JSON.stringify({ tenant_id: u.tenant_id, user_role: u.role })]);
  }

  // Secuencias de columnas serial/identity al máximo cargado.
  const seqs = (await loc.query(`
    SELECT c.relname AS tabla, a.attname AS col, pg_get_serial_sequence(format('public.%I', c.relname), a.attname) AS seq
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_get_serial_sequence(format('public.%I', c.relname), a.attname) IS NOT NULL`)).rows;
  for (const s of seqs) {
    await loc.query(`SELECT setval($1, greatest(1, coalesce((SELECT max("${s.col}") FROM public."${s.tabla}"), 0)), (SELECT count(*) > 0 FROM public."${s.tabla}"))`, [s.seq]);
  }

  await loc.query("COMMIT");
  await loc.query("SET session_replication_role = origin");
  await loc.end();
  await st.end();
  return { informe, usuarios: usuarios.length };
}

// ─────────────────────────────────────────────────────────────────────────────

const fase = process.argv[2];

if (fase === "base") {
  const registro = [];
  // El rol postgres tiene que existir antes de crear la base con él de dueño.
  const a = await cliente("supabase_admin", "postgres");
  await a.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
                 THEN CREATE ROLE postgres LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS; END IF; END $$`);
  await a.end();
  await recrear("prod_024");

  const shim = await correr("supabase_admin", "prod_024", "scripts/ensayo-ventana/supabase-shim.sql", { bloque: "shim" });
  imprimir(shim); registro.push(shim);
  if (shim.error) process.exit(1);

  // get_tenant_id/get_user_role: DEFAULT de las tablas de Finanzas. En producción
  // existen (vienen del consolidado histórico); acá se toman del prelude de staging,
  // SIN la segunda mitad (tenant_id/user_role en public: en producción viven en auth).
  const prelude = PRELUDE_SQL.slice(0, PRELUDE_SQL.indexOf("-- Los de RLS se crean igual"));
  const c = await cliente("postgres", "prod_024");
  await c.query(prelude);
  await c.end();

  for (const ruta of BASE_PRODUCCION) {
    const r = await correr("postgres", "prod_024", ruta, { commit: COMMIT_PRODUCCION, bloque: "base 024", fixups: true });
    imprimir(r); registro.push(r);
    if (r.error) { guardar("base", registro); process.exit(1); }
  }

  console.log("\n▶ Datos: seed de pruebas de staging (sólo lectura), recortado a lo que producción tiene a la 024…");
  const datos = await cargarDatos("prod_024");
  for (const i of datos.informe) {
    if (i.staging === null) continue;
    console.log(`   ${i.tabla.padEnd(32)} ${String(i.cargadas).padStart(4)}/${String(i.staging).padEnd(4)}${i.creadas_despues ? ` · ${i.creadas_despues} creadas por una migración posterior` : ""}${i.rechazadas ? ` · ${i.rechazadas} rechazadas: ${i.motivos.join(" | ")}` : ""}`);
  }

  for (const ruta of HOTFIX_PRODUCCION) {
    const r = await correr("postgres", "prod_024", ruta, { bloque: "hotfix 084" });
    imprimir(r); registro.push(r);
    if (r.error) { guardar("base", registro); process.exit(1); }
  }
  guardar("base", { pasos: registro, datos });
  console.log("\n✅ prod_024 lista (plantilla de la ventana).");
}

if (fase === "ventana" || fase === "bitacoras") {
  const seguir = process.argv.includes("--seguir");
  const grupos = fase === "ventana"
    ? [["A (app arriba)", BLOQUE_A], ["B (congelado)", BLOQUE_B], ["C (congelado)", BLOQUE_C]]
    : [["bitácoras", BITACORAS]];
  if (fase === "ventana") await recrear("ventana", "prod_024");
  const registro = [];
  const t0 = performance.now();
  let fallo = false;
  for (const [bloque, lista] of grupos) {
    console.log(`\n── Bloque ${bloque}: ${lista.length} migraciones`);
    for (const ruta of lista) {
      const r = await correr("postgres", "ventana", ruta, { bloque });
      imprimir(r); registro.push(r);
      if (r.error) { fallo = true; if (!seguir) break; }
      for (const v of VERIFICACIONES[ruta] ?? []) {
        if (!existsSync(resolve(ROOT, v))) continue;
        const rv = await correr("postgres", "ventana", v, { bloque: "  verificación" });
        imprimir(rv); registro.push(rv);
      }
    }
    if (fallo && !seguir) break;
  }
  const total = Math.round(performance.now() - t0);
  guardar(fase, { total_ms: total, pasos: registro });
  console.log(`\n${fallo ? "❌ Se detuvo en un error" : "✅ Sin errores"} · ${registro.length} pasos · ${(total / 1000).toFixed(1)} s`);
  process.exit(fallo ? 1 : 0);
}

if (fase === "verificar") {
  // Después de la ventana: el «primer uso» (proveedor, compra, asientos, banco)
  // y TODAS las verificaciones otra vez, sobre el esquema completo.
  const registro = [];
  if (process.argv.includes("--primer-uso")) {
    const r = await correr("postgres", "ventana", "scripts/ensayo-ventana/datos-primer-uso.sql", { bloque: "primer uso" });
    imprimir(r); registro.push(r);
    for (const a of r.avisos) console.log(`     ${a.texto}`);
    if (r.error) process.exit(1);
  }
  const todas = [...new Set(Object.values(VERIFICACIONES).flat())];
  for (const v of todas) {
    const r = await correr("postgres", "ventana", v, { bloque: "verificación" });
    imprimir(r); registro.push(r);
    const nada = r.avisos.find((a) => /nada que verificar|Hace falta/i.test(a.texto));
    if (nada) console.log(`     ⚪ ${nada.texto}`);
  }
  guardar(process.argv.includes("--primer-uso") ? "verificar-primer-uso" : "verificar", { pasos: registro });
}

if (!["base", "ventana", "bitacoras", "verificar"].includes(fase)) {
  console.error("uso: node scripts/ensayo-ventana/ensayo.mjs base | ventana [--seguir] | bitacoras [--seguir] | verificar [--primer-uso]");
  process.exit(1);
}

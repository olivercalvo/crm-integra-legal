/**
 * Respaldo completo de Supabase (producción) del CRM Integra Legal.
 *
 * Qué respalda:
 *   1. Todas las tablas expuestas por la API REST, a JSON.
 *   2. Todos los archivos del bucket de Storage (documentos adjuntos).
 *
 * Qué NO respalda (limitaciones conocidas, documentadas a propósito):
 *   - Los usuarios de autenticación (viven en el esquema `auth`, la API no los expone).
 *     Si hubiera que reconstruir, se recrean los accesos y cada quien restablece su clave.
 *   - El ESQUEMA de la base. Eso vive versionado en supabase/migrations/, que es su lugar.
 *     Para restaurar: crear proyecto -> correr migraciones -> cargar estos JSON -> subir Storage.
 *
 * Uso:  node scripts/backup-supabase.mjs
 *
 * CREDENCIALES — NO usa .env.local a propósito.
 * Desde Fase 0 (2026-08-25) `.env.local` apunta a STAGING. Si este script lo leyera,
 * respaldaría datos de prueba rotulándolos como producción, y la retención de 14 días
 * borraría los respaldos buenos. Un respaldo que miente es peor que no tener respaldo.
 *
 * Lee `.env.produccion.local` (o la ruta que indique BACKUP_ENV_FILE), y ABORTA si el
 * proyecto no es el de producción. Es el mismo candado del seed, al revés.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

// Destino del respaldo y cuántos días conservar.
const DESTINO = process.env.BACKUP_DIR
  || "C:\\Users\\Oliver\\OneDrive\\Backups\\supabase-crm-integra";
const RETENCION_DIAS = Number(process.env.BACKUP_RETENTION_DAYS || 14);

// ---------------------------------------------------------------- credenciales
// Los refs de los proyectos de PRODUCCIÓN. Si el ref no está acá, el script aborta.
//
// ⚠️ ESTA LISTA ESTÁ REPETIDA EN TRES ARCHIVOS (este corre con `node` y no puede
// importar el módulo TypeScript):
//   - `src/lib/env/app-env.ts`        (la banda de entorno + el seed)
//   - `scripts/apply-staging-sql.mjs` (aborta si el ref SÍ es de producción)
// Si alguna vez cambia el proyecto de producción, hay que tocar los tres.
const PROD_PROJECT_REFS = ["uqmmkklbhzxqybljiecs"];

const envPath = process.env.BACKUP_ENV_FILE || path.join(REPO, ".env.produccion.local");
if (!fs.existsSync(envPath)) {
  console.error(`
ERROR: no encuentro el archivo de credenciales de producción.
  Buscaba: ${envPath}

Este script NO usa .env.local a propósito: desde Fase 0 ese archivo apunta a staging.
Creá .env.produccion.local en la raíz del repo con las credenciales de PRODUCCIÓN:

  NEXT_PUBLIC_SUPABASE_URL=https://<ref-de-produccion>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<service_role de produccion>

Está en .gitignore (patrón .env*.local), así que no se commitea.
`);
  process.exit(1);
}

const env = fs.readFileSync(envPath, "utf8");
const leer = (k) =>
  (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");

const URL_BASE = leer("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = leer("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_BASE || !SERVICE_KEY) {
  console.error(`ERROR: faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en ${envPath}`);
  process.exit(1);
}

// ---- CANDADO: solo se respalda producción -----------------------------------
const REF = (URL_BASE.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!REF || !PROD_PROJECT_REFS.includes(REF)) {
  console.error(`
ABORTADO: el proyecto Supabase "${REF ?? "(no reconocido)"}" NO es producción.

Este script respalda ÚNICAMENTE la base real. Respaldar staging con la etiqueta de
producción contaminaría el juego de respaldos, y la retención de ${RETENCION_DIAS} días
terminaría borrando los respaldos buenos.

  Archivo leído : ${envPath}
  Refs válidos  : ${PROD_PROJECT_REFS.join(", ")}

No se escribió nada.
`);
  process.exit(1);
}

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// ---------------------------------------------------------------- utilidades
const hoy = new Date().toISOString().slice(0, 10);
const dirHoy = path.join(DESTINO, hoy);
const dirTablas = path.join(dirHoy, "tablas");
const dirStorage = path.join(dirHoy, "storage");
fs.mkdirSync(dirTablas, { recursive: true });
fs.mkdirSync(dirStorage, { recursive: true });

const log = (m) => console.log(m);
const mb = (b) => (b / 1048576).toFixed(1);

// ---------------------------------------------------------------- 1. tablas
async function respaldarTablas() {
  const spec = await (await fetch(`${URL_BASE}/rest/v1/`, { headers: H })).json();
  const tablas = Object.keys(spec.paths || {})
    .map((p) => p.slice(1))
    .filter((t) => t && !t.startsWith("rpc/"));

  let filas = 0;
  const detalle = [];

  for (const t of tablas) {
    let todo = [];
    let desde = 0;
    const pagina = 1000;
    while (true) {
      const r = await fetch(`${URL_BASE}/rest/v1/${t}?select=*`, {
        headers: { ...H, Range: `${desde}-${desde + pagina - 1}` },
      });
      if (!r.ok) {
        detalle.push({ tabla: t, filas: `ERROR ${r.status}` });
        break;
      }
      const d = await r.json();
      if (!Array.isArray(d)) {
        detalle.push({ tabla: t, filas: "ERROR" });
        break;
      }
      todo = todo.concat(d);
      if (d.length < pagina) break;
      desde += pagina;
    }
    fs.writeFileSync(path.join(dirTablas, `${t}.json`), JSON.stringify(todo, null, 1));
    detalle.push({ tabla: t, filas: todo.length });
    filas += todo.length;
  }
  log(`  tablas: ${tablas.length}  ·  filas: ${filas}`);
  return { tablas: tablas.length, filas, detalle };
}

// ---------------------------------------------------------------- 2. storage
async function listar(bucket, prefijo = "", nivel = 0) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({
      prefix: prefijo,
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  const items = await r.json();
  if (!Array.isArray(items)) return [];
  let salida = [];
  for (const it of items) {
    const ruta = prefijo ? `${prefijo}/${it.name}` : it.name;
    if (it.id === null) {
      // es una "carpeta": bajamos un nivel
      if (nivel < 6) salida = salida.concat(await listar(bucket, ruta, nivel + 1));
    } else {
      salida.push({ ruta, size: it.metadata?.size ?? 0 });
    }
  }
  return salida;
}

async function respaldarStorage() {
  const buckets = await (await fetch(`${URL_BASE}/storage/v1/bucket`, { headers: H })).json();
  if (!Array.isArray(buckets)) return { archivos: 0, bytes: 0, errores: [] };

  let archivos = 0;
  let bytes = 0;
  const errores = [];

  for (const b of buckets) {
    const lista = await listar(b.id);
    for (const f of lista) {
      const destino = path.join(dirStorage, b.id, ...f.ruta.split("/"));
      fs.mkdirSync(path.dirname(destino), { recursive: true });

      // Si ya existe con el mismo tamaño, no lo bajamos de nuevo.
      if (fs.existsSync(destino) && fs.statSync(destino).size === f.size) {
        archivos++;
        bytes += f.size;
        continue;
      }
      const r = await fetch(
        `${URL_BASE}/storage/v1/object/${b.id}/${f.ruta.split("/").map(encodeURIComponent).join("/")}`,
        { headers: H }
      );
      if (!r.ok) {
        errores.push({ archivo: f.ruta, estado: r.status });
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(destino, buf);
      archivos++;
      bytes += buf.length;
    }
  }
  log(`  storage: ${archivos} archivos  ·  ${mb(bytes)} MB`);
  if (errores.length) log(`  ATENCION: ${errores.length} archivos no se pudieron bajar`);
  return { archivos, bytes, errores };
}

// ---------------------------------------------------------------- 3. retención
function aplicarRetencion() {
  const limite = Date.now() - RETENCION_DIAS * 86400000;
  let borradas = 0;
  for (const nombre of fs.readdirSync(DESTINO)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nombre)) continue; // solo carpetas con fecha
    if (nombre === hoy) continue;
    if (new Date(nombre).getTime() < limite) {
      fs.rmSync(path.join(DESTINO, nombre), { recursive: true, force: true });
      borradas++;
    }
  }
  if (borradas) log(`  retencion: ${borradas} respaldos de mas de ${RETENCION_DIAS} dias eliminados`);
  return borradas;
}

// ---------------------------------------------------------------- main
console.log(`\nRespaldo Supabase · CRM Integra Legal · ${hoy}`);
console.log(`Destino: ${dirHoy}\n`);

const t = await respaldarTablas();
const s = await respaldarStorage();
const borradas = aplicarRetencion();

const manifiesto = {
  generado: new Date().toISOString(),
  proyecto: "crm-integra-legal (PRODUCCION)",
  project_ref: REF, // queda registrado de qué base salió, sin depender de la etiqueta
  origen_credenciales: envPath,
  tablas: t.tablas,
  filas_totales: t.filas,
  storage_archivos: s.archivos,
  storage_mb: Number(mb(s.bytes)),
  errores_storage: s.errores,
  retencion_dias: RETENCION_DIAS,
  respaldos_antiguos_eliminados: borradas,
  no_incluye: [
    "usuarios de autenticacion (esquema auth, no expuesto por la API)",
    "esquema de la base (vive en supabase/migrations/)",
  ],
  detalle_tablas: t.detalle,
};
fs.writeFileSync(path.join(dirHoy, "_MANIFIESTO.json"), JSON.stringify(manifiesto, null, 2));

console.log(`\nListo. Manifiesto en ${path.join(dirHoy, "_MANIFIESTO.json")}\n`);
if (s.errores.length) process.exitCode = 1;

/**
 * EL INICIO CONTABLE MIENTRAS SE SIEMBRA STAGING (096).
 *
 * La semilla de staging crea documentos de marzo a junio de 2026 —y
 * `seed-asientos` les postea asiento— a propósito: es la historia de staging.
 * Con la 096 la base rechaza crear documentos anteriores al inicio contable
 * (01/07/2026). Así que cada semilla:
 *
 *   1. al empezar, baja el inicio a 01/01/2025;
 *   2. siembra;
 *   3. al terminar (también si falla), lo devuelve a 01/07/2026.
 *
 * 🔴 Los dos movimientos van con el guard del parámetro desactivado DENTRO de
 *    una transacción (ALTER TABLE … DISABLE TRIGGER, sólo el de finanzas_parametros).
 *    Es la misma aceptación que hace la llave `finanzas.inicio_contable_existentes`
 *    al aplicar la 096 en staging: los asientos de marzo a junio de la semilla
 *    quedan «del lado equivocado» a sabiendas. Bajar con el guard puesto
 *    fallaría en una re-siembra (hay documentos viejos sin asiento) y volver
 *    fallaría siempre (hay documentos viejos con asiento).
 *
 * 🛑 Sólo staging (o la base LOCAL del ensayo): candado por project ref. Usa la
 *    conexión directa de `.env.staging-db.local` (la misma que `run-sql.mjs`).
 *    Sin la 096 en la base (columna inexistente) no hace nada: el aplicador del
 *    `--reset` llega hasta la 048 y la 096 entra después con la llave.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const PROD_REFS = ["uqmmkklbhzxqybljiecs"];
export const INICIO_PARA_SEMBRAR = "2025-01-01";
export const INICIO_DE_STAGING = "2026-07-01";

function conexion(): string {
  const ensayo = process.env.ENSAYO_DATABASE_URL?.trim();
  if (ensayo) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(ensayo).hostname)) {
      throw new Error("ENSAYO_DATABASE_URL sólo puede apuntar a una base local.");
    }
    return ensayo;
  }
  const ruta = resolve(process.cwd(), ".env.staging-db.local");
  if (!existsSync(ruta)) throw new Error(`Falta ${ruta}: la semilla la necesita para el inicio contable (096).`);
  const url = (readFileSync(ruta, "utf8").match(/^STAGING_DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  if (!url) throw new Error("No se pudo leer STAGING_DATABASE_URL.");
  for (const ref of PROD_REFS) if (url.includes(ref)) throw new Error("🛑 La conexión apunta a PRODUCCIÓN.");
  return url;
}

/** Pone el inicio del bufete en `fecha` saltando el guard, en UNA transacción. */
async function ponerInicio(c: pg.Client, tenantId: string, fecha: string): Promise<void> {
  await c.query("BEGIN");
  try {
    await c.query("ALTER TABLE public.finanzas_parametros DISABLE TRIGGER trg_inicio_contable_guard");
    await c.query(
      `INSERT INTO public.finanzas_parametros (tenant_id, fecha_inicio_contable) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET fecha_inicio_contable = EXCLUDED.fecha_inicio_contable, updated_at = now()`,
      [tenantId, fecha]
    );
    await c.query("ALTER TABLE public.finanzas_parametros ENABLE TRIGGER trg_inicio_contable_guard");
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
}

/**
 * Baja el inicio para sembrar y devuelve la función que lo restaura. Llamarla en
 * un `finally`: el inicio NO puede quedar en 2025 si la siembra falla.
 */
export async function bajarInicioParaSembrar(tenantId: string): Promise<() => Promise<void>> {
  const c = new pg.Client({ connectionString: conexion() });
  await c.connect();
  const { rows } = await c.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='finanzas_parametros' AND column_name='fecha_inicio_contable'"
  );
  if (rows.length === 0) {
    await c.end();
    console.log("   ⏭  inicio contable: la 096 todavía no está en esta base, no hay nada que mover.");
    return async () => {};
  }
  // El tenant tiene que existir (FK) antes de escribir su parámetro.
  const { rows: tn } = await c.query("SELECT 1 FROM public.tenants WHERE id = $1", [tenantId]);
  if (tn.length === 0) {
    await c.end();
    throw new Error("bajarInicioParaSembrar: el tenant todavía no existe. Llamarla después de sembrarlo.");
  }
  await ponerInicio(c, tenantId, INICIO_PARA_SEMBRAR);
  console.log(`   ↓  inicio contable en ${INICIO_PARA_SEMBRAR} mientras se siembra (096)`);
  return async () => {
    try {
      await ponerInicio(c, tenantId, INICIO_DE_STAGING);
      console.log(`   ↑  inicio contable devuelto a ${INICIO_DE_STAGING}`);
    } finally {
      await c.end();
    }
  };
}

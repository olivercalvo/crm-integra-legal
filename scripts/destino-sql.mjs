/**
 * ¿Contra qué base va a correr un SQL? (07/10/2026)
 *
 * Lista BLANCA, no negra: sólo staging (project ref xtyenhakplrkyifbcaow) o una
 * base local (localhost). Cualquier otra cosa, y en particular producción
 * (uqmmkklbhzxqybljiecs), se rechaza ANTES de abrir la conexión.
 * Lo usa scripts/run-sql.mjs; lo fija src/lib/env/__tests__/destino-sql.test.ts.
 */
export const STAGING_REF = "xtyenhakplrkyifbcaow";
export const PROD_REFS = ["uqmmkklbhzxqybljiecs"];
const LOCALES = ["localhost", "127.0.0.1", "[::1]"];

/** Devuelve "staging" | "local", o lanza con el motivo. */
export function destinoPermitido(conn) {
  if (!conn || typeof conn !== "string") throw new Error("No hay connection string.");
  for (const ref of PROD_REFS) {
    if (conn.includes(ref)) throw new Error(`ABORTADO: la connection string apunta a PRODUCCIÓN (${ref}).`);
  }
  let host;
  try {
    host = new URL(conn).hostname;
  } catch {
    throw new Error("ABORTADO: la connection string no se puede leer.");
  }
  if (LOCALES.includes(host)) return "local";
  if (conn.includes(STAGING_REF)) return "staging";
  throw new Error(`ABORTADO: la base no es staging (${STAGING_REF}) ni local (host ${host}).`);
}

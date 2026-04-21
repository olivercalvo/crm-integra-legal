/**
 * Universal search helpers — aplicar a TODOS los buscadores del CRM.
 *
 * Regla única: al usuario no le importa si una palabra tiene mayúsculas,
 * acentos o está parcialmente escrita. "Extrajudicial" == "EXTRAJUDICIAL" ==
 * "extrajudicial" == "extra". La función de normalización unifica eso
 * client-side; el server-side está cubierto por las RPCs que usan
 * `unaccent()` en `sql/pending/002_enable_unaccent_and_search_rpcs.sql`.
 */

// Bloque unicode de "combining diacritical marks" (U+0300 a U+036F).
const DIACRITIC_RANGE = /[̀-ͯ]/g;

/** Normaliza un valor para comparación case-insensitive y sin acentos. */
export function normalizeSearch(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RANGE, "")
    .trim();
}

/**
 * Devuelve true si la query aparece (coincidencia parcial) en al menos uno
 * de los valores provistos. Usar para filtrado client-side uniforme.
 *
 * @example
 *   if (matchesSearchQuery("extra", row.caseCode, row.clientName, row.classification)) {...}
 */
export function matchesSearchQuery(query: string, ...values: unknown[]): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  for (const v of values) {
    if (normalizeSearch(v).includes(q)) return true;
  }
  return false;
}

/**
 * Escapa caracteres con significado especial para un patrón PostgREST
 * `column.ilike.%q%`: `%`, `_`, `,`, `(`, `)`.
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[%_,()]/g, (ch) => `\\${ch}`);
}

/**
 * Construye el string que va dentro de `.or()` del SDK Supabase:
 *   "case_code.ilike.%q%,description.ilike.%q%,..."
 */
export function buildIlikeOrClause(query: string, fields: readonly string[]): string {
  const pattern = `%${escapeLikePattern(query.trim())}%`;
  return fields.map((f) => `${f}.ilike.${pattern}`).join(",");
}

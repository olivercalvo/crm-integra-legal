/**
 * Parches puntuales para poder aplicar las migraciones del repo de corrido.
 *
 * Esto NO es lo mismo que la reescritura auth.* → public.* de
 * `staging-public-helpers.mjs`, que es una diferencia entre proyectos Supabase.
 * Acá viven **bugs del repo**: migraciones que, tal como están escritas, no se
 * pueden aplicar una detrás de la otra sobre una base limpia.
 *
 * Cada entrada dice qué rompe, por qué, y qué habría que verificar en
 * producción. Si esta lista crece sin que nadie mire producción, se está
 * acumulando deuda silenciosa.
 */

const FIXUPS = [
  /**
   * FIXUP 1 — `idx_payments_tenant` está definido dos veces, sobre tablas
   * distintas, y los nombres de índice son globales por esquema en PostgreSQL:
   *
   *   supabase/migrations/20260402000001_initial_schema.sql:177
   *     CREATE INDEX idx_payments_tenant ON client_payments(tenant_id);
   *
   *   supabase/migrations/20260505000006_finanzas_b3d_payments.sql:86
   *     CREATE INDEX idx_payments_tenant ON payments(tenant_id);
   *
   * El segundo revienta con `relation "idx_payments_tenant" already exists`.
   * Ninguno de los dos usa `IF NOT EXISTS`, así que no hay forma de que los dos
   * archivos hayan corrido limpios sobre la misma base.
   *
   * ⚠️ VERIFICAR EN PRODUCCIÓN: lo más probable es que, al aplicar
   * `b3d_payments` a mano en el SQL Editor, esa sentencia haya fallado y se
   * haya seguido de largo — o sea que la tabla `payments` de producción
   * probablemente NO tiene índice sobre `tenant_id`:
   *
   *   SELECT tablename, indexname FROM pg_indexes
   *   WHERE schemaname = 'public' AND indexname LIKE 'idx_payments%'
   *   ORDER BY tablename, indexname;
   *
   * En staging se renombra a `idx_payments_tenant_fin` para no perder el
   * índice. Divergencia de NOMBRE, anotada en sop.md SOP-012.
   */
  {
    archivo: "supabase/migrations/20260505000006_finanzas_b3d_payments.sql",
    motivo: "idx_payments_tenant choca con el índice de client_payments (initial_schema)",
    reemplazos: [
      [
        /CREATE INDEX idx_payments_tenant(\s+)ON payments\(tenant_id\);/,
        "CREATE INDEX idx_payments_tenant_fin$1ON payments(tenant_id);",
      ],
    ],
  },

  /**
   * FIXUP 2 — el archivo declara una variable PL/pgSQL llamada `is_generated`
   * y en el mismo bloque hace `SELECT is_generated FROM information_schema.columns`.
   * La columna del catálogo se llama igual, así que PostgreSQL corta con:
   *
   *   column reference "is_generated" is ambiguous
   *   It could refer to either a PL/pgSQL variable or a table column.
   *
   * El archivo **nunca se ejecutó**: su encabezado dice "YA APLICADO EN
   * PRODUCCION 2026-05-08 · retro-documentación del cambio aplicado
   * manualmente". El cambio se hizo a mano en producción y el .sql se escribió
   * después, sin correrlo. Por eso el bug siguió ahí sin que nadie lo viera.
   *
   * El fixup renombra la variable a `v_is_generated` y califica la referencia a
   * la columna como `columns.is_generated`. No cambia la lógica.
   *
   * ⚠️ APARTE, Y MÁS IMPORTANTE: ese bloque dropea las columnas generadas
   * `quote_lines.subtotal / tax_amount / line_total` y las recrea como NUMERIC
   * NULL comunes. El comentario dice que las mantiene "el trigger T8b-quote
   * (aplicado fuera de esta migration)" — y **ese trigger no está en el repo**.
   */
  {
    archivo: "supabase/migrations/20260508000002_quotes_extension_and_terms_template.sql",
    motivo: 'variable PL/pgSQL "is_generated" ambigua con information_schema.columns',
    reemplazos: [
      // El orden importa: primero el SELECT, después la declaración y el IF.
      [/SELECT is_generated INTO is_generated/g, "SELECT columns.is_generated INTO v_is_generated"],
      [/^(\s*)is_generated TEXT;$/m, "$1v_is_generated TEXT;"],
      [/IF is_generated = 'ALWAYS' THEN/g, "IF v_is_generated = 'ALWAYS' THEN"],
    ],
  },
];

/**
 * Aplica los fixups que correspondan a `rel`.
 * Devuelve `{ sql, aplicados }` — `aplicados` son los motivos, para loguearlos.
 */
export function aplicarFixups(rel, sql) {
  const aplicados = [];
  let salida = sql;

  for (const f of FIXUPS) {
    if (f.archivo !== rel) continue;

    let cambio = false;
    for (const [de, a] of f.reemplazos) {
      const nuevo = salida.replace(de, a);
      if (nuevo !== salida) cambio = true;
      salida = nuevo;
    }

    // Si un fixup deja de coincidir, o alguien arregló la migración o la
    // cambió. Avisar en vez de seguir en silencio.
    aplicados.push(cambio ? f.motivo : `⚠️ fixup sin efecto (¿ya está arreglado?): ${f.motivo}`);
  }

  return { sql: salida, aplicados };
}

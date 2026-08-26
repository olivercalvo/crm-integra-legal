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
   * ✅ VERIFICADO EN PRODUCCIÓN (Oliver, 2026-08-25) — y salió al revés de lo
   * que se había supuesto acá:
   *
   *     payments        → SÍ tiene idx_payments_tenant
   *     client_payments → NO tiene índice sobre tenant_id (solo idx_payments_case)
   *
   * O sea que el que se quedó sin índice es `client_payments`, el de
   * `initial_schema`, no `payments`. Lo más probable: al aplicar `b3d_payments`
   * a mano se borró o renombró el índice viejo para que el nuevo pasara, y
   * nadie recreó el de `client_payments`.
   *
   * ⚠️ Eso es un hallazgo aparte, en producción: a `client_payments` le falta un
   * índice sobre `tenant_id`. Impacto bajo hoy (25 filas), pero queda anotado en
   * task_plan.md.
   *
   * En STAGING la situación es la contraria, porque acá las migraciones sí
   * corrieron de corrido: `client_payments` conserva `idx_payments_tenant` y
   * `payments` recibe `idx_payments_tenant_fin`. Las dos tablas quedan indexadas
   * — staging está mejor que producción en este punto. Divergencia anotada en
   * sop.md SOP-012.
   *
   * La consulta que lo compara, para volver a correrla cuando haga falta:
   *
   *   SELECT tablename, indexname FROM pg_indexes
   *   WHERE schemaname = 'public' AND indexname LIKE 'idx_payments%'
   *   ORDER BY tablename, indexname;
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
   * FIXUP 2 — se saca la SECCIÓN 5 de `20260508000002`, que dropea las columnas
   * generadas `quote_lines.subtotal / tax_amount / line_total` y las recrea como
   * NUMERIC NULL comunes.
   *
   * ────────────────────────────────────────────────────────────────────────
   * POR QUÉ: esa sección NUNCA se aplicó en producción.
   * ────────────────────────────────────────────────────────────────────────
   * El encabezado del archivo dice "YA APLICADO EN PRODUCCION 2026-05-08", y es
   * cierto para 7 de sus 8 secciones. La 5 no. Verificado contra producción por
   * Oliver el 2026-08-25:
   *
   *   information_schema.columns sobre quote_lines →
   *     subtotal    ALWAYS   (quantity * unit_price)
   *     tax_amount  ALWAYS   ((quantity * unit_price) * tax_rate)
   *     line_total  ALWAYS   ((quantity * unit_price) * (1 + tax_rate))
   *
   *   Y las otras secciones sí están: quotes.public_token / subtotal_hon /
   *   subtotal_rei / converted_at (sección 1), quote_lines.invoice_kind con
   *   datos 'HON'/'REI' (sección 4), quote_terms_template (sección 6).
   *
   * La causa es el bug de sintaxis que vive DENTRO de la sección 5: declara una
   * variable PL/pgSQL `is_generated` que choca con la columna homónima de
   * `information_schema.columns`, y PostgreSQL corta con
   * `column reference "is_generated" is ambiguous`. Quien aplicó el archivo a
   * mano se comió ese error y siguió de largo con el resto.
   *
   * Consecuencia: la sección 5 promete que las columnas las mantendrá "el
   * trigger T8b-quote (aplicado fuera de esta migration)". **Ese trigger no
   * existe** — ni en el repo ni en producción. Los tres triggers reales de
   * `quote_lines` en producción son `finanzas_quote_lines_immutability`,
   * `update_updated_at` y `finanzas_trg_recalc_quote_totals`, y el último solo
   * recalcula la CABECERA sumando las líneas. Nunca hizo falta un trigger
   * porque las columnas nunca dejaron de ser GENERATED.
   *
   * Sacando la sección, staging queda **idéntico a producción**: las tres
   * columnas las calcula la base. El bug de sintaxis deja de importar, porque el
   * bloque no se ejecuta.
   *
   * OJO, no confundir: `quotes.subtotal_hon` y `quotes.subtotal_rei` (sección 1,
   * que SÍ está aplicada) los calcula y escribe **la aplicación**
   * (src/lib/finanzas/api/quotes.ts:601, 796, 928), no la base ni un trigger.
   * El seed también los escribe, y eso es correcto: replica lo que hace la app.
   */
  {
    archivo: "supabase/migrations/20260508000002_quotes_extension_and_terms_template.sql",
    motivo: "sección 5 (dropear columnas GENERATED) — nunca se aplicó en producción, se omite",
    reemplazos: [
      [
        /DO \$\$\s*\nDECLARE\s*\n\s*is_generated TEXT;[\s\S]*?\nEND \$\$;/,
        "-- [SECCIÓN 5 OMITIDA EN STAGING: nunca se aplicó en producción.\n" +
          "--  quote_lines.subtotal/tax_amount/line_total siguen GENERATED ALWAYS.\n" +
          "--  Ver scripts/staging-fixups.mjs, FIXUP 2.]",
      ],
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

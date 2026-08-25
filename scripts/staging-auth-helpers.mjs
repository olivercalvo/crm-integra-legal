/**
 * Los helpers de RLS que viven en el esquema `auth` — la ÚNICA parte del
 * esquema que no se puede aplicar por conexión directa.
 *
 * POR QUÉ ESTÁN APARTE
 *   En un proyecto Supabase nuevo, el esquema `auth` es de `supabase_admin` y
 *   solo tres roles tienen CREATE sobre él: `supabase_admin`,
 *   `supabase_auth_admin` y `dashboard_user`. El rol `postgres` —el que se usa
 *   por el pooler— NO está entre ellos, y tampoco puede hacer `SET ROLE` a
 *   ninguno. Verificado el 2026-08-25 contra staging:
 *
 *     has_schema_privilege('postgres','auth','CREATE') → false
 *     set role supabase_admin → permission denied
 *
 *   `dashboard_user` es el rol del **SQL Editor** del dashboard. Por eso esta
 *   parte la corre una persona ahí, una sola vez, y el resto va por script.
 *
 *   Producción no tiene este problema porque se creó en abril de 2026, cuando
 *   `postgres` todavía tenía CREATE sobre `auth`. Es una diferencia entre
 *   proyectos viejos y nuevos de Supabase, no algo del repo.
 *
 * QUÉ CONTIENE
 *   La versión FINAL de las dos funciones, o sea la de
 *   `20260403000001_fix_rls_jwt_claims.sql` (leen de `app_metadata`), no la
 *   primera de `20260402000001_initial_schema.sql`, que leía del nivel
 *   superior del JWT y estaba mal. El resultado en la base es idéntico a
 *   correr las dos migraciones en orden.
 */

/** Regex que reconoce estos bloques dentro de cualquier archivo de migración. */
export const AUTH_FUNC_RE = /CREATE OR REPLACE FUNCTION auth\.[\s\S]*?\$\$ LANGUAGE sql STABLE;/g;

export const AUTH_HELPERS_SQL = `-- ============================================================================
-- STAGING — BUNDLE 0: helpers de RLS en el esquema auth
-- ----------------------------------------------------------------------------
-- GENERADO por scripts/build-staging-bundle.mjs — NO editar a mano.
--
-- ⚠️  ESTE ARCHIVO SE PEGA EN EL **SQL EDITOR** DEL DASHBOARD DE STAGING.
--     No se puede aplicar por conexión directa: el rol \`postgres\` no tiene
--     CREATE sobre el esquema \`auth\` en los proyectos Supabase nuevos. El SQL
--     Editor corre como \`dashboard_user\`, que sí lo tiene.
--
-- Va PRIMERO, antes de \`node scripts/apply-staging-sql.mjs\`: todas las
-- políticas de RLS del esquema llaman a auth.tenant_id().
--
-- Fuente: supabase/migrations/20260403000001_fix_rls_jwt_claims.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid,
    NULL
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'user_role',
    ''
  );
$$ LANGUAGE sql STABLE;

-- Verificación: las dos deben aparecer.
SELECT p.proname, pg_get_function_result(p.oid) AS retorna
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'auth' AND p.proname IN ('tenant_id', 'user_role')
ORDER  BY p.proname;
`;

/**
 * Los helpers de RLS, movidos al esquema `public` para staging.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTA DIVERGENCIA
 * ────────────────────────────────────────────────────────────────────────────
 * En producción (proyecto creado en abril de 2026) las funciones de RLS viven
 * en el esquema `auth`: `auth.tenant_id()` y `auth.user_role()`.
 *
 * En los proyectos Supabase NUEVOS el esquema `auth` está reservado y NADIE
 * puede escribir ahí. Verificado el 2026-08-25 contra staging, por las dos vías:
 *
 *   · por conexión directa (rol `postgres`):  permission denied for schema auth
 *     has_schema_privilege('postgres','auth','CREATE') → false
 *     set role supabase_admin / supabase_auth_admin  → permission denied
 *   · por el SQL Editor del dashboard:        permission denied for schema auth
 *
 * Así que en staging las mismas dos funciones viven en `public`. **Es una
 * diferencia de NOMBRE, no de lógica**: el cuerpo es idéntico, lee de
 * `request.jwt.claims`, que es un setting de sesión y no depende del esquema
 * donde esté la función.
 *
 * ⚠️ QUIEN ESCRIBA UNA MIGRACIÓN NUEVA tiene que saberlo: si la migración
 * referencia `auth.tenant_id()`, funciona en producción y NO en staging. El
 * runner reescribe las referencias al vuelo (ver `reescribirHelpers`), pero eso
 * solo cubre los archivos que pasan por él. Ver `sop.md` SOP-012.
 *
 * Convergir producción a `public.*` está anotado como pendiente en
 * `task_plan.md`: implica recrear todas las políticas de RLS y merece su propia
 * migración y su propio deploy.
 */

/**
 * Reescribe las referencias a los helpers de `auth` para que apunten a `public`.
 *
 * Toca EXACTAMENTE dos nombres. `auth.users` (la FK de la tabla `users`) queda
 * intacta a propósito: esa tabla sí existe y sí se puede referenciar; lo único
 * prohibido es CREAR objetos en el esquema.
 */
export function reescribirHelpers(sql) {
  return sql
    .replace(/\bauth\.tenant_id\b/g, "public.tenant_id")
    .replace(/\bauth\.user_role\b/g, "public.user_role");
}

/**
 * Prelude que va ANTES de la primera migración.
 *
 * `public.get_tenant_id()` y `public.get_user_role()` son OTRAS dos funciones,
 * distintas de las de RLS: las tablas del módulo Finanzas las usan como DEFAULT
 * de la columna `tenant_id` (`DEFAULT public.get_tenant_id()`), así que tienen
 * que existir antes del `CREATE TABLE quotes`.
 *
 * En el repo solo aparecen dentro de `supabase/migrations/migration_completa.sql`,
 * un consolidado histórico que NO se aplica en staging (se pisa con las
 * migraciones numeradas). Se extraen acá tal cual, sin tocarles el cuerpo:
 * leen el claim del nivel superior del JWT, no de `app_metadata`. Eso es lo que
 * hay en producción y replicarlo es el objetivo — corregirlo sería divergir.
 */
export const PRELUDE_SQL = `-- ============================================================================
-- STAGING — PRELUDE: helpers en el esquema public
-- ----------------------------------------------------------------------------
-- Ver scripts/staging-public-helpers.mjs para el detalle de por qué.
--
-- 1. get_tenant_id / get_user_role → DEFAULT de las tablas de Finanzas.
--    Copiadas literal de supabase/migrations/migration_completa.sql.
-- 2. tenant_id / user_role → los helpers de RLS, que en producción viven en el
--    esquema auth y acá no pueden. El runner reescribe las referencias.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid,
    NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb ->> 'user_role',
    ''
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Los de RLS se crean igual acá para que existan desde el arranque; las
-- migraciones los vuelven a definir (CREATE OR REPLACE) con el mismo cuerpo.
CREATE OR REPLACE FUNCTION public.tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid,
    NULL
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'user_role',
    ''
  );
$$ LANGUAGE sql STABLE;
`;

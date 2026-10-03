-- ============================================================================
-- 084 · audit_log: SOLO LECTURA para el usuario, SOLO AGREGAR para todos
-- ============================================================================
-- Hallazgo del 03/10/2026, confirmado en staging y en producción:
--   · política `audit_tenant_isolation` FOR ALL (cualquier comando) con
--     `tenant_id = tenant_id()`;
--   · `anon` y `authenticated` con INSERT, SELECT, UPDATE, DELETE, TRUNCATE,
--     REFERENCES y TRIGGER.
-- O sea: cualquier usuario logueado podía editar o borrar la bitácora de su
-- bufete desde el navegador, con el cliente de Supabase y su propia sesión.
--
-- QUIÉN ESCRIBE audit_log (revisado en el código el 03/10): las 32 escrituras y
-- las 2 lecturas usan el CLIENTE DE SERVICIO (`createAdminClient()`, o `ctx.db`,
-- que es el mismo: `getAuthenticatedContext` devuelve `db: admin`). Ninguna usa
-- la sesión del usuario. Por eso:
--   · NO hace falta una política de INSERT para `authenticated`: no se crea.
--     Sin política, RLS le niega el INSERT aunque conserve el grant.
--   · `service_role` salta RLS y sigue insertando como hoy.
--
-- Qué hace:
--   1. Reemplaza la política FOR ALL por una FOR SELECT con la MISMA expresión
--      de bufete. La expresión se COPIA de la política vigente (en staging es
--      `tenant_id()`, en las migraciones de main `auth.tenant_id()`): así la
--      migración aplica igual en las dos bases sin adivinar cuál tienen.
--   2. REVOKE ALL a `anon`. REVOKE UPDATE, DELETE, TRUNCATE a `authenticated`.
--   3. Trigger que rechaza UPDATE, DELETE y TRUNCATE a todo rol que no sea
--      superusuario. ⚠️ En Supabase el único superusuario es `supabase_admin`:
--      `postgres` (el SQL Editor) y `service_role` NO lo son, así que tampoco
--      pueden editar ni borrar. Para hacerlo alguien tendría que quitar el
--      trigger (DROP TRIGGER), que queda a la vista. Consecuencia buscada.
--      Consecuencia a saber: borrar un BUFETE entero (`tenants`, con ON DELETE
--      CASCADE hacia audit_log) también queda bloqueado. Eso no se hace desde la
--      app.
--   4. No toca ninguna fila.
--
-- 🩹 HOTFIX INDEPENDIENTE: sólo usa objetos que existen desde la migración
--    inicial (`audit_log`, su política) y catálogos de Postgres. No depende de
--    ninguna migración posterior a la 024. Se puede aplicar sola en producción,
--    antes que el resto de la ventana. Es idempotente: si ya se aplicó, no
--    cambia nada.
-- 🛡️ Sólo staging hasta el «aplica» de Oliver. En producción, por la vía de
--    siempre (no desde una máquina).
-- ============================================================================
BEGIN;

-- ── 1. Política: de FOR ALL a FOR SELECT, con la misma expresión ───────────
DO $$
DECLARE
  v_expr text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_expr
    FROM pg_policy
   WHERE polrelid = 'public.audit_log'::regclass AND polname = 'audit_tenant_isolation';

  IF v_expr IS NULL THEN
    -- Ya aplicada (o la política no existe): no se inventa una expresión.
    IF NOT EXISTS (SELECT 1 FROM pg_policy
                    WHERE polrelid = 'public.audit_log'::regclass AND polname = 'audit_log_select') THEN
      RAISE EXCEPTION '084: audit_log no tiene ni audit_tenant_isolation ni audit_log_select; revisar a mano';
    END IF;
    RAISE NOTICE '084: la política ya estaba reemplazada, se deja como está';
    RETURN;
  END IF;

  EXECUTE format('CREATE POLICY audit_log_select ON public.audit_log FOR SELECT USING (%s)', v_expr);
  DROP POLICY audit_tenant_isolation ON public.audit_log;
  RAISE NOTICE '084: política FOR ALL reemplazada por FOR SELECT USING (%)', v_expr;
END $$;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ── 2. Permisos ────────────────────────────────────────────────────────────
REVOKE ALL ON public.audit_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;

-- ── 3. Solo agregar ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_log_solo_agregar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'audit_log es solo de agregar: no se permite % (rol %).', TG_OP, current_user
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS trg_audit_log_solo_agregar ON public.audit_log;
CREATE TRIGGER trg_audit_log_solo_agregar
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_solo_agregar();

DROP TRIGGER IF EXISTS trg_audit_log_sin_truncate ON public.audit_log;
CREATE TRIGGER trg_audit_log_sin_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_solo_agregar();

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.audit_log'::regclass AND polcmd <> 'r') THEN
    RAISE EXCEPTION '084: audit_log todavía tiene una política que no es de lectura';
  END IF;
  IF has_table_privilege('anon', 'public.audit_log', 'SELECT')
     OR has_table_privilege('anon', 'public.audit_log', 'INSERT')
     OR has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
     OR has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE') THEN
    RAISE EXCEPTION '084: quedó un permiso de más en audit_log';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.audit_log'::regclass
         AND tgname IN ('trg_audit_log_solo_agregar', 'trg_audit_log_sin_truncate')) <> 2 THEN
    RAISE EXCEPTION '084: faltan los triggers de solo agregar';
  END IF;
  RAISE NOTICE '084 ✅ audit_log: lectura por bufete, sin UPDATE/DELETE/TRUNCATE para nadie salvo el superusuario';
END $$;

COMMIT;

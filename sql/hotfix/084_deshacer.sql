-- ============================================================================
-- DESHACER la 084 (audit_log solo de agregar). Sólo si el hotfix rompió algo.
-- ============================================================================
-- Vuelve EXACTAMENTE al estado de antes: política FOR ALL con la misma expresión
-- de bufete, permisos completos para anon y authenticated, sin triggers.
-- ⚠️ Reabre el agujero de seguridad: un usuario logueado vuelve a poder editar y
-- borrar la bitácora de su bufete. Usarlo sólo para salir de un problema, y
-- volver a aplicar la 084 cuando se entienda qué pasó.
-- No toca filas. Todo o nada.
-- ============================================================================
BEGIN;

DROP TRIGGER IF EXISTS trg_audit_log_sin_truncate ON public.audit_log;
DROP TRIGGER IF EXISTS trg_audit_log_solo_agregar ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_solo_agregar();

DO $$
DECLARE
  v_expr text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_expr
    FROM pg_policy
   WHERE polrelid = 'public.audit_log'::regclass AND polname = 'audit_log_select';
  IF v_expr IS NULL THEN
    RAISE NOTICE 'deshacer 084: no está la política audit_log_select; la política no se toca';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.audit_log'::regclass AND polname = 'audit_tenant_isolation') THEN
    EXECUTE format('CREATE POLICY audit_tenant_isolation ON public.audit_log FOR ALL USING (%s)', v_expr);
  END IF;
  DROP POLICY audit_log_select ON public.audit_log;
  RAISE NOTICE 'deshacer 084: política FOR ALL restaurada con USING (%)', v_expr;
END $$;

GRANT ALL ON public.audit_log TO anon, authenticated;

COMMIT;

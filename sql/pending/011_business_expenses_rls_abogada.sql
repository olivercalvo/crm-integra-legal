-- =============================================================================
-- HOT-FIX: business_expenses RLS — abogada puede crear/editar/eliminar
-- Sprint:  Hot-fix posterior a Sprint 2C (encima de develop SHA 65d28e2)
-- Fecha:   2026-05-16
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   La migración 010_create_business_expenses.sql definió RLS asimétrica:
--     - SELECT: admin + abogada + contador
--     - INSERT/UPDATE/DELETE: admin + contador (abogada read-only)
--
--   El supuesto era que el contador es quien registra los gastos del bufete.
--   En la práctica, las abogadas (Daveiva, Milena) pagan en el día a día
--   (renta, servicios, sub-contratos, papelería) y son las que necesitan
--   registrarlos. El contador llega después a categorizar/conciliar.
--
--   El hot-fix de código (commit acompañante) ya amplía MUTATING_ROLES en
--   los 4 route handlers + 4 pages. Como las mutaciones pasan por
--   getAuthenticatedContext() (admin client, bypass RLS), el código por sí
--   solo es suficiente para destrabar a las abogadas. Este SQL es DEFENSA
--   EN PROFUNDIDAD: alinea la RLS por si en algún sprint futuro se
--   refactoriza para usar un client no-admin (RLS helpers ya arreglados,
--   ver comentario en src/lib/supabase/server-query.ts:9-13).
--
-- Cambios:
--   1. DROP + CREATE de business_expenses_insert con 'abogada' agregado.
--   2. DROP + CREATE de business_expenses_update con 'abogada' agregado.
--   3. DROP + CREATE de business_expenses_delete con 'abogada' agregado.
--   4. La policy business_expenses_select queda intacta (ya incluye abogada).
--
-- Reversibilidad:
--   ROLLBACK al final, comentado. Restaura el set [admin, contador].
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (dashboard del cliente)
--   DESPUÉS del smoke del commit acompañante. No ejecutar antes del merge:
--   si la RLS quedara permisiva sin que el código backend la respaldara,
--   no habría problema (el código sigue chequeando rol primero), pero el
--   orden recomendado es código → smoke → SQL para mantener invariante.
-- =============================================================================

-- =============================================================================
-- PRE-CHECK
-- =============================================================================
DO $$
DECLARE
  v_table_exists INT;
  v_insert_def TEXT;
  v_update_def TEXT;
  v_delete_def TEXT;
BEGIN
  SELECT COUNT(*) INTO v_table_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='business_expenses';

  IF v_table_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: tabla business_expenses no existe. Esperada del SQL 010. Verificar entorno.';
  END IF;

  SELECT pg_get_expr(polqual, polrelid) INTO v_insert_def
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass
      AND polname = 'business_expenses_insert';

  SELECT pg_get_expr(polqual, polrelid) INTO v_update_def
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass
      AND polname = 'business_expenses_update';

  SELECT pg_get_expr(polqual, polrelid) INTO v_delete_def
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass
      AND polname = 'business_expenses_delete';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Tabla business_expenses existe: %', v_table_exists;
  RAISE NOTICE 'Policy insert (qual actual): %', COALESCE(v_insert_def, 'N/A');
  RAISE NOTICE 'Policy update (qual actual): %', COALESCE(v_update_def, 'N/A');
  RAISE NOTICE 'Policy delete (qual actual): %', COALESCE(v_delete_def, 'N/A');
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. INSERT — agregar 'abogada' al set permitido
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS business_expenses_insert ON business_expenses;
CREATE POLICY business_expenses_insert ON business_expenses
  FOR INSERT
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'abogada', 'contador')
  );

-- -----------------------------------------------------------------------------
-- 2. UPDATE — agregar 'abogada' al set permitido
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS business_expenses_update ON business_expenses;
CREATE POLICY business_expenses_update ON business_expenses
  FOR UPDATE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'abogada', 'contador')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'abogada', 'contador')
  );

-- -----------------------------------------------------------------------------
-- 3. DELETE — agregar 'abogada' al set permitido
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS business_expenses_delete ON business_expenses;
CREATE POLICY business_expenses_delete ON business_expenses
  FOR DELETE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'abogada', 'contador')
  );

COMMIT;

-- =============================================================================
-- POST-CHECK
-- =============================================================================
DO $$
DECLARE
  v_policy_count INT;
  v_insert_ok BOOLEAN;
  v_update_ok BOOLEAN;
  v_delete_ok BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass;

  SELECT pg_get_expr(polqual, polrelid) ILIKE '%abogada%' INTO v_insert_ok
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass
      AND polname = 'business_expenses_insert';

  SELECT pg_get_expr(polqual, polrelid) ILIKE '%abogada%' INTO v_update_ok
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass
      AND polname = 'business_expenses_update';

  SELECT pg_get_expr(polqual, polrelid) ILIKE '%abogada%' INTO v_delete_ok
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass
      AND polname = 'business_expenses_delete';

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'Policies totales: % (esperado 4)', v_policy_count;
  RAISE NOTICE 'Policy insert incluye abogada: % (esperado true)', v_insert_ok;
  RAISE NOTICE 'Policy update incluye abogada: % (esperado true)', v_update_ok;
  RAISE NOTICE 'Policy delete incluye abogada: % (esperado true)', v_delete_ok;
END $$;

-- Policies finales (verificación visual)
SELECT polname,
       polcmd,
       pg_get_expr(polqual, polrelid)      AS using_qual,
       pg_get_expr(polwithcheck, polrelid) AS with_check_qual
FROM   pg_policy
WHERE  polrelid = 'public.business_expenses'::regclass
ORDER  BY polname;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir al estado del SQL 010)
-- =============================================================================
-- BEGIN;
--
-- DROP POLICY IF EXISTS business_expenses_insert ON business_expenses;
-- CREATE POLICY business_expenses_insert ON business_expenses
--   FOR INSERT
--   WITH CHECK (
--     tenant_id = public.get_tenant_id()
--     AND public.get_user_role() IN ('admin', 'contador')
--   );
--
-- DROP POLICY IF EXISTS business_expenses_update ON business_expenses;
-- CREATE POLICY business_expenses_update ON business_expenses
--   FOR UPDATE
--   USING (
--     tenant_id = public.get_tenant_id()
--     AND public.get_user_role() IN ('admin', 'contador')
--   )
--   WITH CHECK (
--     tenant_id = public.get_tenant_id()
--     AND public.get_user_role() IN ('admin', 'contador')
--   );
--
-- DROP POLICY IF EXISTS business_expenses_delete ON business_expenses;
-- CREATE POLICY business_expenses_delete ON business_expenses
--   FOR DELETE
--   USING (
--     tenant_id = public.get_tenant_id()
--     AND public.get_user_role() IN ('admin', 'contador')
--   );
--
-- COMMIT;
-- =============================================================================

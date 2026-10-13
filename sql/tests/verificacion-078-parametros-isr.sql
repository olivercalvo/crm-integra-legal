-- ============================================================================
-- VERIFICACIÓN de la 078 — la tasa de ISR por bufete.
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-078-parametros-isr.sql
--
--   [1] cada bufete tiene su fila, en 0
--   [2] la tasa se guarda como fracción: 0.25 entra, 25 se rechaza
--   [3] una tasa negativa se rechaza
--   [4] RLS: la tabla tiene políticas de lectura y escritura, sin DELETE
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_n      int;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  -- [1]
  SELECT count(*) INTO v_n FROM public.finanzas_parametros WHERE tenant_id = v_tenant AND isr_rate = 0;
  IF v_n = 1 THEN RAISE NOTICE '[1] fila del bufete en 0 ....................... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[1] fila del bufete en 0 ....................... ❌ %', v_n; v_fail := v_fail + 1; END IF;

  -- [2]
  UPDATE public.finanzas_parametros SET isr_rate = 0.25 WHERE tenant_id = v_tenant;
  v_n := 0;
  BEGIN
    UPDATE public.finanzas_parametros SET isr_rate = 25 WHERE tenant_id = v_tenant;
  EXCEPTION WHEN OTHERS THEN v_n := 1;
  END;
  IF v_n = 1 AND (SELECT isr_rate FROM public.finanzas_parametros WHERE tenant_id = v_tenant) = 0.25 THEN
    RAISE NOTICE '[2] 0.25 entra, 25 (porcentaje) se rechaza ....... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[2] fracción contra porcentaje .................. ❌'; v_fail := v_fail + 1; END IF;

  -- [3]
  v_n := 0;
  BEGIN
    UPDATE public.finanzas_parametros SET isr_rate = -0.01 WHERE tenant_id = v_tenant;
  EXCEPTION WHEN OTHERS THEN v_n := 1;
  END;
  IF v_n = 1 THEN RAISE NOTICE '[3] tasa negativa rechazada ..................... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[3] tasa negativa rechazada ..................... ❌'; v_fail := v_fail + 1; END IF;

  -- [4]
  SELECT count(*) INTO v_n FROM pg_policies WHERE tablename = 'finanzas_parametros';
  IF v_n = 3 AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'finanzas_parametros' AND cmd = 'DELETE') THEN
    RAISE NOTICE '[4] lectura, alta y edición; sin borrado ........ ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[4] políticas ................................... ❌ %', v_n; v_fail := v_fail + 1; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 078: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

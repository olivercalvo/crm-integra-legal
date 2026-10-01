-- ============================================================================
-- VERIFICACIÓN de la 079 — plan de cuentas, parte técnica (E6).
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-079-plan-de-cuentas.sql
--
--   [1] una cuenta de balance ACTIVA sin subcategoría se rechaza; inactiva entra
--   [2] `patrimonio` y `depreciacion_acumulada` ya no se aceptan en una activa
--   [3] patrimonio en tres: capital_social, resultados_acumulados, otras_reservas
--   [4] el valor por defecto se CORRIGE: una cuenta cambia de subcategoría válida
--   [5] 400009 y 440001 existen; HON-FAM → 400009; OTR-ING → 440001, ITBMS_7
--   [6] HON-OTROS apunta a una cuenta activa
--   [7] ninguna cuenta activa queda fuera del CHECK nuevo
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
  v_n := 0;
  BEGIN
    INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, subcategoria, active)
    VALUES (v_tenant, '199991', 'Prueba sin subcategoría', 'asset', NULL, true);
  EXCEPTION WHEN check_violation THEN v_n := 1;
  END;
  INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, subcategoria, active)
  VALUES (v_tenant, '199992', 'Prueba inactiva', 'asset', NULL, false);
  IF v_n = 1 THEN RAISE NOTICE '[1] balance activa sin subcategoría: rechazada ... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[1] balance activa sin subcategoría ............. ❌'; v_fail := v_fail + 1; END IF;

  -- [2]
  v_n := 0;
  BEGIN
    INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, subcategoria, active)
    VALUES (v_tenant, '399991', 'Prueba', 'equity', 'patrimonio', true);
  EXCEPTION WHEN check_violation THEN v_n := v_n + 1;
  END;
  BEGIN
    INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, subcategoria, active)
    VALUES (v_tenant, '199993', 'Prueba', 'asset', 'depreciacion_acumulada', true);
  EXCEPTION WHEN check_violation THEN v_n := v_n + 1;
  END;
  IF v_n = 2 THEN RAISE NOTICE '[2] subcategorías viejas rechazadas ............ ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[2] subcategorías viejas ........................ ❌ %', v_n; v_fail := v_fail + 1; END IF;

  -- [3]
  INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, subcategoria, active) VALUES
    (v_tenant, '399992', 'Prueba capital', 'equity', 'capital_social', true),
    (v_tenant, '399993', 'Prueba resultados', 'equity', 'resultados_acumulados', true),
    (v_tenant, '399994', 'Prueba reservas', 'equity', 'otras_reservas', true);
  RAISE NOTICE '[3] patrimonio en tres ........................... ✅'; v_ok := v_ok + 1;

  -- [4]
  UPDATE public.chart_of_accounts SET subcategoria = 'capital_social'
   WHERE tenant_id = v_tenant AND code = '300004';
  IF (SELECT subcategoria FROM public.chart_of_accounts WHERE tenant_id = v_tenant AND code = '300004') = 'capital_social' THEN
    RAISE NOTICE '[4] el valor por defecto se corrige .............. ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[4] corregir la subcategoría .................... ❌'; v_fail := v_fail + 1; END IF;

  -- [5]
  IF EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE tenant_id = v_tenant AND code = '400009' AND active)
     AND EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE tenant_id = v_tenant AND code = '440001' AND active)
     AND EXISTS (SELECT 1 FROM public.services_catalog WHERE tenant_id = v_tenant AND code = 'HON-FAM' AND revenue_account = '400009')
     AND EXISTS (SELECT 1 FROM public.services_catalog WHERE tenant_id = v_tenant AND code = 'OTR-ING'
                  AND revenue_account = '440001' AND default_tax_code = 'ITBMS_7' AND service_type = 'honorarios') THEN
    RAISE NOTICE '[5] Familia, otros ingresos, HON-FAM y OTR-ING ... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[5] cuentas y servicios nuevos .................. ❌'; v_fail := v_fail + 1; END IF;

  -- [6]
  IF EXISTS (SELECT 1 FROM public.services_catalog sc JOIN public.chart_of_accounts c
               ON c.tenant_id = sc.tenant_id AND c.code = sc.revenue_account
              WHERE sc.tenant_id = v_tenant AND sc.code = 'HON-OTROS' AND c.active) THEN
    RAISE NOTICE '[6] HON-OTROS en una cuenta activa ............... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[6] HON-OTROS ................................... ❌'; v_fail := v_fail + 1; END IF;

  -- [7]
  SELECT count(*) INTO v_n FROM public.chart_of_accounts
   WHERE active AND (subcategoria IS NULL OR subcategoria IN ('patrimonio', 'depreciacion_acumulada'));
  IF v_n = 0 THEN RAISE NOTICE '[7] ninguna activa fuera del CHECK .............. ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[7] activas fuera del CHECK ..................... ❌ %', v_n; v_fail := v_fail + 1; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 079: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

-- ============================================================================
-- Verificación de la 082: 400010 «Otros servicios», HON-OTROS y ningún banco
-- en una línea de NC de compra. Todo dentro de una transacción que se deshace.
--   node scripts/run-sql.mjs sql/tests/verificacion-082-otros-servicios-y-bancos.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user   uuid;
  v_prov   uuid;
  v_banco  text;
  v_gasto  text;
  v_hoy    date := (now() AT TIME ZONE 'America/Panama')::date;
  v_r      jsonb;
  v_msg    text;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prov FROM suppliers WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT code INTO v_banco FROM chart_of_accounts
   WHERE tenant_id = v_tenant AND active AND finanzas_es_cuenta_de_banco(account_type, name)
   ORDER BY code LIMIT 1;
  SELECT code INTO v_gasto FROM chart_of_accounts
   WHERE tenant_id = v_tenant AND active AND account_type = 'expense' AND cuenta_control IS NULL
   ORDER BY code LIMIT 1;

  -- [1] la cuenta y el servicio
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE tenant_id = v_tenant AND code = '400010'
              AND account_type = 'income' AND subcategoria = 'ingresos_operativos' AND active)
     AND (SELECT revenue_account FROM services_catalog WHERE tenant_id = v_tenant AND code = 'HON-OTROS') = '400010' THEN
    RAISE NOTICE '[1] 400010 Otros servicios y HON-OTROS ............ ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] 400010 / HON-OTROS ............................ ❌'; v_fail := v_fail + 1;
  END IF;

  -- [2] un banco en una línea: rechazo (antes de armar el asiento)
  BEGIN
    v_r := create_supplier_credit_note(
      v_tenant, NULL, v_prov, 'VERIF-082', v_hoy, NULL, 'Verificación 082: banco', v_hoy,
      jsonb_build_array(jsonb_build_object('chart_account_code', v_banco, 'description', 'Línea contra banco',
        'amount', 10, 'tax_amount', 0)),
      '[]'::jsonb, v_user);
    RAISE NOTICE '[2] banco en una línea ............................ ❌ se registró %', v_r; v_fail := v_fail + 1;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE '%es un banco o una caja%' THEN
      RAISE NOTICE '[2] banco % en una línea: rechazado ............ ✅', v_banco; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[2] banco: otro error ............................. ❌ %', v_msg; v_fail := v_fail + 1;
    END IF;
  END;

  -- [3] una cuenta de gasto sigue entrando
  BEGIN
    v_r := create_supplier_credit_note(
      v_tenant, NULL, v_prov, 'VERIF-082', v_hoy, NULL, 'Verificación 082: gasto', v_hoy,
      jsonb_build_array(jsonb_build_object('chart_account_code', v_gasto, 'description', 'Línea de gasto',
        'amount', 10, 'tax_amount', 0)),
      jsonb_build_array(
        jsonb_build_object('account_code', '200001', 'debit', 10, 'credit', 0, 'supplier_id', v_prov),
        jsonb_build_object('account_code', v_gasto, 'debit', 0, 'credit', 10)),
      v_user);
    RAISE NOTICE '[3] cuenta de gasto % sigue entrando ........... ✅ %', v_gasto, v_r->>'credit_note_number'; v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE '[3] cuenta de gasto ............................... ❌ %', v_msg; v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '======== 082: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

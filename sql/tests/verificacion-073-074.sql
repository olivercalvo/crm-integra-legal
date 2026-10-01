-- ============================================================================
-- VERIFICACIÓN de la 073 (tasa con su cuenta) y la 074 (cobro con excedente).
-- 🛡️ TODO DENTRO DE UN ROLLBACK: no deja tasas, cobros, aplicaciones ni
--    asientos, y no consume correlativos.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-073-074.sql
--
-- 073
--   [1] toda tasa tiene cuenta
--   [2] una cuenta inexistente se rechaza
--   [3] una cuenta de control (100004) se rechaza
--   [4] una tasa nueva acepta una cuenta de pasivo propia y se le puede cambiar
--       mientras no se use
--   [5] una tasa YA USADA (ITBMS_7) no deja cambiar su cuenta
-- 074
--   [6] un cobro sin referencia no se crea
--   [7] un cobro viejo sin referencia se sigue pudiendo modificar (no es CHECK)
--   [8] cobro de 50 sin aplicar + su asiento → apply_payment_credit de 30 a una
--       factura del mismo cliente: la factura baja 30 y quedan 20 a favor
--   [9] pasarse de lo disponible → rechazo
--   [10] una factura de OTRO cliente → rechazo
--   [11] un cobro sin asiento → rechazo
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user   uuid;
  v_tax    uuid;
  v_n      int;
  v_err    text;
  v_ok     int := 0;
  v_fail   int := 0;
  v_cli    uuid := '984e8cd9-33f1-5236-9cd1-7263ec09668b';  -- Aurelio Barría Quintero
  v_fac    uuid;
  v_fac_otro uuid;
  v_saldo0 numeric;
  v_saldo1 numeric;
  v_pago   uuid;
  v_pago2  uuid;
  v_res    jsonb;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;

  -- [1]
  SELECT count(*) INTO v_n FROM tax_codes WHERE account_code IS NULL;
  IF v_n = 0 THEN RAISE NOTICE '[1] toda tasa tiene cuenta ...................... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[1] toda tasa tiene cuenta ...................... ❌ %', v_n; v_fail := v_fail + 1; END IF;

  -- [2]
  BEGIN
    INSERT INTO tax_codes (tenant_id, code, name, rate, active, account_code)
    VALUES (v_tenant, 'VER_073A', 'Verificación', 0.05, true, '999999');
    RAISE NOTICE '[2] cuenta inexistente ......................... ❌ PASÓ'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[2] cuenta inexistente ......................... ✅ RECHAZADA'; v_ok := v_ok + 1;
  END;

  -- [3]
  BEGIN
    INSERT INTO tax_codes (tenant_id, code, name, rate, active, account_code)
    VALUES (v_tenant, 'VER_073B', 'Verificación', 0.05, true, '100004');
    RAISE NOTICE '[3] cuenta de control .......................... ❌ PASÓ'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] cuenta de control .......................... ✅ RECHAZADA: %', left(v_err, 60); v_ok := v_ok + 1;
  END;

  -- [4]
  BEGIN
    INSERT INTO tax_codes (tenant_id, code, name, rate, active, account_code)
    VALUES (v_tenant, 'VER_073C', 'Verificación', 0.05, true, '200004') RETURNING id INTO v_tax;
    UPDATE tax_codes SET account_code = '200002' WHERE id = v_tax;
    RAISE NOTICE '[4] tasa nueva, cuenta propia y cambiable sin uso ✅'; v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[4] tasa nueva con cuenta propia ............... ❌ %', v_err; v_fail := v_fail + 1;
  END;

  -- [5]
  BEGIN
    UPDATE tax_codes SET account_code = '200004' WHERE tenant_id = v_tenant AND code = 'ITBMS_7';
    RAISE NOTICE '[5] tasa usada no cambia de cuenta ............. ❌ PASÓ'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%ya se usó%' THEN
      RAISE NOTICE '[5] tasa usada no cambia de cuenta ............. ✅ RECHAZADO'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[5] tasa usada no cambia de cuenta ............. ❌ otro error: %', v_err; v_fail := v_fail + 1;
    END IF;
  END;

  -- [6]
  BEGIN
    INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, payment_account_code, reference)
    VALUES (v_tenant, v_cli, current_date, 10, 'transferencia', '100001', '   ');
    RAISE NOTICE '[6] cobro sin referencia ....................... ❌ PASÓ'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[6] cobro sin referencia ....................... ✅ RECHAZADO'; v_ok := v_ok + 1;
  END;

  -- [7]
  BEGIN
    UPDATE payments SET notes = coalesce(notes, '') WHERE tenant_id = v_tenant
       AND (reference IS NULL OR btrim(reference) = '');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE '[7] cobro viejo sin referencia se modifica ..... ✅ (% fila/s)', v_n; v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[7] cobro viejo sin referencia se modifica ..... ❌ %', v_err; v_fail := v_fail + 1;
  END;

  -- [8] Cobro de 50 sin aplicaciones (queda todo a favor) + su asiento.
  SELECT id, balance_due INTO v_fac, v_saldo0 FROM invoices
   WHERE tenant_id = v_tenant AND invoice_number = 'FAC-HON-000007';
  INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, payment_account_code, reference)
  VALUES (v_tenant, v_cli, current_date, 50, 'transferencia', '100001', 'VER-074') RETURNING id INTO v_pago;
  PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 074', 'pago',
    jsonb_build_array(
      jsonb_build_object('account_code','100001','debit',50,'credit',0),
      jsonb_build_object('account_code','100004','debit',0,'credit',50,'client_id',v_cli)
    ), v_pago, NULL, NULL, NULL, v_user, NULL, 'VER-074', NULL);
  v_res := apply_payment_credit(v_tenant, v_pago,
    jsonb_build_array(jsonb_build_object('invoice_id', v_fac, 'amount', 30)), v_user);
  SELECT balance_due INTO v_saldo1 FROM invoices WHERE id = v_fac;
  IF (v_res->>'saldo_a_favor')::numeric = 20 AND v_saldo1 = v_saldo0 - 30 THEN
    RAISE NOTICE '[8] aplicar 30 de 50: factura % → %, quedan 20 ✅', v_saldo0, v_saldo1; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[8] aplicar saldo a favor ...................... ❌ % / % → %', v_res, v_saldo0, v_saldo1; v_fail := v_fail + 1;
  END IF;

  -- [9]
  BEGIN
    PERFORM apply_payment_credit(v_tenant, v_pago,
      jsonb_build_array(jsonb_build_object('invoice_id', v_fac, 'amount', 25)), v_user);
    RAISE NOTICE '[9] más de lo disponible ....................... ❌ PASÓ'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[9] más de lo disponible ....................... ✅ RECHAZADO'; v_ok := v_ok + 1;
  END;

  -- [10]
  SELECT id INTO v_fac_otro FROM invoices WHERE tenant_id = v_tenant AND invoice_number = 'FAC-HON-000012';
  BEGIN
    PERFORM apply_payment_credit(v_tenant, v_pago,
      jsonb_build_array(jsonb_build_object('invoice_id', v_fac_otro, 'amount', 5)), v_user);
    RAISE NOTICE '[10] factura de otro cliente ................... ❌ PASÓ'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[10] factura de otro cliente ................... ✅ RECHAZADO'; v_ok := v_ok + 1;
  END;

  -- [11]
  INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, payment_account_code, reference)
  VALUES (v_tenant, v_cli, current_date, 40, 'transferencia', '100001', 'VER-074B') RETURNING id INTO v_pago2;
  BEGIN
    PERFORM apply_payment_credit(v_tenant, v_pago2,
      jsonb_build_array(jsonb_build_object('invoice_id', v_fac, 'amount', 5)), v_user);
    RAISE NOTICE '[11] cobro sin asiento ......................... ❌ PASÓ'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[11] cobro sin asiento ......................... ✅ RECHAZADO'; v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '======== 073/074: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

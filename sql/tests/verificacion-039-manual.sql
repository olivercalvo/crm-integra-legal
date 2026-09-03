-- ============================================================================
-- VERIFICACIÓN de la 039 — reference, idempotencia y la cadena de hash.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos ni consume correlativo.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_e1 uuid; v_e2 uuid; v_n bigint; v_ref text; v_problemas int; v_err text;
  v_key text := 'tok-' || gen_random_uuid()::text;
  v_lineas jsonb := jsonb_build_array(
    jsonb_build_object('account_code','610001','debit',100,'credit',0,'description','Ajuste de alquiler'),
    jsonb_build_object('account_code','200001','debit',0,'credit',100,'description','Contra CxP')
  );
BEGIN
  -- [0] La cadena YA existente sigue integra despues del cambio de formula.
  SELECT COUNT(*) INTO v_problemas FROM public.verify_accounting_chain(v_tenant);
  IF v_problemas = 0 THEN
    RAISE NOTICE '[0] cadena de los asientos previos ............ ✅ ÍNTEGRA';
  ELSE
    RAISE NOTICE '[0] cadena de los asientos previos ............ ❌ % problema(s)', v_problemas;
  END IF;

  -- [1] Postear un asiento manual con reference e idempotency_key.
  SELECT public.post_journal_entry(
    v_tenant, current_date, 'Ajuste manual de prueba', 'manual', v_lineas,
    NULL, NULL, NULL, NULL, NULL, NULL, 'MEMO-2026-014', v_key
  ) INTO v_e1;
  SELECT entry_number, reference INTO v_n, v_ref FROM public.journal_entries WHERE id = v_e1;
  RAISE NOTICE '[1] asiento manual posteado .................. ✅ nro % · reference "%"', v_n, v_ref;

  -- [2] El MISMO token otra vez: el UNIQUE tiene que frenarlo.
  BEGIN
    SELECT public.post_journal_entry(
      v_tenant, current_date, 'Ajuste manual de prueba', 'manual', v_lineas,
      NULL, NULL, NULL, NULL, NULL, NULL, 'MEMO-2026-014', v_key
    ) INTO v_e2;
    RAISE NOTICE '[2] mismo idempotency_key ................... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '[2] mismo idempotency_key ................... ✅ RECHAZADO por el UNIQUE';
  END;

  -- [3] Sin token, dos asientos identicos SI entran (no hay source_id que los una).
  SELECT public.post_journal_entry(
    v_tenant, current_date, 'Ajuste sin token', 'manual', v_lineas
  ) INTO v_e1;
  SELECT public.post_journal_entry(
    v_tenant, current_date, 'Ajuste sin token', 'manual', v_lineas
  ) INTO v_e2;
  RAISE NOTICE '[3] dos manuales SIN token .................. ✅ los dos entran (por eso hace falta el token)';

  -- [4] La cadena sigue integra con los asientos nuevos encima.
  SELECT COUNT(*) INTO v_problemas FROM public.verify_accounting_chain(v_tenant);
  IF v_problemas = 0 THEN
    RAISE NOTICE '[4] cadena con los asientos nuevos .......... ✅ ÍNTEGRA';
  ELSE
    RAISE NOTICE '[4] cadena con los asientos nuevos .......... ❌ % problema(s)', v_problemas;
  END IF;

  -- [5] Un asiento descuadrado sigue rechazado, y el mensaje dice la diferencia.
  BEGIN
    PERFORM public.post_journal_entry(
      v_tenant, current_date, 'Descuadrado', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','610001','debit',100,'credit',0),
        jsonb_build_object('account_code','200001','debit',0,'credit',90))
    );
    RAISE NOTICE '[5] asiento descuadrado ..................... ⚠️ PASÓ';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[5] asiento descuadrado ..................... ✅ RECHAZADO: %', v_err;
  END;

  -- [6] Patrimonio e ingreso SI se aceptan: es lo que un ajuste hace.
  BEGIN
    PERFORM public.post_journal_entry(
      v_tenant, current_date, 'Aporte de capital de las socias', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100001','debit',5000,'credit',0,'description','Banco'),
        jsonb_build_object('account_code','300001','debit',0,'credit',5000,'description','Capital Social'))
    );
    RAISE NOTICE '[6] asiento contra PATRIMONIO ............... ✅ ACEPTADO (el guard de gastos NO aplica acá)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[6] asiento contra PATRIMONIO ............... ❌ RECHAZADO: %', v_err;
  END;
END $$;

ROLLBACK;

-- ============================================================================
-- VERIFICACIÓN de la 055 — reversar un asiento manual.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-055-reversion-de-asiento.sql
--
-- Nueve comprobaciones, incluida la falla forzada DESPUÉS de postear el espejo.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user     uuid;
  v_cli      uuid;
  v_manual   uuid;
  v_nro      bigint;
  v_factura  uuid;
  v_fac_nro  bigint;
  v_espejo   jsonb;
  v_res      jsonb;
  v_ok       int := 0;
  v_fail     int := 0;
  v_n        int;
  v_err      text;
  v_seq      bigint;
  v_rev_id   uuid;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cli  FROM clients WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;

  -- Un asiento manual propio, para no depender de lo que haya sembrado.
  v_manual := post_journal_entry(v_tenant, current_date, 'Verificación 055 — original', 'manual',
    jsonb_build_array(
      jsonb_build_object('account_code','100004','debit',30,'credit',0,'description','CxC','client_id',v_cli),
      jsonb_build_object('account_code','200001','debit',0,'credit',30,'description','CxP')
    ), NULL, NULL, NULL, NULL, v_user, NULL, 'VER-055', NULL);
  SELECT entry_number INTO v_nro FROM journal_entries WHERE id = v_manual;

  SELECT jsonb_agg(jsonb_build_object(
           'account_code', c.code, 'debit', l.credit, 'credit', l.debit,
           'description', 'Reversión: ' || coalesce(l.line_description, '')
         ) ORDER BY l.line_order)
    INTO v_espejo
    FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = v_manual;

  -- [1] Motivo corto → rechazado.
  BEGIN
    PERFORM reverse_journal_entry(v_tenant, v_manual, 'no', current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[1] motivo corto ............................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[1] motivo corto ............................... ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  -- [2] Fecha que no es la de hoy → rechazado (acta del 09/09).
  BEGIN
    PERFORM reverse_journal_entry(v_tenant, v_manual, 'Verificación 055',
      current_date - 30, 'Reversión', v_espejo, v_user);
    RAISE NOTICE '[2] fecha del original ......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[2] fecha del original ......................... ✅ RECHAZADO: %', left(v_err, 55);
    v_ok := v_ok + 1;
  END;

  -- [3] Espejo que no es el espejo → rechazado.
  BEGIN
    PERFORM reverse_journal_entry(v_tenant, v_manual, 'Verificación 055', current_date, 'Reversión',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',0,'credit',29),
        jsonb_build_object('account_code','200001','debit',29,'credit',0)
      ), v_user);
    RAISE NOTICE '[3] espejo con otro importe .................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] espejo con otro importe .................... ✅ RECHAZADO: %', left(v_err, 55);
    v_ok := v_ok + 1;
  END;

  -- [4] 🔴 EL FILTRO: un asiento de FACTURA no se reversa desde acá.
  SELECT id, entry_number INTO v_factura, v_fac_nro
    FROM journal_entries
   WHERE tenant_id = v_tenant AND source_type = 'factura'
   ORDER BY entry_number DESC LIMIT 1;
  IF v_factura IS NULL THEN
    RAISE NOTICE '[4] asiento de factura ......................... ⚠️ no hay ninguno en staging';
  ELSE
    BEGIN
      PERFORM reverse_journal_entry(v_tenant, v_factura, 'Verificación 055', current_date, 'Reversión',
        (SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit))
           FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id
          WHERE l.entry_id = v_factura),
        v_user);
      RAISE NOTICE '[4] asiento de factura ......................... ❌ PASÓ (debía fallar)';
      v_fail := v_fail + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%salió de un documento%' THEN
        RAISE NOTICE '[4] asiento de factura ......................... ✅ RECHAZADO: %', left(v_err, 60);
        v_ok := v_ok + 1;
      ELSE
        RAISE NOTICE '[4] asiento de factura ......................... ❌ otro motivo: %', left(v_err, 70);
        v_fail := v_fail + 1;
      END IF;
    END;
  END IF;

  -- [5] El camino feliz.
  v_res := reverse_journal_entry(v_tenant, v_manual, 'Verificación 055: el original estaba mal',
                                 current_date, 'Reversión del asiento ' || v_nro, v_espejo, v_user);
  v_rev_id := (v_res->>'entry_id')::uuid;
  SELECT count(*) INTO v_n FROM journal_entries
   WHERE id = v_rev_id AND source_type = 'reversion' AND reverses_entry_id = v_manual
     AND transaction_date = current_date AND source_id IS NULL;
  IF v_n = 1 THEN
    RAISE NOTICE '[5] reversión posteada ......................... ✅ asiento % del %',
      v_res->>'entry_number', v_res->>'transaction_date';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] reversión posteada ......................... ❌';
    v_fail := v_fail + 1;
  END IF;

  -- [6] El espejo cuadra y es el reflejo exacto.
  SELECT count(*) INTO v_n FROM (
    (SELECT c.code, l.debit, l.credit FROM journal_entry_lines l
       JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_rev_id
     EXCEPT ALL
     SELECT c.code, l.credit, l.debit FROM journal_entry_lines l
       JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_manual)
  ) d;
  IF v_n = 0 THEN
    RAISE NOTICE '[6] el espejo es exacto ........................ ✅';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[6] el espejo es exacto ........................ ❌ % diferencia(s)', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [7] Reversar dos veces → rechazado (y el índice único detrás).
  BEGIN
    PERFORM reverse_journal_entry(v_tenant, v_manual, 'Verificación 055 otra vez',
                                  current_date, 'Reversión', v_espejo, v_user);
    RAISE NOTICE '[7] reversar dos veces ......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[7] reversar dos veces ......................... ✅ RECHAZADO: %', left(v_err, 55);
    v_ok := v_ok + 1;
  END;

  -- [8] Y el ÍNDICE lo impide aunque alguien esquive el RPC: se intenta
  --     postear un segundo espejo directo por el motor.
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Segundo espejo a mano', 'reversion',
      v_espejo, NULL, NULL, v_manual, 'saltándose el RPC', v_user, NULL, NULL, NULL);
    RAISE NOTICE '[8] segundo espejo por el motor ................ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '[8] segundo espejo por el motor ................ ✅ RECHAZADO por el índice';
    v_ok := v_ok + 1;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[8] segundo espejo por el motor ................ ⚠️ otro error: %', left(v_err, 60);
    v_fail := v_fail + 1;
  END;

  -- [9] 🔴 FALLA FORZADA DESPUÉS DE POSTEAR: el correlativo vuelve.
  SELECT last_number INTO v_seq FROM accounting_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 055 falla forzada', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',9,'credit',0),
        jsonb_build_object('account_code','200001','debit',0,'credit',9)
      ), NULL, NULL, NULL, NULL, v_user, NULL, NULL, NULL);
    RAISE EXCEPTION 'falla forzada después de postear' USING ERRCODE = 'P0055';
  EXCEPTION WHEN SQLSTATE 'P0055' THEN
    NULL;
  END;
  SELECT last_number INTO v_n FROM accounting_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  IF v_n = v_seq THEN
    RAISE NOTICE '[9] falla después de postear: correlativo vuelve ✅ (quedó en %)', v_n;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[9] falla después de postear: correlativo vuelve ❌ % → %', v_seq, v_n;
    v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 055: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

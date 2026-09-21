-- ============================================================================
-- VERIFICACIÓN de la 050 — reverse_expense_tramite.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-050-reversion-de-gasto-de-tramite.sql
--
-- Presupone la 049 y la 050. Usa un gasto de trámite de staging SIN asiento y
-- con líneas clasificadas o, si no hay, le postea un asiento de prueba a uno
-- pendiente (todo dentro del ROLLBACK). Nueve comprobaciones.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant    uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user      uuid;
  v_gasto     uuid;
  v_total     numeric;
  v_ok        int := 0;
  v_fail      int := 0;
  v_n         int;
  v_st        text;
  v_err       text;
  v_entry     uuid;
  v_entry_nro bigint;
  v_lines     jsonb;
  v_espejo    jsonb;
  v_res       jsonb;
  v_seq_antes bigint;
  v_seq_desp  bigint;
  v_pago      uuid;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  -- Un gasto pendiente, sin asiento y sin pagos: se le postea un asiento de prueba.
  SELECT e.id, e.amount INTO v_gasto, v_total FROM expenses e
   WHERE e.tenant_id = v_tenant AND e.amount > 0 AND e.status = 'pendiente_pago'
     AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_type = 'gasto_tramite' AND j.source_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.expense_id = e.id)
   ORDER BY e.created_at DESC LIMIT 1;
  IF v_gasto IS NULL THEN
    RAISE NOTICE '⚠️ No hay gastos de trámite sin asiento en staging: nada que verificar.';
    RETURN;
  END IF;
  RAISE NOTICE 'Gasto % · monto %', v_gasto, v_total;

  -- [1] Sin asiento → rechazado con el mensaje que lo nombra.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','130003','debit',v_total,'credit',0,'description','Trámite'),
    jsonb_build_object('account_code','200001','debit',0,'credit',v_total,'description','Cuentas por pagar')
  );
  v_espejo := jsonb_build_array(
    jsonb_build_object('account_code','130003','debit',0,'credit',v_total),
    jsonb_build_object('account_code','200001','debit',v_total,'credit',0)
  );
  BEGIN
    PERFORM reverse_expense_tramite(v_tenant, v_gasto, 'sin asiento', current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[1] gasto sin asiento ......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%no está en el libro%' THEN
      RAISE NOTICE '[1] gasto sin asiento ......................... ✅ RECHAZADO: %', left(v_err, 60);
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[1] gasto sin asiento ......................... ❌ falló por otra cosa: %', v_err;
      v_fail := v_fail + 1;
    END IF;
  END;

  -- Se postea el asiento del gasto (como lo hará el alta automática).
  v_entry := post_journal_entry(v_tenant, current_date - 1, 'Gasto de trámite (verificación 050)', 'gasto_tramite',
                                v_lines, v_gasto, NULL, NULL, NULL, v_user, NULL, NULL, 'gasto-tramite:' || v_gasto);
  SELECT entry_number INTO v_entry_nro FROM journal_entries WHERE id = v_entry;
  UPDATE expenses SET posted_entry_id = v_entry WHERE id = v_gasto;

  -- [2] Motivo corto → rechazado.
  BEGIN
    PERFORM reverse_expense_tramite(v_tenant, v_gasto, 'no', current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[2] motivo corto .............................. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[2] motivo corto .............................. ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  -- [3] Fecha que no es hoy → rechazada.
  BEGIN
    PERFORM reverse_expense_tramite(v_tenant, v_gasto, 'Verificación 050', current_date - 10, 'x', v_espejo, v_user);
    RAISE NOTICE '[3] fecha que no es hoy ....................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%fecha en que se hace%' THEN
      RAISE NOTICE '[3] fecha que no es hoy ....................... ✅ RECHAZADA';
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[3] fecha que no es hoy ....................... ❌ falló por otra cosa: %', v_err;
      v_fail := v_fail + 1;
    END IF;
  END;

  -- [4] Líneas que NO son el espejo → rechazadas.
  BEGIN
    PERFORM reverse_expense_tramite(v_tenant, v_gasto, 'Verificación 050', current_date, 'x', v_lines, v_user);
    RAISE NOTICE '[4] espejo inexacto ........................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%espejo exacto%' THEN
      RAISE NOTICE '[4] espejo inexacto ........................... ✅ RECHAZADO';
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[4] espejo inexacto ........................... ❌ falló por otra cosa: %', v_err;
      v_fail := v_fail + 1;
    END IF;
  END;

  -- [5] Con un pago registrado → rechazado (primero los pagos).
  INSERT INTO supplier_payments (tenant_id, expense_id, kind, payment_number, payment_date, amount, method, payment_account_code, created_by)
  VALUES (v_tenant, v_gasto, 'payment', 'CE-999950', current_date, 1, 'transferencia', '100001', v_user)
  RETURNING id INTO v_pago;
  BEGIN
    PERFORM reverse_expense_tramite(v_tenant, v_gasto, 'Verificación 050', current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[5] con pagos registrados ..................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%Primero elimine%' THEN
      RAISE NOTICE '[5] con pagos registrados ..................... ✅ RECHAZADO: %', left(v_err, 60);
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[5] con pagos registrados ..................... ❌ falló por otra cosa: %', v_err;
      v_fail := v_fail + 1;
    END IF;
  END;
  DELETE FROM supplier_payments WHERE id = v_pago;

  -- [6] ATOMICIDAD: falla forzada DESPUÉS del posteo (en el UPDATE de status).
  SELECT last_number INTO v_seq_antes
    FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  CREATE OR REPLACE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''BOOM simulado después del posteo''; END';
  CREATE TRIGGER trg_boom BEFORE UPDATE OF status ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
  BEGIN
    PERFORM reverse_expense_tramite(v_tenant, v_gasto, 'Verificación 050', current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[6] falla forzada tras el posteo .............. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_n FROM journal_entries WHERE reverses_entry_id = v_entry;
    SELECT last_number INTO v_seq_desp
      FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
    SELECT status INTO v_st FROM expenses WHERE id = v_gasto;
    IF v_n = 0 AND v_seq_desp = v_seq_antes AND v_st = 'pendiente_pago' THEN
      RAISE NOTICE '[6] falla forzada tras el posteo .............. ✅ TODO DESHECHO (0 espejos, correlativo % intacto, gasto pendiente_pago)', v_seq_desp;
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[6] falla forzada tras el posteo .............. ❌ QUEDÓ A MEDIAS: % espejo(s), correlativo % → %, gasto "%"', v_n, v_seq_antes, v_seq_desp, v_st;
      v_fail := v_fail + 1;
    END IF;
  END;
  DROP TRIGGER trg_boom ON public.expenses;

  -- [7] Reversión real: espejo posteado, gasto anulado, posted_entry_id intacto.
  v_res := reverse_expense_tramite(v_tenant, v_gasto, 'Verificación 050', current_date,
             'Reversión del asiento ' || v_entry_nro, v_espejo, v_user);
  SELECT status INTO v_st FROM expenses WHERE id = v_gasto;
  SELECT count(*) INTO v_n FROM journal_entries
   WHERE reverses_entry_id = v_entry AND source_type = 'reversion' AND source_id = v_gasto AND transaction_date = current_date;
  IF v_st = 'anulado' AND v_n = 1 AND (v_res->>'reversed_entry_number')::bigint = v_entry_nro
     AND (SELECT posted_entry_id FROM expenses WHERE id = v_gasto) = v_entry THEN
    RAISE NOTICE '[7] reversión real ............................ ✅ asiento % revierte al % · gasto anulado · posted_entry_id intacto', v_res->>'entry_number', v_entry_nro;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[7] reversión real ............................ ❌ gasto % · espejos % · res %', v_st, v_n, v_res;
    v_fail := v_fail + 1;
  END IF;

  -- [8] Reversar dos veces → rechazado.
  BEGIN
    PERFORM reverse_expense_tramite(v_tenant, v_gasto, 'otra vez', current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[8] reversar dos veces ........................ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[8] reversar dos veces ........................ ✅ RECHAZADO: %', left(v_err, 40);
    v_ok := v_ok + 1;
  END;

  -- [9] Un gasto anulado sigue inmutable (038) y su estado no lo pisa un recálculo.
  BEGIN
    UPDATE expenses SET concept = concept || ' (x)' WHERE id = v_gasto;
    RAISE NOTICE '[9] anulado sigue inmutable ................... ❌ se pudo editar';
    v_fail := v_fail + 1;
  EXCEPTION WHEN restrict_violation THEN
    RAISE NOTICE '[9] anulado sigue inmutable ................... ✅ RECHAZADO por la 038';
    v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '════════ 050: % ✅ · % ❌ ════════', v_ok, v_fail;
END $$;

ROLLBACK;

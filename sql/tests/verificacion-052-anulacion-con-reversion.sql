-- ============================================================================
-- VERIFICACIÓN de la 052 — cancel_invoice_with_reversal y la válvula de la NC.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos, NC ni cambios de status.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-052-anulacion-con-reversion.sql
--
-- Presupone la 051 y la 052. Usa una factura `emitida` sin pagos CON asiento
-- (todas las emitidas desde el 09/09 lo tienen). Diez comprobaciones, incluida
-- la falla forzada DESPUÉS del posteo del espejo.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant    uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user      uuid;
  v_inv       uuid;
  v_number    text;
  v_issue     date;
  v_client    uuid;
  v_orig      uuid;
  v_orig_nro  bigint;
  v_ok        int := 0;
  v_fail      int := 0;
  v_n         int;
  v_st        text;
  v_err       text;
  v_espejo    jsonb;
  v_res       jsonb;
  v_seq_antes bigint;
  v_seq_desp  bigint;
  v_nc        uuid;
  v_periodo   uuid;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT i.id, i.invoice_number, i.issue_date, i.client_id, j.id, j.entry_number
    INTO v_inv, v_number, v_issue, v_client, v_orig, v_orig_nro
    FROM invoices i JOIN journal_entries j ON j.source_type = 'factura' AND j.source_id = i.id
   WHERE i.tenant_id = v_tenant AND i.status = 'emitida' AND i.amount_paid = 0 AND i.credited_total = 0
     AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = j.id)
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_inv IS NULL THEN
    RAISE NOTICE '⚠️ No hay facturas emitidas con asiento y sin pagos en staging: nada que verificar.';
    RETURN;
  END IF;
  RAISE NOTICE 'Factura % (%) · asiento %', v_number, v_issue, v_orig_nro;

  -- El espejo exacto del asiento original (lo que armaría construirAsientoDeReversion).
  SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit, 'description', 'Reversión') ORDER BY l.line_order)
    INTO v_espejo
    FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_orig;

  -- [1] Motivo corto → rechazado.
  BEGIN
    PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'no', NULL, current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[1] motivo corto .............................. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[1] motivo corto .............................. ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  -- [2] 🔴 Mes de la factura CERRADO → no se anula, se emite NC (Josuarth).
  UPDATE accounting_periods SET status = 'cerrado', closed_at = now(), closed_by = v_user
   WHERE tenant_id = v_tenant AND year = EXTRACT(YEAR FROM v_issue)::int AND month = EXTRACT(MONTH FROM v_issue)::int
   RETURNING id INTO v_periodo;
  IF v_periodo IS NULL THEN
    INSERT INTO accounting_periods (tenant_id, year, month, status, closed_at, closed_by)
    VALUES (v_tenant, EXTRACT(YEAR FROM v_issue)::int, EXTRACT(MONTH FROM v_issue)::int, 'cerrado', now(), v_user)
    RETURNING id INTO v_periodo;
  END IF;
  BEGIN
    PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'Verificación 052', NULL, current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[2] mes de la factura cerrado ................. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%está cerrado: no se anula, se emite una nota de crédito%' THEN
      RAISE NOTICE '[2] mes de la factura cerrado ................. ✅ RECHAZADO: %', left(v_err, 80);
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[2] mes de la factura cerrado ................. ❌ falló por otra cosa: %', v_err;
      v_fail := v_fail + 1;
    END IF;
  END;
  UPDATE accounting_periods SET status = 'abierto', closed_at = NULL, closed_by = NULL WHERE id = v_periodo;

  -- [3] Espejo inexacto → rechazado.
  BEGIN
    PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'Verificación 052', NULL, current_date, 'x',
      jsonb_build_array(jsonb_build_object('account_code','100004','debit',0,'credit',1), jsonb_build_object('account_code','400004','debit',1,'credit',0)), v_user);
    RAISE NOTICE '[3] espejo inexacto ........................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%espejo exacto%' THEN
      RAISE NOTICE '[3] espejo inexacto ........................... ✅ RECHAZADO';
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[3] espejo inexacto ........................... ❌ falló por otra cosa: %', v_err;
      v_fail := v_fail + 1;
    END IF;
  END;

  -- [4] Con asiento y sin líneas → rechazado (la anulación necesita el espejo).
  BEGIN
    PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'Verificación 052', NULL, current_date, 'x', NULL, v_user);
    RAISE NOTICE '[4] con asiento y sin espejo .................. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%necesita el espejo%' THEN
      RAISE NOTICE '[4] con asiento y sin espejo .................. ✅ RECHAZADO';
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[4] con asiento y sin espejo .................. ❌ falló por otra cosa: %', v_err;
      v_fail := v_fail + 1;
    END IF;
  END;

  -- [5] ATOMICIDAD: falla forzada DESPUÉS del posteo (en el UPDATE de status).
  SELECT last_number INTO v_seq_antes FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  CREATE OR REPLACE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''BOOM simulado después del posteo''; END';
  CREATE TRIGGER trg_boom BEFORE UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
  BEGIN
    PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'Verificación 052', NULL, current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[5] falla forzada tras el posteo .............. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_n FROM journal_entries WHERE reverses_entry_id = v_orig;
    SELECT last_number INTO v_seq_desp FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
    SELECT status INTO v_st FROM invoices WHERE id = v_inv;
    IF v_n = 0 AND v_seq_desp = v_seq_antes AND v_st = 'emitida' THEN
      RAISE NOTICE '[5] falla forzada tras el posteo .............. ✅ TODO DESHECHO (0 espejos, correlativo % intacto, factura emitida)', v_seq_desp;
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[5] falla forzada tras el posteo .............. ❌ QUEDÓ A MEDIAS: % espejo(s), correlativo % → %, factura "%"', v_n, v_seq_antes, v_seq_desp, v_st;
      v_fail := v_fail + 1;
    END IF;
  END;
  DROP TRIGGER trg_boom ON public.invoices;

  -- [6] Anulación real: espejo con fecha de hoy, factura anulada, motivo guardado.
  v_res := cancel_invoice_with_reversal(v_tenant, v_inv, 'Verificación 052', 'obs', current_date, 'Reversión del asiento ' || v_orig_nro, v_espejo, v_user);
  SELECT status INTO v_st FROM invoices WHERE id = v_inv;
  SELECT count(*) INTO v_n FROM journal_entries WHERE reverses_entry_id = v_orig AND source_type = 'reversion' AND source_id = v_inv AND transaction_date = current_date;
  IF v_st = 'anulada' AND v_n = 1 AND (v_res->>'reversed_entry_number')::bigint = v_orig_nro
     AND (SELECT cancellation_reason FROM invoices WHERE id = v_inv) = 'Verificación 052' THEN
    RAISE NOTICE '[6] anulación real ............................ ✅ asiento % revierte al % · anulada · motivo guardado', v_res->>'entry_number', v_orig_nro;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[6] anulación real ............................ ❌ % · espejos % · %', v_st, v_n, v_res;
    v_fail := v_fail + 1;
  END IF;

  -- [7] Anular dos veces → rechazado.
  BEGIN
    PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'otra vez', NULL, current_date, 'x', v_espejo, v_user);
    RAISE NOTICE '[7] anular dos veces .......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[7] anular dos veces .......................... ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  -- [8] La válvula: una NC sin asiento se borra SOLO con finanzas.nc_compensar.
  INSERT INTO credit_notes (tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason, status, currency, subtotal_total, tax_total, grand_total, created_by)
  VALUES (v_tenant, 'NC-999952', v_inv, v_client, current_date, 'verificación 052', 'emitida', 'USD', 1, 0, 1, v_user)
  RETURNING id INTO v_nc;
  INSERT INTO credit_note_lines (tenant_id, credit_note_id, line_order, description, quantity, unit_price, tax_code, tax_rate, created_by)
  VALUES (v_tenant, v_nc, 1, 'línea de prueba', 1, 1, 'EXENTO', 0, v_user);
  BEGIN
    DELETE FROM credit_notes WHERE id = v_nc;
    RAISE NOTICE '[8] borrar NC sin válvula ..................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[8] borrar NC sin válvula ..................... ✅ RECHAZADO (T6 intacta)';
    v_ok := v_ok + 1;
  END;

  -- [9] La función de compensación (válvula + DELETE en una transacción): líneas y cabecera se borran.
  v_res := finanzas_compensar_nota_de_credito(v_tenant, v_nc);
  SELECT count(*) INTO v_n FROM credit_notes WHERE id = v_nc;
  IF v_n = 0 AND (v_res->>'lineas')::int = 1 AND (v_res->>'cabeceras')::int = 1 THEN
    RAISE NOTICE '[9] DELETE compensatorio (función) ............ ✅ NC y líneas deshechas (%)', v_res;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[9] DELETE compensatorio con válvula .......... ❌ la NC sigue';
    v_fail := v_fail + 1;
  END IF;

  -- [10] Con la válvula pero CON asiento → no se borra (se reversa).
  INSERT INTO credit_notes (tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason, status, currency, subtotal_total, tax_total, grand_total, created_by)
  VALUES (v_tenant, 'NC-999953', v_inv, v_client, current_date, 'verificación 052 b', 'emitida', 'USD', 1, 0, 1, v_user)
  RETURNING id INTO v_nc;
  PERFORM post_journal_entry(v_tenant, current_date, 'NC de prueba', 'nota_credito',
    jsonb_build_array(jsonb_build_object('account_code','400004','debit',1,'credit',0), jsonb_build_object('account_code','100004','debit',0,'credit',1)),
    v_nc, NULL, NULL, NULL, v_user, NULL, 'NC-999953', NULL);
  BEGIN
    PERFORM finanzas_compensar_nota_de_credito(v_tenant, v_nc);
    RAISE NOTICE '[10] borrar NC con asiento .................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[10] borrar NC con asiento .................... ✅ RECHAZADO: %', left(v_err, 70);
    v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '════════ 052: % ✅ · % ❌ ════════', v_ok, v_fail;
END $$;

ROLLBACK;

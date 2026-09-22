-- ============================================================================
-- VERIFICACIÓN de la 053 — la anulación rechaza una factura con NC en el libro.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos, NC ni cambios de status.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-053-anulacion-con-nc-parcial.sql
--
-- Presupone la 051, la 052 y la 053. Usa una factura `emitida` sin pagos CON
-- asiento. Cuatro comprobaciones:
--   [1] NC parcial CON asiento `nota_credito` → la anulación se rechaza con el
--       mensaje de la 053, y no postea ninguna reversión.
--   [2] la factura sigue `emitida` después del rechazo.
--   [3] NC SIN asiento (la de la propia anulación, D5) → la anulación pasa.
--   [4] y postea exactamente UNA reversión del asiento original.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant    uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user      uuid;
  v_inv       uuid;
  v_number    text;
  v_client    uuid;
  v_orig      uuid;
  v_orig_nro  bigint;
  v_ok        int := 0;
  v_fail      int := 0;
  v_n         int;
  v_st        text;
  v_err       text;
  v_espejo    jsonb;
  v_nc        uuid;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT i.id, i.invoice_number, i.client_id, j.id, j.entry_number
    INTO v_inv, v_number, v_client, v_orig, v_orig_nro
    FROM invoices i JOIN journal_entries j ON j.source_type = 'factura' AND j.source_id = i.id
   WHERE i.tenant_id = v_tenant AND i.status = 'emitida' AND i.amount_paid = 0 AND i.credited_total = 0
     AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = j.id)
     AND NOT EXISTS (SELECT 1 FROM accounting_periods p WHERE p.tenant_id = i.tenant_id
                       AND p.year = EXTRACT(YEAR FROM i.issue_date)::int AND p.month = EXTRACT(MONTH FROM i.issue_date)::int
                       AND p.status = 'cerrado')
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_inv IS NULL THEN
    RAISE NOTICE '⚠️ No hay facturas emitidas con asiento, sin pagos y con el mes abierto en staging: nada que verificar.';
    RETURN;
  END IF;
  RAISE NOTICE 'Factura % · asiento %', v_number, v_orig_nro;

  SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit, 'description', 'Reversión') ORDER BY l.line_order)
    INTO v_espejo
    FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_orig;

  -- [1] + [2]: NC parcial con asiento propio → rechazo, sin reversión. El
  -- sub-bloque deshace la NC y su asiento al salir por la excepción.
  BEGIN
    INSERT INTO credit_notes (tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason, status, currency, subtotal_total, tax_total, grand_total, created_by)
    VALUES (v_tenant, 'NC-999531', v_inv, v_client, current_date, 'verificación 053 parcial', 'emitida', 'USD', 1, 0, 1, v_user)
    RETURNING id INTO v_nc;
    INSERT INTO credit_note_lines (tenant_id, credit_note_id, line_order, description, quantity, unit_price, tax_code, tax_rate, created_by)
    VALUES (v_tenant, v_nc, 1, 'línea de prueba', 1, 1, 'EXENTO', 0, v_user);
    PERFORM post_journal_entry(v_tenant, current_date, 'NC parcial de prueba', 'nota_credito',
      jsonb_build_array(jsonb_build_object('account_code','400004','debit',1,'credit',0), jsonb_build_object('account_code','100004','debit',0,'credit',1)),
      v_nc, NULL, NULL, NULL, v_user, NULL, 'NC-999531', NULL);

    BEGIN
      PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'verificación 053', NULL, current_date, 'Anulación', v_espejo, v_user);
      RAISE NOTICE '[1] anular con NC parcial en el libro ......... ❌ PASÓ (debía fallar)';
      v_fail := v_fail + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%ya tiene la nota de crédito NC-999531 en el libro%' THEN
        RAISE NOTICE '[1] anular con NC parcial en el libro ......... ✅ RECHAZADO: %', left(v_err, 80);
        v_ok := v_ok + 1;
      ELSE
        RAISE NOTICE '[1] anular con NC parcial en el libro ......... ❌ rechazado por OTRO motivo: %', v_err;
        v_fail := v_fail + 1;
      END IF;
    END;

    SELECT status INTO v_st FROM invoices WHERE id = v_inv;
    SELECT count(*) INTO v_n FROM journal_entries WHERE reverses_entry_id = v_orig;
    IF v_st = 'emitida' AND v_n = 0 THEN
      RAISE NOTICE '[2] sigue emitida, sin reversión .............. ✅';
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[2] sigue emitida, sin reversión .............. ❌ status=% reversiones=%', v_st, v_n;
      v_fail := v_fail + 1;
    END IF;

    RAISE EXCEPTION 'fin del sub-bloque [1]-[2]' USING ERRCODE = 'P0053';
  EXCEPTION WHEN SQLSTATE 'P0053' THEN
    NULL;
  END;

  -- [3] + [4]: NC total SIN asiento (la de la anulación, D5) → pasa y reversa.
  INSERT INTO credit_notes (tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason, status, currency, subtotal_total, tax_total, grand_total, created_by)
  VALUES (v_tenant, 'NC-999532', v_inv, v_client, current_date, 'verificación 053 total', 'emitida', 'USD', 1, 0, 1, v_user)
  RETURNING id INTO v_nc;
  INSERT INTO credit_note_lines (tenant_id, credit_note_id, line_order, description, quantity, unit_price, tax_code, tax_rate, created_by)
  VALUES (v_tenant, v_nc, 1, 'línea de prueba', 1, 1, 'EXENTO', 0, v_user);
  BEGIN
    PERFORM cancel_invoice_with_reversal(v_tenant, v_inv, 'verificación 053', NULL, current_date, 'Anulación', v_espejo, v_user);
    RAISE NOTICE '[3] anular con NC sin asiento ................. ✅ PASÓ';
    v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] anular con NC sin asiento ................. ❌ RECHAZADO: %', v_err;
    v_fail := v_fail + 1;
  END;
  SELECT status INTO v_st FROM invoices WHERE id = v_inv;
  SELECT count(*) INTO v_n FROM journal_entries WHERE reverses_entry_id = v_orig AND source_type = 'reversion';
  IF v_st = 'anulada' AND v_n = 1 THEN
    RAISE NOTICE '[4] anulada, con UNA reversión ................ ✅';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[4] anulada, con UNA reversión ................ ❌ status=% reversiones=%', v_st, v_n;
    v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 053: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

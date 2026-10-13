-- ============================================================================
-- VERIFICACIÓN de la 095 — un documento de prueba no entra al libro; una factura
-- REAL de un cliente de prueba (el caso de FAC-HON-000463) sí.
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-095-documentos-de-prueba-fuera-del-libro.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T        constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cli    uuid;
  v_real   uuid;
  v_prueba uuid;
  v_pago   uuid;
  v_nc     jsonb;
  v_cols   text;
  v_base   jsonb;
  v_b      boolean;
  v_err    text;
  v_ok     int := 0;
  v_fail   int := 0;
  v_fecha  date;
  v_cli_real uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  INSERT INTO clients (tenant_id, client_number, name, client_status, client_type)
  VALUES (T, 'VERIF-095', 'CLIENTE VERIFICACION 095', 'active', 'persona_juridica')
  RETURNING id INTO v_cli;

  SELECT to_jsonb(i) INTO v_base FROM invoices i
   WHERE i.tenant_id = T AND i.status = 'emitida' AND NOT i.de_prueba ORDER BY i.created_at DESC LIMIT 1;
  IF v_base IS NULL THEN
    RAISE NOTICE '⚠️ No hay facturas emitidas: nada que verificar.';
    RETURN;
  END IF;
  v_fecha := (v_base->>'accounting_date')::date;
  v_cli_real := (v_base->>'client_id')::uuid;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';
  v_base := v_base || jsonb_build_object('client_id', v_cli, 'dgi_cufe', NULL, 'dgi_cufe_origen', NULL,
                                         'amount_paid', 0, 'credited_total', 0, 'de_prueba', false, 'de_prueba_motivo', NULL);
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-095-REAL') INTO v_real;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-095-PRUEBA') INTO v_prueba;

  -- El cliente es de prueba; la «PRUEBA» se marca y la «REAL» no (como la 463).
  UPDATE clients SET es_de_prueba = true, es_de_prueba_motivo = 'Verificación 095: cliente de prueba', es_de_prueba_en = now()
   WHERE id = v_cli;
  UPDATE invoices SET de_prueba = true, de_prueba_motivo = 'Verificación 095: factura de prueba' WHERE id = v_prueba;

  -- [1] El asiento de la factura de prueba: rechazado.
  BEGIN
    PERFORM post_journal_entry(T, v_fecha, 'Verificación 095', 'factura',
      jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'x', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 10, 'description', 'x')),
      v_prueba, NULL, NULL, NULL, NULL, NULL, 'VERIF-095-PRUEBA', 'factura:' || v_prueba::text, NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [1] la factura de prueba entró al libro';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_ok := v_ok + 1; RAISE NOTICE '✅ [1] factura de prueba: %', v_err;
  END;

  -- [2] 🔴 El caso 463: la factura REAL de un cliente de prueba entra, con el
  --     cliente como tercero de 100004.
  BEGIN
    PERFORM post_journal_entry(T, v_fecha, 'Verificación 095 (real)', 'factura',
      jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'x', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 10, 'description', 'x')),
      v_real, NULL, NULL, NULL, NULL, NULL, 'VERIF-095-REAL', 'factura:' || v_real::text, NULL);
    v_ok := v_ok + 1; RAISE NOTICE '✅ [2] factura real de un cliente de prueba: entra al libro';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [2] la factura real no entró: %', v_err;
  END;

  -- [3] Un asiento MANUAL con el cliente de prueba como tercero: rechazado.
  BEGIN
    PERFORM post_journal_entry(T, v_fecha, 'Verificación 095 (manual)', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 5, 'credit', 0, 'description', 'x', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 5, 'description', 'x')),
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'manual:verif-095', NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [3] un asiento manual nombró a un cliente de prueba';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%es de prueba%' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [3] manual con cliente de prueba: %', v_err;
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE '❌ [3] rechazo por otro motivo: %', v_err;
    END IF;
  END;

  -- [4] Un cobro de prueba (nace así: el cliente es de prueba) no se aplica a la factura real.
  INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, reference, status)
  VALUES (T, v_cli, current_date, 5, 'transferencia', 'VERIF-095', 'registrado')
  RETURNING id INTO v_pago;
  BEGIN
    INSERT INTO payment_applications (tenant_id, payment_id, invoice_id, amount_applied) VALUES (T, v_pago, v_real, 5);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [4] un cobro de prueba se aplicó a una factura real';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%no se aplica uno al otro%' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [4] %', v_err;
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE '❌ [4] rechazo por otro motivo: %', v_err;
    END IF;
  END;
  -- …y sí a la de prueba.
  BEGIN
    INSERT INTO payment_applications (tenant_id, payment_id, invoice_id, amount_applied) VALUES (T, v_pago, v_prueba, 5);
    v_ok := v_ok + 1; RAISE NOTICE '✅ [5] cobro de prueba a factura de prueba: se aplica';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [5] no se aplicó: %', v_err;
  END;

  -- [6] Una NC de la factura de prueba nace de prueba (si hay una NC para copiar).
  SELECT to_jsonb(n) INTO v_nc FROM credit_notes n WHERE n.tenant_id = T ORDER BY n.created_at DESC LIMIT 1;
  IF v_nc IS NULL THEN
    RAISE NOTICE '⚪ [6] no hay NC para copiar: sin verificar';
  ELSE
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'credit_notes' AND is_generated = 'NEVER';
    -- Con un cliente REAL, para que la herencia venga de la FACTURA y no del cliente.
    EXECUTE format('INSERT INTO credit_notes (%s) SELECT %s FROM jsonb_populate_record(NULL::credit_notes, $1) RETURNING de_prueba', v_cols, v_cols)
      USING v_nc || jsonb_build_object('id', gen_random_uuid(), 'credit_note_number', 'VERIF-095-NC', 'invoice_id', v_prueba,
                                       'client_id', v_cli_real, 'status', 'emitida', 'fe_estado', 'no_emitida',
                                       'dgi_cufe', NULL, 'de_prueba', false, 'de_prueba_motivo', NULL,
                                       'subtotal_total', 1, 'tax_total', 0, 'grand_total', 1)
      INTO v_b;
    IF v_b THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [6] NC de una factura de prueba: nace de prueba';
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [6] la NC nació real'; END IF;
  END IF;

  RAISE NOTICE '095: % OK, % FALLAS', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'verificación 095: % fallas', v_fail;
  END IF;
END $$;

ROLLBACK;

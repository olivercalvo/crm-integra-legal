-- ============================================================================
-- VERIFICACIÓN de la 096 — inicio contable: lo anterior está contabilizado fuera.
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-096-inicio-contable.sql
--
-- Casos (los del pedido del 06/10/2026):
--   [1] factura del día ANTERIOR al inicio → el libro la rechaza
--   [2] factura del MISMO día del inicio   → entra
--   [3] factura POSTERIOR                  → entra
--   [4] cobro posterior aplicado a la factura anterior (cobro cruzado) → entra,
--       acreditando 100004 del cliente
--   [5] cobro anterior al inicio           → rechazado
--   [6] anulación de la factura anterior   → se anula sin ningún asiento
--   [7] compra anterior al inicio          → rechazada
--   [8] documento de PRUEBA posterior      → sigue rechazado (095)
--   [9] mover el inicio HACIA ADELANTE sobre [2], que tiene asiento → bloqueado
--  [10] mover el inicio HACIA ATRÁS sobre [1], que no tiene asiento → bloqueado
-- Las fechas de los ASIENTOS son las de hoy (período abierto): lo que el
-- trigger mira es la fecha del DOCUMENTO.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T        constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_ini    date;
  v_hoy    date := current_date;
  v_base   jsonb;
  v_cols   text;
  v_cli    uuid;
  v_antes  uuid;
  v_mismo  uuid;
  v_despues uuid;
  v_prueba uuid;
  v_pago   uuid;
  v_banco  text;
  v_compra jsonb;
  v_compra_id uuid;
  v_n0     int;
  v_n1     int;
  v_err    text;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ini := public.finanzas_inicio_contable(T);
  RAISE NOTICE 'inicio contable del bufete: %', v_ini;

  SELECT to_jsonb(i) INTO v_base FROM invoices i
   WHERE i.tenant_id = T AND i.status = 'emitida' AND NOT i.de_prueba ORDER BY i.created_at DESC LIMIT 1;
  IF v_base IS NULL THEN
    RAISE NOTICE '⚠️ No hay facturas emitidas para copiar: nada que verificar.';
    RETURN;
  END IF;
  v_cli := (v_base->>'client_id')::uuid;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';
  v_base := v_base || jsonb_build_object('dgi_cufe', NULL, 'dgi_cufe_origen', NULL, 'amount_paid', 0,
                                         'credited_total', 0, 'de_prueba', false, 'de_prueba_motivo', NULL);

  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-096-ANTES',
      'issue_date', v_ini - 1, 'accounting_date', v_ini - 1, 'due_date', v_ini + 29) INTO v_antes;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-096-MISMO',
      'issue_date', v_ini, 'accounting_date', v_hoy, 'due_date', v_ini + 30) INTO v_mismo;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-096-DESPUES',
      'issue_date', v_ini + 1, 'accounting_date', v_hoy, 'due_date', v_ini + 31) INTO v_despues;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-096-PRUEBA',
      'issue_date', v_ini + 1, 'accounting_date', v_hoy, 'due_date', v_ini + 31,
      'de_prueba', true, 'de_prueba_motivo', 'Verificación 096') INTO v_prueba;

  -- [1] Factura del día anterior al inicio: rechazada por la 096.
  BEGIN
    PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [1]', 'factura',
      jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'x', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 10, 'description', 'x')),
      v_antes, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-ANTES', 'factura:' || v_antes::text, NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [1] la factura anterior al inicio entró al libro';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%contabilizado fuera%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [1] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [1] rechazo por otro motivo: %', v_err; END IF;
  END;

  -- [2] y [3] El mismo día y el día siguiente: entran.
  BEGIN
    PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [2]', 'factura',
      jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'x', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 10, 'description', 'x')),
      v_mismo, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-MISMO', 'factura:' || v_mismo::text, NULL);
    v_ok := v_ok + 1; RAISE NOTICE '✅ [2] factura del mismo día del inicio: entra';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [2] no entró: %', v_err;
  END;
  BEGIN
    PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [3]', 'factura',
      jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'x', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 10, 'description', 'x')),
      v_despues, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-DESPUES', 'factura:' || v_despues::text, NULL);
    v_ok := v_ok + 1; RAISE NOTICE '✅ [3] factura posterior al inicio: entra';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [3] no entró: %', v_err;
  END;

  -- [4] Cobro cruzado: posterior al inicio, aplicado a la factura anterior.
  SELECT code INTO v_banco FROM chart_of_accounts
   WHERE tenant_id = T AND active AND account_type = 'asset' AND cuenta_control IS NULL
     AND (name ILIKE '%banco%' OR name ILIKE '%caja%') ORDER BY code LIMIT 1;
  INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, reference, status)
  VALUES (T, v_cli, v_ini + 5, 4, 'transferencia', 'VERIF-096-COBRO', 'registrado')
  RETURNING id INTO v_pago;
  INSERT INTO payment_applications (tenant_id, payment_id, invoice_id, amount_applied) VALUES (T, v_pago, v_antes, 4);
  BEGIN
    PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [4]', 'pago',
      jsonb_build_array(
        jsonb_build_object('account_code', v_banco, 'debit', 4, 'credit', 0, 'description', 'x'),
        jsonb_build_object('account_code', '100004', 'debit', 0, 'credit', 4, 'description', 'x', 'client_id', v_cli)),
      v_pago, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-COBRO', 'pago:' || v_pago::text, NULL);
    v_ok := v_ok + 1; RAISE NOTICE '✅ [4] cobro posterior a una factura anterior: entra (DEBE % / HABER 100004 del cliente)', v_banco;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [4] el cobro cruzado no entró: %', v_err;
  END;

  -- [5] Un cobro anterior al inicio: rechazado.
  UPDATE payments SET payment_date = v_ini - 3 WHERE id = v_pago;
  BEGIN
    PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [5]', 'pago',
      jsonb_build_array(
        jsonb_build_object('account_code', v_banco, 'debit', 1, 'credit', 0, 'description', 'x'),
        jsonb_build_object('account_code', '100004', 'debit', 0, 'credit', 1, 'description', 'x', 'client_id', v_cli)),
      v_pago, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-COBRO-2', 'pago:' || v_pago::text || ':2', NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [5] un cobro anterior al inicio entró al libro';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%contabilizado fuera%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [5] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [5] rechazo por otro motivo: %', v_err; END IF;
  END;
  -- Se saca el cobro para poder anular la factura (la anulación exige 0 pagado).
  DELETE FROM payment_applications WHERE payment_id = v_pago;

  -- [6] Anular la factura anterior: sin asiento que reversar, no postea nada.
  SELECT count(*) INTO v_n0 FROM journal_entries WHERE tenant_id = T;
  BEGIN
    PERFORM cancel_invoice_with_reversal(T, v_antes, 'Verificación 096: anular una factura contabilizada fuera',
      NULL, v_hoy, 'Anulación VERIF-096-ANTES', NULL, NULL);
    SELECT count(*) INTO v_n1 FROM journal_entries WHERE tenant_id = T;
    IF v_n1 = v_n0 AND (SELECT status FROM invoices WHERE id = v_antes) = 'anulada' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [6] factura anterior anulada, sin ningún asiento';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE '❌ [6] asientos antes % y después %', v_n0, v_n1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [6] no se pudo anular: %', v_err;
  END;

  -- [7] Una compra anterior al inicio: rechazada.
  SELECT to_jsonb(b) INTO v_compra FROM business_expenses b WHERE b.tenant_id = T ORDER BY b.created_at DESC LIMIT 1;
  IF v_compra IS NULL THEN
    RAISE NOTICE '⚪ [7] no hay compras para copiar: sin verificar';
  ELSE
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'business_expenses' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO business_expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::business_expenses, $1) RETURNING id', v_cols, v_cols)
      USING v_compra || jsonb_build_object('id', gen_random_uuid(), 'purchase_number', NULL,
        'expense_date', v_ini - 10, 'accounting_date', v_ini - 10, 'status', 'pendiente_pago',
        'amount_paid', 0, 'payment_date', NULL, 'credited_total', 0) INTO v_compra_id;
    BEGIN
      PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [7]', 'gasto',
        jsonb_build_array(
          jsonb_build_object('account_code', '600001', 'debit', 3, 'credit', 0, 'description', 'x'),
          jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 3, 'description', 'x',
                             'supplier_id', v_compra->>'supplier_id')),
        v_compra_id, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-CO', 'gasto:' || v_compra_id::text, NULL);
      v_fail := v_fail + 1; RAISE NOTICE '❌ [7] una compra anterior al inicio entró al libro';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%contabilizado fuera%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [7] %', v_err;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [7] rechazo por otro motivo: %', v_err; END IF;
    END;
  END IF;

  -- [8] Un documento de PRUEBA posterior al inicio: sigue fuera del libro (095).
  BEGIN
    PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [8]', 'factura',
      jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'x', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 10, 'description', 'x')),
      v_prueba, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-PRUEBA', 'factura:' || v_prueba::text, NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [8] un documento de prueba posterior al inicio entró al libro';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%es de prueba%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [8] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [8] rechazo por otro motivo: %', v_err; END IF;
  END;

  -- [9] Mover el inicio un día hacia adelante: [2] (del día del inicio) tiene asiento.
  BEGIN
    UPDATE finanzas_parametros SET fecha_inicio_contable = v_ini + 1 WHERE tenant_id = T;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [9] el inicio se movió hacia adelante dejando un asiento antes del inicio';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%VERIF-096-MISMO%tiene el asiento%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [9] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [9] bloqueado, pero sin nombrar el documento: %', v_err; END IF;
  END;

  -- [10] Mover el inicio un día hacia atrás: una factura del día anterior, emitida
  --      y sin asiento, quedaría dentro del libro sin asiento.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-096-ANTES-2',
      'issue_date', v_ini - 1, 'accounting_date', v_ini - 1, 'due_date', v_ini + 29) INTO v_antes;
  BEGIN
    UPDATE finanzas_parametros SET fecha_inicio_contable = v_ini - 1 WHERE tenant_id = T;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [10] el inicio se movió hacia atrás dejando un documento sin asiento';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%VERIF-096-ANTES-2%no tiene asiento%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [10] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [10] bloqueado, pero sin nombrar el documento: %', v_err; END IF;
  END;

  RAISE NOTICE '096: % OK, % FALLAS', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'verificación 096: % fallas', v_fail;
  END IF;
END $$;

ROLLBACK;

-- ============================================================================
-- VERIFICACIÓN de la 096 — inicio contable: lo anterior está contabilizado fuera.
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-096-inicio-contable.sql
--
-- Los documentos ANTERIORES al inicio (los que en producción ya existen, de
-- marzo a junio) se fabrican con los triggers de fecha de la 096 desactivados
-- SÓLO dentro de esta transacción (ALTER TABLE … DISABLE TRIGGER, que vuelve
-- con el ROLLBACK). Ninguna llave del producto: la app y la base no tienen
-- excepción.
--
-- Casos:
--   [1]  factura del día ANTERIOR: el libro la rechaza (respaldo)
--   [2]  factura del MISMO día del inicio: entra al libro
--   [3]  factura POSTERIOR: entra
--   [4]  cobro posterior aplicado a la factura anterior (cruzado): entra
--   [5]  cobro anterior: el libro lo rechaza
--   [6]  anular la factura anterior: rechazado (RPC y UPDATE directo), sin asientos
--   [7]  NC posterior de la factura anterior: su asiento entra
--   [8]  documento de PRUEBA posterior: sigue fuera del libro (095)
--   [9]  mover el inicio hacia adelante sobre [2] (con asiento): bloqueado
--   [10] mover el inicio hacia atrás sobre una factura anterior sin asiento: bloqueado
--   [11] ALTA con fecha anterior: factura, cobro, compra, gasto de trámite, NC: rechazadas
--   [12] EDICIÓN de la fecha de un borrador hacia antes del inicio: rechazada
--   [13] EMITIR un borrador viejo (fecha anterior): rechazado
--   [14] ELIMINAR un cobro y un gasto de trámite anteriores: rechazado
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T        constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_ini    date;
  v_hoy    date := (now() AT TIME ZONE 'America/Panama')::date;
  v_base   jsonb;
  v_cols   text;
  v_cli    uuid;
  v_antes  uuid;
  v_antes2 uuid;
  v_borr_v uuid;
  v_borr_n uuid;
  v_mismo  uuid;
  v_despues uuid;
  v_prueba uuid;
  v_pago   uuid;
  v_pago_v uuid;
  v_banco  text;
  v_nc     jsonb;
  v_nc_id  uuid;
  v_gasto  jsonb;
  v_gasto_v uuid;
  v_compra jsonb;
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
  SELECT code INTO v_banco FROM chart_of_accounts
   WHERE tenant_id = T AND active AND account_type = 'asset' AND cuenta_control IS NULL
     AND (name ILIKE '%banco%' OR name ILIKE '%caja%') ORDER BY code LIMIT 1;

  -- ── Los documentos de ANTES del inicio (como los de producción) ──────────
  ALTER TABLE invoices DISABLE TRIGGER trg_documento_desde_el_inicio;
  ALTER TABLE payments DISABLE TRIGGER trg_documento_desde_el_inicio;
  ALTER TABLE expenses DISABLE TRIGGER trg_documento_desde_el_inicio;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-096-ANTES',
      'issue_date', v_ini - 1, 'accounting_date', v_ini - 1, 'due_date', v_ini + 29) INTO v_antes;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-096-ANTES-2',
      'issue_date', v_ini - 1, 'accounting_date', v_ini - 1, 'due_date', v_ini + 29) INTO v_antes2;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'DRAFT-VERIF-096-VIEJO', 'status', 'borrador',
      'issue_date', v_ini - 2, 'accounting_date', v_ini - 2, 'due_date', v_ini + 28) INTO v_borr_v;
  INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, reference, status)
  VALUES (T, v_cli, v_ini - 3, 1, 'transferencia', 'VERIF-096-COBRO-VIEJO', 'registrado')
  RETURNING id INTO v_pago_v;
  SELECT to_jsonb(x) INTO v_gasto FROM expenses x WHERE x.tenant_id = T AND NOT x.de_prueba ORDER BY x.created_at DESC LIMIT 1;
  IF v_gasto IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::expenses, $1) RETURNING id', v_cols, v_cols)
      USING v_gasto || jsonb_build_object('id', gen_random_uuid(), 'date', v_ini - 5, 'accounting_date', v_ini - 5,
        'posted_entry_id', NULL, 'purchase_number', NULL, 'amount_paid', 0, 'status', 'pendiente_pago') INTO v_gasto_v;
  END IF;
  ALTER TABLE invoices ENABLE TRIGGER trg_documento_desde_el_inicio;
  ALTER TABLE payments ENABLE TRIGGER trg_documento_desde_el_inicio;
  ALTER TABLE expenses ENABLE TRIGGER trg_documento_desde_el_inicio;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';

  -- ── Los de DESDE el inicio (se crean como siempre) ───────────────────────
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
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'DRAFT-VERIF-096-NUEVO', 'status', 'borrador',
      'issue_date', v_hoy, 'accounting_date', v_hoy, 'due_date', v_hoy + 30) INTO v_borr_n;

  -- [1] Factura del día anterior: rechazada por el libro (respaldo de la app).
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
  INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, reference, status)
  VALUES (T, v_cli, v_hoy, 4, 'transferencia', 'VERIF-096-COBRO', 'registrado')
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
  DELETE FROM payment_applications WHERE payment_id = v_pago;

  -- [5] Un cobro anterior al inicio: el libro lo rechaza.
  BEGIN
    PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [5]', 'pago',
      jsonb_build_array(
        jsonb_build_object('account_code', v_banco, 'debit', 1, 'credit', 0, 'description', 'x'),
        jsonb_build_object('account_code', '100004', 'debit', 0, 'credit', 1, 'description', 'x', 'client_id', v_cli)),
      v_pago_v, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-COBRO-2', 'pago:' || v_pago_v::text, NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [5] un cobro anterior al inicio entró al libro';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%contabilizado fuera%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [5] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [5] rechazo por otro motivo: %', v_err; END IF;
  END;

  -- [6] Anular la factura anterior: rechazado por el RPC (vía su UPDATE) y por un UPDATE directo.
  SELECT count(*) INTO v_n0 FROM journal_entries WHERE tenant_id = T;
  BEGIN
    PERFORM cancel_invoice_with_reversal(T, v_antes, 'Verificación 096: anular una factura contabilizada fuera',
      NULL, v_hoy, 'Anulación VERIF-096-ANTES', NULL, NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [6] la factura anterior se anuló';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%contabilizada fuera%nota de crédito con fecha igual o posterior al inicio%' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [6] RPC: %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [6] rechazo por otro motivo: %', v_err; END IF;
  END;
  BEGIN
    UPDATE invoices SET status = 'anulada' WHERE id = v_antes;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [6b] un UPDATE directo anuló la factura anterior';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [6b] UPDATE directo a anulada: rechazado';
  END;
  SELECT count(*) INTO v_n1 FROM journal_entries WHERE tenant_id = T;
  IF v_n1 <> v_n0 THEN
    v_fail := v_fail + 1; RAISE NOTICE '❌ [6c] el intento de anular dejó asientos (% → %)', v_n0, v_n1;
  END IF;

  -- [7] NC posterior de la factura anterior: su asiento entra.
  SELECT to_jsonb(n) INTO v_nc FROM credit_notes n WHERE n.tenant_id = T AND NOT n.de_prueba ORDER BY n.created_at DESC LIMIT 1;
  IF v_nc IS NULL THEN
    RAISE NOTICE '⚪ [7] no hay NC para copiar: sin verificar';
  ELSE
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'credit_notes' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO credit_notes (%s) SELECT %s FROM jsonb_populate_record(NULL::credit_notes, $1) RETURNING id', v_cols, v_cols)
      USING v_nc || jsonb_build_object('id', gen_random_uuid(), 'credit_note_number', 'VERIF-096-NC', 'invoice_id', v_antes,
                                       'client_id', v_cli, 'status', 'emitida', 'fe_estado', 'no_emitida', 'dgi_cufe', NULL,
                                       'issue_date', v_hoy, 'accounting_date', v_hoy, 'de_prueba', false, 'de_prueba_motivo', NULL,
                                       'subtotal_total', 1, 'tax_total', 0, 'grand_total', 1)
      INTO v_nc_id;
    BEGIN
      PERFORM post_journal_entry(T, v_hoy, 'Verificación 096 [7]', 'nota_credito',
        jsonb_build_array(
          jsonb_build_object('account_code', '400001', 'debit', 1, 'credit', 0, 'description', 'x'),
          jsonb_build_object('account_code', '100004', 'debit', 0, 'credit', 1, 'description', 'x', 'client_id', v_cli)),
        v_nc_id, NULL, NULL, NULL, NULL, NULL, 'VERIF-096-NC', 'nota_credito:' || v_nc_id::text, NULL);
      v_ok := v_ok + 1; RAISE NOTICE '✅ [7] NC posterior de una factura anterior: entra (DEBE ingreso / HABER 100004 del cliente)';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_fail := v_fail + 1; RAISE NOTICE '❌ [7] la NC posterior no entró: %', v_err;
    END;
  END IF;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';

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

  -- [10] Mover el inicio un día hacia atrás: VERIF-096-ANTES-2 no tiene asiento.
  BEGIN
    UPDATE finanzas_parametros SET fecha_inicio_contable = v_ini - 1 WHERE tenant_id = T;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [10] el inicio se movió hacia atrás dejando un documento sin asiento';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%VERIF-096-ANTES-2%no tiene asiento%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [10] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [10] bloqueado, pero sin nombrar el documento: %', v_err; END IF;
  END;

  -- [11] ALTAS con fecha anterior al inicio: todas rechazadas.
  BEGIN
    EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1)', v_cols, v_cols)
      USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'DRAFT-VERIF-096-ALTA', 'status', 'borrador',
        'issue_date', v_ini - 1, 'accounting_date', v_ini - 1, 'due_date', v_ini + 29);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [11a] se creó una factura con fecha anterior al inicio';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE 'La fecha de la factura (%) es anterior al inicio contable%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [11a] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [11a] rechazo por otro motivo: %', v_err; END IF;
  END;
  BEGIN
    INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, reference, status)
    VALUES (T, v_cli, v_ini - 1, 1, 'transferencia', 'VERIF-096-ALTA', 'registrado');
    v_fail := v_fail + 1; RAISE NOTICE '❌ [11b] se creó un cobro con fecha anterior al inicio';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE 'La fecha del cobro%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [11b] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [11b] rechazo por otro motivo: %', v_err; END IF;
  END;
  SELECT to_jsonb(b) INTO v_compra FROM business_expenses b WHERE b.tenant_id = T ORDER BY b.created_at DESC LIMIT 1;
  IF v_compra IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'business_expenses' AND is_generated = 'NEVER';
    BEGIN
      EXECUTE format('INSERT INTO business_expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::business_expenses, $1)', v_cols, v_cols)
        USING v_compra || jsonb_build_object('id', gen_random_uuid(), 'purchase_number', NULL,
          'expense_date', v_ini - 10, 'accounting_date', v_ini - 10, 'status', 'pendiente_pago',
          'amount_paid', 0, 'payment_date', NULL, 'credited_total', 0);
      v_fail := v_fail + 1; RAISE NOTICE '❌ [11c] se creó una compra con fecha anterior al inicio';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'La fecha de la compra%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [11c] %', v_err;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [11c] rechazo por otro motivo: %', v_err; END IF;
    END;
  END IF;
  IF v_gasto IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses' AND is_generated = 'NEVER';
    BEGIN
      EXECUTE format('INSERT INTO expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::expenses, $1)', v_cols, v_cols)
        USING v_gasto || jsonb_build_object('id', gen_random_uuid(), 'date', v_ini - 1, 'accounting_date', v_ini - 1,
          'posted_entry_id', NULL, 'purchase_number', NULL, 'amount_paid', 0, 'status', 'pendiente_pago');
      v_fail := v_fail + 1; RAISE NOTICE '❌ [11d] se creó un gasto de trámite con fecha anterior al inicio';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'La fecha del gasto de trámite%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [11d] %', v_err;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [11d] rechazo por otro motivo: %', v_err; END IF;
    END;
  END IF;
  IF v_nc IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'credit_notes' AND is_generated = 'NEVER';
    BEGIN
      EXECUTE format('INSERT INTO credit_notes (%s) SELECT %s FROM jsonb_populate_record(NULL::credit_notes, $1)', v_cols, v_cols)
        USING v_nc || jsonb_build_object('id', gen_random_uuid(), 'credit_note_number', 'VERIF-096-NC-ALTA', 'invoice_id', v_antes,
                                         'client_id', v_cli, 'status', 'emitida', 'fe_estado', 'no_emitida', 'dgi_cufe', NULL,
                                         'issue_date', v_ini - 1, 'accounting_date', v_ini - 1, 'de_prueba', false,
                                         'subtotal_total', 1, 'tax_total', 0, 'grand_total', 1);
      v_fail := v_fail + 1; RAISE NOTICE '❌ [11e] se creó una NC con fecha anterior al inicio';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'La fecha de la nota de crédito%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [11e] %', v_err;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [11e] rechazo por otro motivo: %', v_err; END IF;
    END;
  END IF;

  -- [12] EDICIÓN: mover la fecha de un borrador a antes del inicio.
  BEGIN
    UPDATE invoices SET issue_date = v_ini - 1 WHERE id = v_borr_n;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [12] la fecha de un borrador se movió a antes del inicio';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE 'La fecha de la factura%anterior al inicio contable%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [12] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [12] rechazo por otro motivo: %', v_err; END IF;
  END;

  -- [13] EMITIR un borrador viejo (fecha anterior al inicio).
  BEGIN
    UPDATE invoices SET status = 'emitida', invoice_number = 'VERIF-096-VIEJO' WHERE id = v_borr_v;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [13] se emitió un borrador con fecha anterior al inicio';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE 'La fecha de la factura%anterior al inicio contable%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [13] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [13] rechazo por otro motivo: %', v_err; END IF;
  END;

  -- [14] ELIMINAR un cobro y un gasto de trámite anteriores al inicio.
  BEGIN
    DELETE FROM payments WHERE id = v_pago_v;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [14a] se eliminó un cobro contabilizado fuera';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE 'El cobro%contabilizado fuera%No se elimina: se corrige con un asiento de diario%' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [14a] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [14a] rechazo por otro motivo: %', v_err; END IF;
  END;
  IF v_gasto_v IS NOT NULL THEN
    BEGIN
      DELETE FROM expenses WHERE id = v_gasto_v;
      v_fail := v_fail + 1; RAISE NOTICE '❌ [14b] se eliminó un gasto de trámite contabilizado fuera';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'El gasto de trámite%contabilizado fuera%nota de crédito del proveedor%' THEN
        v_ok := v_ok + 1; RAISE NOTICE '✅ [14b] %', v_err;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [14b] rechazo por otro motivo: %', v_err; END IF;
    END;
  END IF;

  RAISE NOTICE '096: % OK, % FALLAS', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'verificación 096: % fallas', v_fail;
  END IF;
END $$;

ROLLBACK;

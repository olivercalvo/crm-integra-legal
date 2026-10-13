-- ============================================================================
-- VERIFICACIÓN de la 094 — la marca de prueba es del DOCUMENTO.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja clientes, facturas, asientos ni marcas.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-094-documentos-de-prueba.sql
--
-- Presupone la 094 aplicada. Crea adentro lo que necesita: un cliente marcado de
-- prueba con una factura REAL (el caso de FAC-HON-000463) y otra de prueba.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T        constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cli    uuid;
  v_real   uuid;
  v_prueba uuid;
  v_cols   text;
  v_b      boolean;
  v_err    text;
  v_ok     int := 0;
  v_fail   int := 0;
  v_base   jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Cliente nuevo (copia de uno existente con otro número) y dos facturas
  -- emitidas, copiadas de una existente: así no dependemos de los datos.
  INSERT INTO clients (tenant_id, client_number, name, client_status, client_type)
  VALUES (T, 'VERIF-094', 'CLIENTE VERIFICACION 094', 'active', 'persona_juridica')
  RETURNING id INTO v_cli;

  SELECT to_jsonb(i) INTO v_base FROM invoices i
   WHERE i.tenant_id = T AND i.status = 'emitida' ORDER BY i.created_at LIMIT 1;
  IF v_base IS NULL THEN
    RAISE NOTICE '⚠️ No hay facturas emitidas: nada que verificar.';
    RETURN;
  END IF;
  -- Columnas sin las generadas (balance_due): INSERT … SELECT de la copia.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';
  v_base := v_base || jsonb_build_object('client_id', v_cli, 'dgi_cufe', NULL, 'dgi_cufe_origen', NULL,
                                         'amount_paid', 0, 'credited_total', 0, 'de_prueba', false, 'de_prueba_motivo', NULL,
                                         -- 096: con la fecha de HOY. Copiar la de la factura vieja
                                         -- sería crear un documento anterior al inicio contable.
                                         'issue_date', current_date, 'accounting_date', current_date,
                                         'due_date', current_date + 30);
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-094-REAL') INTO v_real;

  -- [0] Un documento NUEVO de un cliente que todavía no es de prueba nace real.
  IF NOT (SELECT de_prueba FROM invoices WHERE id = v_real) THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [0] factura de un cliente normal: nace real';
  ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [0] nació de prueba sin motivo'; END IF;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-094-PRUEBA') INTO v_prueba;

  -- [1] Marcar el cliente NO marca sus documentos existentes.
  UPDATE clients SET es_de_prueba = true, es_de_prueba_motivo = 'Verificación 094: cliente de prueba', es_de_prueba_en = now()
   WHERE id = v_cli;
  SELECT bool_or(de_prueba) INTO v_b FROM invoices WHERE id IN (v_real, v_prueba);
  IF NOT v_b THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [1] marcar el cliente no toca sus facturas';
  ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [1] el cliente propagó la marca'; END IF;

  -- [2] Se marca una factura por número; la otra (la «463») queda real.
  UPDATE invoices SET de_prueba = true, de_prueba_motivo = 'Verificación 094: factura de prueba' WHERE id = v_prueba;
  IF (SELECT de_prueba FROM invoices WHERE id = v_prueba) AND NOT (SELECT de_prueba FROM invoices WHERE id = v_real) THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [2] una de prueba y la otra real, del mismo cliente';
  ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [2] marcas cruzadas'; END IF;

  -- [3] Sin motivo no se marca.
  BEGIN
    UPDATE invoices SET de_prueba = true, de_prueba_motivo = NULL WHERE id = v_real;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [3] se marcó sin motivo';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [3] sin motivo: rechazado';
  END;

  -- [4] Desmarcar sin la llave: rechazado. Con la llave: pasa.
  BEGIN
    UPDATE invoices SET de_prueba = false WHERE id = v_prueba;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [4] se desmarcó sin llave';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [4] desmarcar sin llave: rechazado';
  END;
  BEGIN
    UPDATE clients SET es_de_prueba = false WHERE id = v_cli;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [5] se desmarcó el cliente sin llave';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [5] desmarcar el cliente sin llave: rechazado';
  END;

  -- [6] Un documento con asiento no se marca (el asiento de la «real», como lo arma la emisión).
  PERFORM post_journal_entry(T, (v_base->>'accounting_date')::date, 'Verificación 094', 'factura',
    jsonb_build_array(
      jsonb_build_object('account_code', '100004', 'debit', (v_base->>'grand_total')::numeric, 'credit', 0,
                         'description', 'Factura VERIF-094-REAL', 'client_id', v_cli),
      jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', (v_base->>'grand_total')::numeric, 'description', 'Honorarios')),
    v_real, NULL, NULL, NULL, NULL, NULL, 'VERIF-094-REAL', 'factura:' || v_real::text, NULL);
  BEGIN
    UPDATE invoices SET de_prueba = true, de_prueba_motivo = 'Verificación 094: con asiento' WHERE id = v_real;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [6] se marcó una factura con asiento';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_ok := v_ok + 1; RAISE NOTICE '✅ [6] con asiento: %', v_err;
  END;

  -- [7] Lo NUEVO de un cliente de prueba nace de prueba (factura y cobro).
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING de_prueba', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-094-NUEVA') INTO v_b;
  IF v_b THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [7] factura nueva de un cliente de prueba: nace de prueba';
  ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [7] la factura nueva nació real'; END IF;
  INSERT INTO payments (tenant_id, client_id, payment_date, amount, method, reference, status)
  VALUES (T, v_cli, current_date, 5, 'transferencia', 'VERIF-094', 'registrado')
  RETURNING de_prueba INTO v_b;
  IF v_b THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [8] cobro nuevo de un cliente de prueba: nace de prueba';
  ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [8] el cobro nuevo nació real'; END IF;

  RAISE NOTICE '094: % OK, % FALLAS', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'verificación 094: % fallas', v_fail;
  END IF;
END $$;

ROLLBACK;

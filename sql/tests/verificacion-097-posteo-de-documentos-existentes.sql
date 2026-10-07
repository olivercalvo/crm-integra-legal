-- ============================================================================
-- VERIFICACIÓN de la 097 · posteo de documentos existentes, por mes.
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-097-posteo-de-documentos-existentes.sql
--
-- Trabaja sobre el mes del inicio contable (julio de 2026 en staging), con
-- facturas fabricadas para la prueba. Si ese mes ya tiene asientos manuales,
-- el caso [1] no se puede probar y lo avisa.
--
-- Casos:
--   [1] un lote bueno: factura, factura anulada + su reversión (que encuentra
--       su original DENTRO del mismo lote) y gasto de trámite: entra entero,
--       con su renglón en posteos_retroactivos y el posted_entry_id del gasto
--   [2] idempotencia: el mismo documento otra vez → lo frena el UNIQUE (034)
--   [3] TODO O NADA: un lote con un asiento descuadrado no deja ninguno, ni
--       el renglón del lote
--   [4] un mes por un solo método: con un asiento manual vigente en el rango,
--       se niega y lo nombra
--   [5] un rango que empieza antes del inicio contable: se niega
--   [6] un asiento con fecha fuera del rango: se niega
--   [7] authenticated no puede ejecutar la función
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T        constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_ini    date;
  v_fin    date;
  v_base   jsonb;
  v_cols   text;
  v_cli    uuid;
  v_a      uuid;
  v_b      uuid;
  v_c      uuid;
  v_gasto  jsonb;
  v_g      uuid;
  v_prv    uuid;
  v_fac    jsonb;
  v_items  jsonb;
  v_r      jsonb;
  v_lotes0 int;
  v_lotes1 int;
  v_n      int;
  v_ea     uuid;
  v_rev    uuid;
  v_err    text;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ini := public.finanzas_inicio_contable(T);
  v_fin := (date_trunc('month', v_ini) + interval '1 month - 1 day')::date;
  RAISE NOTICE 'mes de prueba: % a %', v_ini, v_fin;

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
                                         'credited_total', 0, 'de_prueba', false, 'de_prueba_motivo', NULL,
                                         'issue_date', v_ini + 2, 'accounting_date', v_ini + 2, 'due_date', v_ini + 32);
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-097-A') INTO v_a;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-097-B') INTO v_b;
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1) RETURNING id', v_cols, v_cols)
    USING v_base || jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'VERIF-097-C') INTO v_c;

  -- El gasto de trámite: copia de uno existente, sin asiento, en el mes.
  SELECT id INTO v_prv FROM suppliers WHERE tenant_id = T ORDER BY created_at LIMIT 1;
  SELECT to_jsonb(x) INTO v_gasto FROM expenses x WHERE x.tenant_id = T AND NOT x.de_prueba ORDER BY x.created_at DESC LIMIT 1;
  IF v_gasto IS NOT NULL AND v_prv IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::expenses, $1) RETURNING id', v_cols, v_cols)
      USING v_gasto || jsonb_build_object('id', gen_random_uuid(), 'date', v_ini + 3, 'accounting_date', v_ini + 3,
        'posted_entry_id', NULL, 'purchase_number', 'VERIF-097-G', 'amount_paid', 0, 'status', 'pendiente_pago',
        'supplier_id', v_prv) INTO v_g;
  END IF;

  -- El asiento de una factura de 10.00 (100004 contra 400001), como lo arma la app.
  v_fac := jsonb_build_array(
    jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'Verificación 097', 'client_id', v_cli),
    jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 10, 'description', 'Verificación 097'));

  SELECT count(*) INTO v_lotes0 FROM posteos_retroactivos WHERE tenant_id = T;

  -- [1] Lote bueno.
  v_items := jsonb_build_array(
    jsonb_build_object('transaction_date', v_ini + 2, 'description', 'Factura VERIF-097-A', 'source_type', 'factura',
      'source_id', v_a, 'reference', 'VERIF-097-A', 'lines', v_fac),
    jsonb_build_object('transaction_date', v_ini + 2, 'description', 'Factura VERIF-097-B', 'source_type', 'factura',
      'source_id', v_b, 'reference', 'VERIF-097-B', 'lines', v_fac),
    jsonb_build_object('transaction_date', v_ini + 4, 'description', 'Anulación de la factura VERIF-097-B', 'source_type', 'reversion',
      'source_id', v_b, 'reference', 'VERIF-097-B', 'reversal_reason', 'Verificación 097',
      'revierte_source_type', 'factura', 'revierte_source_id', v_b,
      'lines', jsonb_build_array(
        jsonb_build_object('account_code', '100004', 'debit', 0, 'credit', 10, 'description', 'Reversión', 'client_id', v_cli),
        jsonb_build_object('account_code', '400001', 'debit', 10, 'credit', 0, 'description', 'Reversión'))));
  IF v_g IS NOT NULL THEN
    v_items := v_items || jsonb_build_array(
      jsonb_build_object('transaction_date', v_ini + 3, 'description', 'Gasto VERIF-097-G', 'source_type', 'gasto_tramite',
        'source_id', v_g, 'reference', 'VERIF-097-G', 'lines', jsonb_build_array(
          jsonb_build_object('account_code', '130003', 'debit', 5, 'credit', 0, 'description', 'Verificación 097'),
          jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 5, 'description', 'Verificación 097', 'supplier_id', v_prv))));
  END IF;
  BEGIN
    v_r := post_documentos_existentes(T, v_ini, v_fin, v_items, NULL);
    SELECT count(*) INTO v_n FROM posteo_retroactivo_asientos WHERE posteo_id = (v_r->>'posteo_id')::uuid;
    SELECT id INTO v_ea FROM journal_entries WHERE tenant_id = T AND source_type = 'factura' AND source_id = v_b;
    SELECT reverses_entry_id INTO v_rev FROM journal_entries WHERE tenant_id = T AND source_type = 'reversion' AND source_id = v_b;
    IF v_n = jsonb_array_length(v_items) AND v_rev = v_ea
       AND (v_g IS NULL OR (SELECT posted_entry_id IS NOT NULL FROM expenses WHERE id = v_g)) THEN
      v_ok := v_ok + 1;
      RAISE NOTICE '✅ [1] lote de % asientos (%), la reversión apunta a su original del mismo lote%',
        v_n, v_r->'asientos', CASE WHEN v_g IS NULL THEN ' (sin gasto para probar)' ELSE ', el gasto guardó su posted_entry_id' END;
    ELSE
      v_fail := v_fail + 1;
      RAISE NOTICE '❌ [1] asientos del lote %, reversión→% (esperado %), gasto %', v_n, v_rev, v_ea,
        (SELECT posted_entry_id FROM expenses WHERE id = v_g);
    END IF;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%un solo método%' THEN
      RAISE NOTICE '⚠️ [1] no se pudo probar: el mes ya tiene asientos manuales (%).', v_err;
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE '❌ [1] %', v_err;
    END IF;
  END;

  -- [2] Idempotencia: la factura A otra vez.
  BEGIN
    PERFORM post_documentos_existentes(T, v_ini, v_fin, jsonb_build_array(
      jsonb_build_object('transaction_date', v_ini + 2, 'description', 'Factura VERIF-097-A', 'source_type', 'factura',
        'source_id', v_a, 'reference', 'VERIF-097-A', 'lines', v_fac)), NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [2] la misma factura entró dos veces';
  EXCEPTION WHEN unique_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [2] la misma factura no entra dos veces (UNIQUE de la 034)';
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id = T AND source_type = 'factura' AND source_id = v_a HAVING count(*) = 1) THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [2] rechazada (%), sigue un solo asiento', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [2] %', v_err; END IF;
  END;

  -- [3] Todo o nada: C bien + un asiento descuadrado.
  SELECT count(*) INTO v_lotes1 FROM posteos_retroactivos WHERE tenant_id = T;
  BEGIN
    PERFORM post_documentos_existentes(T, v_ini, v_fin, jsonb_build_array(
      jsonb_build_object('transaction_date', v_ini + 2, 'description', 'Factura VERIF-097-C', 'source_type', 'factura',
        'source_id', v_c, 'reference', 'VERIF-097-C', 'lines', v_fac),
      jsonb_build_object('transaction_date', v_ini + 5, 'description', 'Descuadrado', 'source_type', 'factura',
        'source_id', gen_random_uuid(), 'reference', 'VERIF-097-X', 'lines', jsonb_build_array(
          jsonb_build_object('account_code', '100004', 'debit', 10, 'credit', 0, 'description', 'x', 'client_id', v_cli),
          jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 9, 'description', 'x')))), NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [3] el lote descuadrado entró';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id = T AND source_id = v_c)
       AND (SELECT count(*) FROM posteos_retroactivos WHERE tenant_id = T) = v_lotes1 THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [3] no quedó ningún asiento ni el lote (%)', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [3] quedó algo a medias: %', v_err; END IF;
  END;

  -- [4] Un mes por un solo método.
  BEGIN
    PERFORM post_journal_entry(T, v_ini + 6, 'Asiento manual de la verificación 097', 'manual',
      v_fac, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'VERIF-097-MANUAL');
    PERFORM post_documentos_existentes(T, v_ini, v_fin, jsonb_build_array(
      jsonb_build_object('transaction_date', v_ini + 2, 'description', 'Factura VERIF-097-C', 'source_type', 'factura',
        'source_id', v_c, 'reference', 'VERIF-097-C', 'lines', v_fac)), NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [4] contabilizó un mes que ya tenía un asiento manual';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%un solo método%' AND v_err LIKE '%verificación 097%' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [4] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [4] otro motivo: %', v_err; END IF;
  END;

  -- [5] Antes del inicio contable.
  BEGIN
    PERFORM post_documentos_existentes(T, v_ini - 30, v_fin, jsonb_build_array(
      jsonb_build_object('transaction_date', v_ini + 2, 'description', 'x', 'source_type', 'factura',
        'source_id', v_c, 'reference', 'VERIF-097-C', 'lines', v_fac)), NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [5] aceptó un rango anterior al inicio';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%contabilizado fuera%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [5] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [5] otro motivo: %', v_err; END IF;
  END;

  -- [6] Fecha fuera del rango.
  BEGIN
    PERFORM post_documentos_existentes(T, v_ini, v_ini + 1, jsonb_build_array(
      jsonb_build_object('transaction_date', v_ini + 2, 'description', 'x', 'source_type', 'factura',
        'source_id', v_c, 'reference', 'VERIF-097-C', 'lines', v_fac)), NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [6] aceptó un asiento fuera del período';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%fuera del período%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [6] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [6] otro motivo: %', v_err; END IF;
  END;

  -- [7] Permisos.
  IF has_function_privilege('authenticated', 'public.post_documentos_existentes(uuid, date, date, jsonb, uuid)', 'EXECUTE') THEN
    v_fail := v_fail + 1; RAISE NOTICE '❌ [7] authenticated puede ejecutar la función';
  ELSE
    v_ok := v_ok + 1; RAISE NOTICE '✅ [7] sólo service_role ejecuta la función';
  END IF;

  RAISE NOTICE '097: % bien, % mal', v_ok, v_fail;
  IF v_fail > 0 THEN RAISE EXCEPTION '097: % caso(s) fallaron', v_fail; END IF;
END $$;

ROLLBACK;

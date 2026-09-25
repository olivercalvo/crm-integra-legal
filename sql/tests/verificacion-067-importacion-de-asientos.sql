-- ============================================================================
-- VERIFICACIÓN 067 — importar asientos. BEGIN … ROLLBACK: no deja nada.
--   node scripts/run-sql.mjs sql/tests/verificacion-067-importacion-de-asientos.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_t      uuid := 'a0000000-0000-0000-0000-000000000001';
  a1       text;
  a2       text;
  v_hoy    date := current_date;
  lote     jsonb;
  r        jsonb;
  v_imp    uuid;
  v_antes  int;
  v_seq    bigint;
  v_seq2   bigint;
  v_m      jsonb;
BEGIN
  SELECT code INTO a1 FROM public.chart_of_accounts WHERE tenant_id=v_t AND active AND account_type='expense' AND cuenta_control IS NULL ORDER BY code LIMIT 1;
  SELECT code INTO a2 FROM public.chart_of_accounts WHERE tenant_id=v_t AND active AND account_type='asset' AND cuenta_control IS NULL ORDER BY code LIMIT 1;

  lote := jsonb_build_array(
    jsonb_build_object('group_label','1','first_row',2,'transaction_date',v_hoy,'description','Depreciación de prueba','reference','PRUEBA-1',
      'lines', jsonb_build_array(
        jsonb_build_object('account_code',a1,'debit',100,'credit',0),
        jsonb_build_object('account_code',a2,'debit',0,'credit',100))),
    jsonb_build_object('group_label','2','first_row',4,'transaction_date',v_hoy,'description','Provisión de prueba','reference',NULL,
      'lines', jsonb_build_array(
        jsonb_build_object('account_code',a1,'debit',25.5,'credit',0),
        jsonb_build_object('account_code',a2,'debit',0,'credit',25.5))));

  -- ── 1. Lote válido: dos asientos, un lote ────────────────────────────────
  r := public.post_journal_entries_batch(v_t, 'prueba.xlsx', 'hash-prueba-1', 4, lote, NULL);
  v_imp := (r->>'import_id')::uuid;
  IF (r->>'entries')::int <> 2 OR (SELECT count(*) FROM public.journal_import_entries WHERE import_id = v_imp) <> 2 THEN
    RAISE EXCEPTION '1: el lote no quedó con sus dos asientos: %', r;
  END IF;
  RAISE NOTICE '1 ✅ lote % · asientos % · total débitos %', v_imp, r->'entry_numbers', r->>'total_debits';

  -- ── 2. Mismo hash otra vez → rechaza ────────────────────────────────────
  BEGIN
    PERFORM public.post_journal_entries_batch(v_t, 'prueba.xlsx', 'hash-prueba-1', 4, lote, NULL);
    RAISE EXCEPTION '2: aceptó el mismo archivo dos veces';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '2:%' THEN RAISE; END IF;
    RAISE NOTICE '2 ✅ hash duplicado: %', left(SQLERRM, 70);
  END;

  -- ── 3. TODO O NADA: el segundo asiento usa una cuenta inactiva ──────────
  SELECT count(*) INTO v_antes FROM public.journal_imports;
  SELECT last_number INTO v_seq FROM public.accounting_sequences WHERE tenant_id=v_t AND sequence_type='journal_entry';
  BEGIN
    PERFORM public.post_journal_entries_batch(v_t, 'malo.xlsx', 'hash-malo', 4,
      jsonb_build_array(
        lote->0,
        jsonb_build_object('group_label','2','first_row',4,'transaction_date',v_hoy,'description','Con cuenta inactiva',
          'lines', jsonb_build_array(
            jsonb_build_object('account_code','4101','debit',10,'credit',0),
            jsonb_build_object('account_code',a2,'debit',0,'credit',10)))), NULL);
    RAISE EXCEPTION '3: contabilizó un lote con una cuenta inactiva';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '3:%' THEN RAISE; END IF;
    RAISE NOTICE '3 · rechazado: %', left(SQLERRM, 80);
  END;
  SELECT last_number INTO v_seq2 FROM public.accounting_sequences WHERE tenant_id=v_t AND sequence_type='journal_entry';
  IF (SELECT count(*) FROM public.journal_imports) <> v_antes OR v_seq2 <> v_seq THEN
    RAISE EXCEPTION '3: quedó algo escrito (lotes % → %, correlativo % → %)', v_antes, (SELECT count(*) FROM public.journal_imports), v_seq, v_seq2;
  END IF;
  RAISE NOTICE '3 ✅ todo o nada: ni lote, ni asiento, ni número consumido';

  -- ── 4. Deshacer el lote: espejos exactos, fecha de hoy ──────────────────
  SELECT jsonb_agg(jsonb_build_object(
           'entry_id', e.entry_id,
           'description', 'Reversión del asiento ' || je.entry_number,
           'lines', (SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit))
                       FROM public.journal_entry_lines l JOIN public.chart_of_accounts c ON c.id = l.account_id
                      WHERE l.entry_id = e.entry_id)))
    INTO v_m
    FROM public.journal_import_entries e JOIN public.journal_entries je ON je.id = e.entry_id
   WHERE e.import_id = v_imp;
  r := public.reverse_journal_import(v_t, v_imp, 'Prueba de deshacer', v_hoy, v_m, NULL);
  IF (r->>'reversados')::int <> 2 OR (SELECT status FROM public.journal_imports WHERE id = v_imp) <> 'reversada' THEN
    RAISE EXCEPTION '4: no se deshizo: %', r;
  END IF;
  RAISE NOTICE '4 ✅ deshecha: %', r;

  -- ── 5. Deshacer otra vez → rechaza ──────────────────────────────────────
  BEGIN
    PERFORM public.reverse_journal_import(v_t, v_imp, 'Otra vez', v_hoy, v_m, NULL);
    RAISE EXCEPTION '5: se deshizo dos veces';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '5:%' THEN RAISE; END IF;
    RAISE NOTICE '5 ✅ una sola vez: %', left(SQLERRM, 60);
  END;

  -- ── 6. El hash quedó libre: se puede reimportar corregido ───────────────
  r := public.post_journal_entries_batch(v_t, 'prueba.xlsx', 'hash-prueba-1', 4, lote, NULL);
  RAISE NOTICE '6 ✅ reimportado tras deshacer: lote %', r->>'import_id';

  -- ── 7. El lote no se borra ──────────────────────────────────────────────
  BEGIN
    DELETE FROM public.journal_imports WHERE id = v_imp;
    RAISE EXCEPTION '7: se pudo borrar';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '7 ✅ el lote no se borra';
  END;
END $$;

ROLLBACK;

-- =============================================================================
-- PRUEBA DE PUNTA A PUNTA DEL MOTOR DE POSTEO
-- =============================================================================
--   node scripts/run-sql.mjs sql/tests/motor-posteo.test.sql
--
-- TODO corre adentro de una transacción que termina en ROLLBACK. No es una
-- comodidad: los asientos son INMUTABLES por los triggers de 023, así que unos
-- de prueba no se podrían borrar después. Los triggers solo se disparan con
-- UPDATE y DELETE reales, y un rollback no los toca.
--
-- Por eso también se puede correr contra una staging con datos, sin miedo.
-- Contra producción no corre: el runner lo impide.
--
-- Qué cubre:
--   1. Posteo válido: correlativo, líneas, período resuelto por la fecha.
--   2. Encadenado del hash desde el génesis.
--   3. El verificador de la cadena.
--   4. NUEVE rechazos, incluida la reversión sin motivo (el CHECK que la 029
--      restauró después del bug de la 028).
--   5. Que ningún rechazo consuma número de asiento.
--   6. Una reversión bien armada.
--   7. La auto-creación de períodos ACOTADA al año en curso y el siguiente.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  T uuid := 'a0000000-0000-0000-0000-000000000001';
  v_id1 uuid; v_id2 uuid;
  v_n1 bigint; v_n2 bigint;
  v_prev text; v_hash1 text;
  v_lineas int; v_deb numeric; v_cre numeric;
  v_rotos int;
  v_seq bigint;
  v_period_id uuid;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== 1) POSTEO VÁLIDO ===';

  v_id1 := public.post_journal_entry(
    T, DATE '2026-03-15', 'Cobro de honorarios a cliente', 'factura',
    '[{"account_code":"100001","debit":1000,"credit":0,"description":"Ingreso a banco"},
      {"account_code":"400001","debit":0,"credit":1000}]'::jsonb
  );

  SELECT entry_number, prev_hash, hash INTO v_n1, v_prev, v_hash1
    FROM journal_entries WHERE id = v_id1;
  SELECT count(*), sum(debit), sum(credit) INTO v_lineas, v_deb, v_cre
    FROM journal_entry_lines WHERE entry_id = v_id1;

  RAISE NOTICE 'asiento nro % | lineas % | debitos % | creditos %', v_n1, v_lineas, v_deb, v_cre;
  RAISE NOTICE 'prev_hash arranca en genesis: %', (v_prev = repeat('0',64));
  IF v_n1 <> 1 THEN RAISE EXCEPTION 'FALLO: el primer asiento debia ser el nro 1, fue %', v_n1; END IF;
  IF v_lineas <> 2 THEN RAISE EXCEPTION 'FALLO: se esperaban 2 lineas'; END IF;
  IF v_deb <> v_cre THEN RAISE EXCEPTION 'FALLO: no cuadra'; END IF;
  IF v_prev <> repeat('0',64) THEN RAISE EXCEPTION 'FALLO: el primero debe encadenar del genesis'; END IF;

  -- El período se resolvió por la fecha, no se pasó a mano.
  SELECT period_id INTO v_period_id FROM journal_entries WHERE id = v_id1;
  IF NOT EXISTS (SELECT 1 FROM accounting_periods WHERE id = v_period_id AND year = 2026 AND month = 3) THEN
    RAISE EXCEPTION 'FALLO: el periodo resuelto no es 2026-03';
  END IF;
  RAISE NOTICE 'periodo resuelto por la fecha: 2026-03  ok';

  RAISE NOTICE '';
  RAISE NOTICE '=== 2) SEGUNDO ASIENTO: correlativo y cadena ===';

  v_id2 := public.post_journal_entry(
    T, DATE '2026-03-20', 'Pago de alquiler', 'gasto',
    '[{"account_code":"610001","debit":500,"credit":0},
      {"account_code":"100001","debit":0,"credit":500}]'::jsonb
  );
  SELECT entry_number, prev_hash INTO v_n2, v_prev FROM journal_entries WHERE id = v_id2;
  RAISE NOTICE 'asiento nro % | prev_hash == hash del anterior: %', v_n2, (v_prev = v_hash1);
  IF v_n2 <> 2 THEN RAISE EXCEPTION 'FALLO: correlativo con hueco'; END IF;
  IF v_prev <> v_hash1 THEN RAISE EXCEPTION 'FALLO: la cadena no encadena'; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== 3) VERIFICADOR DE LA CADENA ===';
  SELECT count(*) INTO v_rotos FROM public.verify_accounting_chain(T);
  RAISE NOTICE 'eslabones rotos: % (esperado 0)', v_rotos;
  IF v_rotos <> 0 THEN RAISE EXCEPTION 'FALLO: la cadena reporta % rotos', v_rotos; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== 4) RECHAZOS ===';

  -- 4a) no cuadra
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-03-15', 'Descuadrado', 'manual',
      '[{"account_code":"100001","debit":100,"credit":0},
        {"account_code":"400001","debit":0,"credit":90}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto un asiento descuadrado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'no cuadra ............... rechazado: %', left(SQLERRM, 60);
  END;

  -- 4b) una sola linea
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-03-15', 'Una linea', 'manual',
      '[{"account_code":"100001","debit":100,"credit":0}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto un asiento de una linea';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'una sola linea .......... rechazado: %', left(SQLERRM, 60);
  END;

  -- 4c) debito Y credito en la misma linea
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-03-15', 'Ambos', 'manual',
      '[{"account_code":"100001","debit":100,"credit":100},
        {"account_code":"400001","debit":0,"credit":100}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto debito y credito en la misma linea';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'debito Y credito ........ rechazado: %', left(SQLERRM, 60);
  END;

  -- 4d) cuenta inexistente
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-03-15', 'Cuenta fantasma', 'manual',
      '[{"account_code":"999999","debit":100,"credit":0},
        {"account_code":"400001","debit":0,"credit":100}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto una cuenta inexistente';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'cuenta inexistente ...... rechazado: %', left(SQLERRM, 60);
  END;

  -- 4e) cuenta INACTIVA (1101 es de las viejas de QuickBooks)
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-03-15', 'Cuenta inactiva', 'manual',
      '[{"account_code":"1101","debit":100,"credit":0},
        {"account_code":"400001","debit":0,"credit":100}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto una cuenta inactiva';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'cuenta inactiva ......... rechazado: %', left(SQLERRM, 60);
  END;

  -- 4f) sin descripcion (Art. 5.5)
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-03-15', '   ', 'manual',
      '[{"account_code":"100001","debit":100,"credit":0},
        {"account_code":"400001","debit":0,"credit":100}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto un asiento sin descripcion';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'sin descripcion ......... rechazado: %', left(SQLERRM, 60);
  END;

  -- 4g) año sin periodos provisionados
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2029-05-10', 'Año sin periodos', 'manual',
      '[{"account_code":"100001","debit":100,"credit":0},
        {"account_code":"400001","debit":0,"credit":100}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto una fecha sin periodo provisionado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'año sin periodos ........ rechazado: %', left(SQLERRM, 60);
  END;

  -- 4h) periodo CERRADO
  UPDATE accounting_periods SET status = 'cerrado'
   WHERE tenant_id = T AND year = 2026 AND month = 7;
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-07-10', 'Periodo cerrado', 'manual',
      '[{"account_code":"100001","debit":100,"credit":0},
        {"account_code":"400001","debit":0,"credit":100}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto un asiento en periodo cerrado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'periodo cerrado ......... rechazado: %', left(SQLERRM, 60);
  END;

  -- 4i) REVERSION sin motivo — prueba el CHECK que la 029 restauro
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2026-03-15', 'Reversion sin motivo', 'reversion',
      '[{"account_code":"400001","debit":1000,"credit":0},
        {"account_code":"100001","debit":0,"credit":1000}]'::jsonb);
    RAISE EXCEPTION 'FALLO: acepto una reversion sin original ni motivo';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'reversion sin motivo .... rechazado (CHECK de la 029)';
  END;

  RAISE NOTICE '';
  RAISE NOTICE '=== 5) EL CORRELATIVO NO DEJA HUECOS TRAS LOS RECHAZOS ===';
  SELECT last_number INTO v_seq FROM accounting_sequences
   WHERE tenant_id = T AND sequence_type = 'journal_entry';
  RAISE NOTICE 'last_number = % (esperado 2: los 9 rechazos no consumieron numero)', v_seq;
  IF v_seq <> 2 THEN
    RAISE EXCEPTION 'FALLO: el correlativo quedo en % y deberia ser 2', v_seq;
  END IF;

  -- 6) reversion BIEN armada
  RAISE NOTICE '';
  RAISE NOTICE '=== 6) REVERSION VALIDA ===';
  PERFORM public.post_journal_entry(
    T, DATE '2026-03-16', 'Reversion del cobro', 'reversion',
    '[{"account_code":"400001","debit":1000,"credit":0},
      {"account_code":"100001","debit":0,"credit":1000}]'::jsonb,
    NULL, NULL, v_id1, 'Se cobro dos veces por error'
  );
  SELECT count(*) INTO v_rotos FROM public.verify_accounting_chain(T);
  RAISE NOTICE 'cadena tras 3 asientos, eslabones rotos: % (esperado 0)', v_rotos;
  IF v_rotos <> 0 THEN RAISE EXCEPTION 'FALLO: cadena rota tras la reversion'; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== 7) AUTO-CREACION DE PERIODOS, ACOTADA ===';

  -- Se borran los periodos de 2027 para ver si el motor los recrea solo.
  DELETE FROM accounting_periods WHERE tenant_id = T AND year = 2027;
  RAISE NOTICE 'periodos de 2027 borrados: %',
    (SELECT count(*) FROM accounting_periods WHERE tenant_id=T AND year=2027);

  PERFORM public.post_journal_entry(
    T, DATE '2027-02-10', 'Asiento en el año siguiente', 'manual',
    '[{"account_code":"100001","debit":10,"credit":0},
      {"account_code":"400001","debit":0,"credit":10}]'::jsonb);
  RAISE NOTICE 'año siguiente (2027) .... posteo OK, periodos ahora: %',
    (SELECT count(*) FROM accounting_periods WHERE tenant_id=T AND year=2027);
  IF (SELECT count(*) FROM accounting_periods WHERE tenant_id=T AND year=2027) <> 12 THEN
    RAISE EXCEPTION 'FALLO: no se autocrearon los 12 periodos de 2027';
  END IF;

  -- 2028 esta FUERA de la cota (hoy es 2026): tiene que seguir fallando.
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2028-01-05', 'Fuera de la cota', 'manual',
      '[{"account_code":"100001","debit":10,"credit":0},
        {"account_code":"400001","debit":0,"credit":10}]'::jsonb);
    RAISE EXCEPTION 'FALLO: autocreo un año fuera de la cota';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE '2028 (fuera de cota) .... rechazado: %', left(SQLERRM, 55);
  END;

  -- Un año PASADO tampoco se abre solo: el ejercicio ya podria estar certificado.
  BEGIN
    PERFORM public.post_journal_entry(T, DATE '2025-06-01', 'Año pasado', 'manual',
      '[{"account_code":"100001","debit":10,"credit":0},
        {"account_code":"400001","debit":0,"credit":10}]'::jsonb);
    RAISE EXCEPTION 'FALLO: autocreo un año pasado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FALLO:%' THEN RAISE; END IF;
    RAISE NOTICE 'año pasado (2025) ....... rechazado: %', left(SQLERRM, 55);
  END;

  SELECT count(*) INTO v_rotos FROM public.verify_accounting_chain(T);
  IF v_rotos <> 0 THEN RAISE EXCEPTION 'FALLO: cadena rota al final'; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '✅ TODAS LAS PRUEBAS DEL MOTOR PASARON';
END $$;

-- Nada de esto queda: los asientos son inmutables y no se podrían borrar después.
ROLLBACK;

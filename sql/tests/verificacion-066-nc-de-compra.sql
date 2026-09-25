-- ============================================================================
-- VERIFICACIÓN 066 — NC de compra. Todo dentro de BEGIN … ROLLBACK: no deja nada.
--   node scripts/run-sql.mjs sql/tests/verificacion-066-nc-de-compra.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant  uuid;
  v_compra  uuid;
  v_pagada  uuid;
  l1 record; l2 record;
  v_tax1    numeric(12,2);
  r         jsonb;
  v_nc1     uuid;
  v_be      record;
  v_asiento jsonb;
  v_espejo  jsonb;
  v_ok      boolean;
  v_monto   numeric(12,2);
BEGIN
  -- Una compra pendiente con asiento y dos líneas, y una ya pagada.
  SELECT be.id, be.tenant_id INTO v_compra, v_tenant FROM public.business_expenses be
   WHERE be.status = 'pendiente_pago' AND be.credited_total = 0
     AND EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.source_type='gasto' AND j.source_id=be.id)
     AND (SELECT count(*) FROM public.expense_lines l WHERE l.business_expense_id = be.id) >= 2
   LIMIT 1;
  IF v_compra IS NULL THEN RAISE EXCEPTION 'no hay compra de prueba'; END IF;
  SELECT be.id INTO v_pagada FROM public.business_expenses be
   WHERE be.status = 'pagado' AND be.tenant_id = v_tenant
     AND EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.source_type='gasto' AND j.source_id=be.id) LIMIT 1;

  SELECT * INTO l1 FROM public.expense_lines WHERE business_expense_id = v_compra ORDER BY line_order LIMIT 1;
  SELECT * INTO l2 FROM public.expense_lines WHERE business_expense_id = v_compra ORDER BY line_order OFFSET 1 LIMIT 1;

  -- ── 1. NC PARCIAL: la mitad de la línea 1 ───────────────────────────────
  v_monto := round(l1.amount / 2, 2);
  v_tax1  := round(v_monto * l1.tax_rate, 2);
  v_asiento := jsonb_build_array(
    jsonb_build_object('account_code','200001','debit', v_monto + v_tax1,'credit',0,'description','t'),
    jsonb_build_object('account_code', l1.chart_account_code,'debit',0,'credit', v_monto,'description','t'));
  IF v_tax1 > 0 THEN
    v_asiento := v_asiento || jsonb_build_array(jsonb_build_object('account_code','200003','debit',0,'credit',v_tax1,'description','t'));
  END IF;
  r := public.create_supplier_credit_note(v_tenant, v_compra, 'NC-PRUEBA-1', current_date, NULL,
        'Prueba parcial', current_date,
        jsonb_build_array(jsonb_build_object('expense_line_id', l1.id, 'amount', v_monto)), v_asiento, NULL);
  v_nc1 := (r->>'id')::uuid;
  SELECT total, credited_total, balance_due, status INTO v_be FROM public.business_expenses WHERE id = v_compra;
  IF v_be.credited_total <> v_monto + v_tax1 OR v_be.balance_due <> v_be.total - v_monto - v_tax1 OR v_be.status <> 'pendiente_pago' THEN
    RAISE EXCEPTION '1: saldo mal tras la parcial: %', row_to_json(v_be);
  END IF;
  RAISE NOTICE '1 ✅ parcial % · acreditado % · saldo %', r->>'credit_note_number', v_be.credited_total, v_be.balance_due;

  -- ── 2. Pasarse del tope de la línea → rechaza ───────────────────────────
  BEGIN
    PERFORM public.create_supplier_credit_note(v_tenant, v_compra, 'NC-PRUEBA-2', current_date, NULL,
      'Se pasa', current_date, jsonb_build_array(jsonb_build_object('expense_line_id', l1.id, 'amount', l1.amount)),
      v_asiento, NULL);
    RAISE EXCEPTION '2: aceptó pasarse del tope de la línea';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '2:%' THEN RAISE; END IF;
    RAISE NOTICE '2 ✅ tope por línea: %', left(SQLERRM, 90);
  END;

  -- ── 3. Compra ya pagada → rechaza (J-3) ─────────────────────────────────
  IF v_pagada IS NOT NULL THEN
    BEGIN
      PERFORM public.create_supplier_credit_note(v_tenant, v_pagada, 'NC-PRUEBA-3', current_date, NULL,
        'Pagada', current_date,
        (SELECT jsonb_build_array(jsonb_build_object('expense_line_id', id, 'amount', 1)) FROM public.expense_lines WHERE business_expense_id = v_pagada LIMIT 1),
        v_asiento, NULL);
      RAISE EXCEPTION '3: aceptó una NC sobre una compra pagada';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE '3:%' THEN RAISE; END IF;
      RAISE NOTICE '3 ✅ compra pagada: %', left(SQLERRM, 90);
    END;
  END IF;

  -- ── 4. Asiento que no coincide → rechaza y no escribe ───────────────────
  BEGIN
    PERFORM public.create_supplier_credit_note(v_tenant, v_compra, 'NC-PRUEBA-4', current_date, NULL,
      'Asiento malo', current_date, jsonb_build_array(jsonb_build_object('expense_line_id', l2.id, 'amount', 1)),
      jsonb_build_array(
        jsonb_build_object('account_code','200001','debit',5,'credit',0),
        jsonb_build_object('account_code', l2.chart_account_code,'debit',0,'credit',5)), NULL);
    RAISE EXCEPTION '4: aceptó un asiento que no coincide';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '4:%' THEN RAISE; END IF;
    RAISE NOTICE '4 ✅ asiento verificado: %', left(SQLERRM, 80);
  END;

  -- ── 5. Escritura directa de credited_total → el guard la rechaza ────────
  v_ok := false;
  BEGIN
    UPDATE public.business_expenses SET credited_total = 0 WHERE id = v_compra;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '5: el guard dejó escribir credited_total'; END IF;
  RAISE NOTICE '5 ✅ credited_total no se escribe a mano';

  -- ── 6. Borrar la NC → rechaza ───────────────────────────────────────────
  v_ok := false;
  BEGIN
    DELETE FROM public.supplier_credit_notes WHERE id = v_nc1;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '6: se pudo borrar la NC'; END IF;
  RAISE NOTICE '6 ✅ la NC no se borra';

  -- ── 7. Reversar la parcial: espejo exacto, fecha de hoy, el saldo vuelve ─
  SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit))
    INTO v_espejo
    FROM public.journal_entry_lines l JOIN public.chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = (SELECT id FROM public.journal_entries WHERE source_type='nota_credito_proveedor' AND source_id = v_nc1);
  r := public.reverse_supplier_credit_note(v_tenant, v_nc1, 'Prueba de reversión', current_date, 'Reversión de prueba', v_espejo, NULL);
  SELECT total, credited_total, balance_due, status INTO v_be FROM public.business_expenses WHERE id = v_compra;
  IF v_be.credited_total <> 0 OR v_be.balance_due <> v_be.total THEN
    RAISE EXCEPTION '7: el saldo no volvió: %', row_to_json(v_be);
  END IF;
  RAISE NOTICE '7 ✅ reversada con el asiento % · saldo %', r->>'entry_number', v_be.balance_due;

  -- ── 8. Segunda reversión → rechaza ──────────────────────────────────────
  BEGIN
    PERFORM public.reverse_supplier_credit_note(v_tenant, v_nc1, 'Otra vez', current_date, 'x', v_espejo, NULL);
    RAISE EXCEPTION '8: reversó dos veces';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '8:%' THEN RAISE; END IF;
    RAISE NOTICE '8 ✅ una sola reversión: %', left(SQLERRM, 70);
  END;

  -- ── 9. NC TOTAL de las dos líneas: saldo 0, status pendiente (no "pagado") ─
  v_asiento := jsonb_build_array(
    jsonb_build_object('account_code','200001','debit', (SELECT total FROM public.business_expenses WHERE id=v_compra),'credit',0),
    jsonb_build_object('account_code', l1.chart_account_code,'debit',0,'credit', l1.amount),
    jsonb_build_object('account_code', l2.chart_account_code,'debit',0,'credit', l2.amount));
  IF (l1.tax_amount + l2.tax_amount) > 0 THEN
    v_asiento := v_asiento || jsonb_build_array(jsonb_build_object('account_code','200003','debit',0,'credit', l1.tax_amount + l2.tax_amount));
  END IF;
  r := public.create_supplier_credit_note(v_tenant, v_compra, 'NC-PRUEBA-9', current_date, NULL,
        'Prueba total', current_date,
        jsonb_build_array(jsonb_build_object('expense_line_id', l1.id, 'amount', l1.amount),
                          jsonb_build_object('expense_line_id', l2.id, 'amount', l2.amount)), v_asiento, NULL);
  SELECT total, credited_total, balance_due, status INTO v_be FROM public.business_expenses WHERE id = v_compra;
  IF v_be.balance_due <> 0 OR v_be.status <> 'pendiente_pago' THEN
    RAISE EXCEPTION '9: la NC total no dejó saldo 0 / pendiente: %', row_to_json(v_be);
  END IF;
  RAISE NOTICE '9 ✅ total % · saldo 0 · status %', r->>'credit_note_number', v_be.status;
END $$;

ROLLBACK;

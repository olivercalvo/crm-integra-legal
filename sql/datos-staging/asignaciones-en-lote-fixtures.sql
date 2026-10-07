-- ============================================================================
-- STAGING · datos para probar las asignaciones en lote (07/10/2026)
-- ============================================================================
-- Reproduce lo que hay en producción para los documentos desde el inicio
-- contable: gastos de trámite SIN proveedor y con líneas SIN cuenta (así
-- nacieron con la 036 y la 049) y cobros SIN banco (anteriores a la 041).
-- En septiembre de 2026 (abierto, sin posteo de documentos):
--   · PRUEBA-LOTE-G1: una línea sin cuenta;
--   · PRUEBA-LOTE-G2: dos líneas sin cuenta;
--   · PRUEBA-LOTE-G3: dos líneas, una clasificada y otra no;
--   · PRUEBA-LOTE-G4: una línea sin cuenta;
--   · CO-920001 a CO-920003: cobros sin banco (saldo a favor del cliente).
-- La 037 no deja escribir una cuenta NULL (CHECK expense_lines_cuenta_obligatoria,
-- NOT VALID: deja vivas las viejas, como las 128 de producción). Para crear
-- líneas así, el CHECK se quita y se vuelve a poner IDÉNTICO (NOT VALID)
-- dentro de esta misma transacción: el esquema termina como estaba.
-- Idempotente (por concepto y por número); correrlo otra vez los deja como al
-- principio, salvo los que ya tengan asiento. 🛑 Sólo staging.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_modelo uuid; v_cols text; v_id uuid; v_cli uuid; v_n int := 0;
  r record;
BEGIN
  IF current_database() IS NULL OR EXISTS (SELECT 1 FROM pg_settings WHERE name = 'cluster_name' AND setting ILIKE '%uqmmkklbhzxqybljiecs%') THEN
    RAISE EXCEPTION 'sólo staging';
  END IF;

  SELECT x.id INTO v_modelo FROM expenses x
   WHERE x.tenant_id = T AND NOT x.de_prueba AND x.case_id IS NOT NULL ORDER BY x.created_at DESC LIMIT 1;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND is_generated = 'NEVER';

  ALTER TABLE expense_lines DROP CONSTRAINT expense_lines_cuenta_obligatoria;
  FOR r IN SELECT * FROM (VALUES
      ('PRUEBA-LOTE-G1', DATE '2026-09-02', ARRAY['Certificación registral'], ARRAY[25.00], ARRAY[NULL]::text[]),
      ('PRUEBA-LOTE-G2', DATE '2026-09-04', ARRAY['Timbres fiscales', 'Copias autenticadas'], ARRAY[8.00, 12.50], ARRAY[NULL, NULL]::text[]),
      ('PRUEBA-LOTE-G3', DATE '2026-09-08', ARRAY['Tasa de inscripción', 'Mensajería'], ARRAY[40.00, 6.00], ARRAY['130003', NULL]::text[]),
      ('PRUEBA-LOTE-G4', DATE '2026-09-11', ARRAY['Notaría: autenticación de firmas'], ARRAY[30.00], ARRAY[NULL]::text[])
    ) AS t(concepto, fecha, descs, montos, cuentas)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM expenses WHERE tenant_id = T AND concept = r.concepto);
    v_id := gen_random_uuid();
    EXECUTE format('INSERT INTO expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::expenses, $1)', v_cols, v_cols)
      USING (SELECT to_jsonb(x) FROM expenses x WHERE x.id = v_modelo)
            || jsonb_build_object('id', v_id, 'date', r.fecha, 'accounting_date', r.fecha, 'concept', r.concepto,
                 'amount', (SELECT sum(m) FROM unnest(r.montos) m), 'posted_entry_id', NULL, 'purchase_number', NULL,
                 'supplier_id', NULL, 'supplier_invoice_number', NULL, 'amount_paid', 0, 'status', 'pendiente_pago',
                 'de_prueba', false, 'de_prueba_motivo', NULL);
    FOR i IN 1..array_length(r.descs, 1) LOOP
      INSERT INTO expense_lines (tenant_id, expense_id, line_order, description, chart_account_code, amount, tax_rate, tax_amount)
      VALUES (T, v_id, i, r.descs[i], r.cuentas[i], r.montos[i], 0, 0);
    END LOOP;
    v_n := v_n + 1;
  END LOOP;
  -- Correrlo otra vez deja los de prueba como al principio (si no tienen asiento).
  UPDATE expenses SET supplier_id = NULL
   WHERE tenant_id = T AND concept LIKE 'PRUEBA-LOTE-G_' AND posted_entry_id IS NULL;
  UPDATE expense_lines l SET chart_account_code = NULL
    FROM expenses x
   WHERE l.expense_id = x.id AND x.tenant_id = T AND x.concept LIKE 'PRUEBA-LOTE-G_' AND x.posted_entry_id IS NULL
     AND NOT (x.concept = 'PRUEBA-LOTE-G3' AND l.line_order = 1);
  ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_cuenta_obligatoria CHECK (chart_account_code IS NOT NULL) NOT VALID;
  RAISE NOTICE 'gastos de trámite sin proveedor creados: %', v_n;

  SELECT client_id INTO v_cli FROM invoices WHERE tenant_id = T AND NOT de_prueba AND status IN ('emitida','pagada') ORDER BY created_at LIMIT 1;
  v_n := 0;
  FOR r IN SELECT * FROM (VALUES ('CO-920001', DATE '2026-09-03', 50.00), ('CO-920002', DATE '2026-09-10', 75.25),
                                 ('CO-920003', DATE '2026-09-15', 120.00)) AS t(num, fecha, monto)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM payments WHERE tenant_id = T AND payment_number = r.num);
    INSERT INTO payments (tenant_id, payment_number, client_id, payment_date, amount, amount_unapplied, method,
                          reference, status, payment_account_code, notes)
    VALUES (T, r.num, v_cli, r.fecha, r.monto, r.monto, 'transferencia', 'PRUEBA-LOTE-' || r.num, 'registrado', NULL,
            'Prueba de la asignación de banco en lote (07/10)');
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'cobros sin banco creados: %', v_n;
  UPDATE payments p SET payment_account_code = NULL
   WHERE p.tenant_id = T AND p.payment_number IN ('CO-920001', 'CO-920002', 'CO-920003')
     AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = T AND j.source_type = 'pago' AND j.source_id = p.id);
END $$;

COMMIT;

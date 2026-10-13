-- ============================================================================
-- SÓLO STAGING · datos para probar el posteo de documentos existentes (097)
-- ============================================================================
--   node scripts/run-sql.mjs sql/datos-staging/posteo-retroactivo-fixtures.sql
--
-- Documentos de JULIO y AGOSTO de 2026 SIN asiento, como los de producción
-- (emitidos antes del deploy del posteo automático). Se crean por SQL porque la
-- app ya les pondría asiento al crearlos. Copian la forma de documentos que ya
-- existen en staging (FAC-HON-000031, NC-000027, la última compra, el último
-- gasto con líneas) para que los cargadores de la app los lean igual.
--
--   julio   FAC-HON-910001 (10/07)  · factura con cobro y NC parcial
--           FAC-HON-910002 (12/07)  · factura que se anula el 05/08
--           FAC-HON-000496 (15/07)  · la excluida «sin DGI», con un cobro (también excluido)
--           FAC-CO-910001  (05/07)  · compra, y su pago PA-910001 (25/07)
--           gasto de trámite (18/07), sin N.º FAC-CO- (se asigna al contabilizar)
--           CO-910001 (20/07) a FAC-HON-910001 · CO-910002 (21/07) a FAC-HON-000496
--   agosto  FAC-HON-910003 (03/08), NC-910001 (05/08, la anulación de 910002),
--           NC-910002 (10/08, parcial de 910001), CO-910003 (20/08) a 910003
--
-- Además asigna el proveedor PRV-002 a los gastos de julio que no lo tienen y
-- clasifica en 130003 sus líneas sin cuenta: son las dos correcciones que pide
-- la herramienta en la hoja «Con problemas».
--
-- Idempotente: si FAC-HON-910001 ya existe, no hace nada.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.fac(p_num text, p_fecha date, p_modelo uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_cols text; v_lcols text; v_id uuid := gen_random_uuid();
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';
  EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1)', v_cols, v_cols)
    USING (SELECT to_jsonb(i) FROM invoices i WHERE i.id = p_modelo)
          || jsonb_build_object('id', v_id, 'invoice_number', 'DRAFT-' || p_num, 'status', 'borrador',
               'issue_date', p_fecha, 'accounting_date', p_fecha, 'due_date', p_fecha + 30,
               'dgi_cufe', NULL, 'dgi_cufe_origen', NULL, 'fe_estado', 'no_emitida', 'amount_paid', 0,
               'credited_total', 0, 'de_prueba', false, 'de_prueba_motivo', NULL,
               'notes', 'Prueba del posteo de documentos existentes (097)');
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_lcols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoice_lines'
     AND is_generated = 'NEVER' AND column_name NOT IN ('id', 'invoice_id');
  EXECUTE format('INSERT INTO invoice_lines (invoice_id, %s) SELECT $1, %s FROM invoice_lines WHERE invoice_id = $2', v_lcols, v_lcols)
    USING v_id, p_modelo;
  UPDATE invoices SET status = 'emitida', invoice_number = p_num WHERE id = v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.nc(p_num text, p_fecha date, p_factura uuid, p_precio numeric) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_cols text; v_lcols text; v_id uuid := gen_random_uuid(); v_modelo uuid;
BEGIN
  SELECT id INTO v_modelo FROM credit_notes WHERE credit_note_number = 'NC-000027';
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_notes' AND is_generated = 'NEVER';
  EXECUTE format('INSERT INTO credit_notes (%s) SELECT %s FROM jsonb_populate_record(NULL::credit_notes, $1)', v_cols, v_cols)
    USING (SELECT to_jsonb(n) FROM credit_notes n WHERE n.id = v_modelo)
          || jsonb_build_object('id', v_id, 'credit_note_number', p_num, 'invoice_id', p_factura,
               'client_id', (SELECT client_id FROM invoices WHERE id = p_factura),
               'issue_date', p_fecha, 'accounting_date', p_fecha, 'status', 'emitida', 'fe_estado', 'no_emitida',
               'dgi_cufe', NULL, 'de_prueba', false, 'de_prueba_motivo', NULL,
               'subtotal_total', 0, 'tax_total', 0, 'grand_total', 0,
               'reason', 'Prueba del posteo de documentos existentes (097)');
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_lcols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_note_lines'
     AND is_generated = 'NEVER' AND column_name NOT IN ('id', 'credit_note_id', 'invoice_line_id', 'unit_price');
  EXECUTE format('INSERT INTO credit_note_lines (credit_note_id, invoice_line_id, unit_price, %s)
                  SELECT $1, (SELECT id FROM invoice_lines WHERE invoice_id = $2 ORDER BY line_order LIMIT 1), $3, %s
                    FROM credit_note_lines WHERE credit_note_id = $4', v_lcols, v_lcols)
    USING v_id, p_factura, p_precio, v_modelo;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.cobro(p_num text, p_fecha date, p_factura uuid, p_monto numeric) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO payments (tenant_id, payment_number, client_id, payment_date, amount, amount_unapplied, method,
                        reference, status, payment_account_code, notes)
  SELECT tenant_id, p_num, client_id, p_fecha, p_monto, 0, 'transferencia', 'PRUEBA-RETRO-' || p_num, 'registrado',
         '100001', 'Prueba del posteo de documentos existentes (097)'
    FROM invoices WHERE id = p_factura
  RETURNING id INTO v_id;
  INSERT INTO payment_applications (tenant_id, payment_id, invoice_id, amount_applied)
  SELECT tenant_id, v_id, p_factura, p_monto FROM invoices WHERE id = p_factura;
  RETURN v_id;
END $$;

DO $$
DECLARE
  T        constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_modelo uuid;
  v_a uuid; v_b uuid; v_c uuid; v_496 uuid;
  v_cols text; v_lcols text;
  v_compra uuid := gen_random_uuid(); v_compra_modelo uuid;
  v_gasto uuid := gen_random_uuid(); v_gasto_modelo uuid;
  v_prov uuid;
  v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE tenant_id = T AND invoice_number = 'FAC-HON-910001') THEN
    RAISE NOTICE 'posteo-retroactivo-fixtures: ya estaban; no se hizo nada.';
    RETURN;
  END IF;
  SELECT id INTO v_modelo FROM invoices WHERE tenant_id = T AND invoice_number = 'FAC-HON-000031';
  SELECT id INTO v_prov FROM suppliers WHERE tenant_id = T AND supplier_number = 'PRV-002';

  -- Julio
  v_a   := pg_temp.fac('FAC-HON-910001', DATE '2026-07-10', v_modelo);
  v_b   := pg_temp.fac('FAC-HON-910002', DATE '2026-07-12', v_modelo);
  v_496 := pg_temp.fac('FAC-HON-000496', DATE '2026-07-15', v_modelo);
  PERFORM pg_temp.cobro('CO-910001', DATE '2026-07-20', v_a, 5);
  PERFORM pg_temp.cobro('CO-910002', DATE '2026-07-21', v_496, 3);

  -- La compra y su pago
  SELECT id INTO v_compra_modelo FROM business_expenses WHERE tenant_id = T AND purchase_number = 'FAC-CO-000008';
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_expenses' AND is_generated = 'NEVER';
  EXECUTE format('INSERT INTO business_expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::business_expenses, $1)', v_cols, v_cols)
    USING (SELECT to_jsonb(b) FROM business_expenses b WHERE b.id = v_compra_modelo)
          || jsonb_build_object('id', v_compra, 'purchase_number', 'FAC-CO-910001', 'expense_date', DATE '2026-07-05',
               'accounting_date', DATE '2026-07-05', 'due_date', DATE '2026-08-05', 'status', 'pendiente_pago',
               'amount_paid', 0, 'payment_date', NULL, 'credited_total', 0, 'supplier_id', v_prov,
               'description', 'Prueba retroactivo: compra (05/07)');
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_lcols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expense_lines'
     AND is_generated = 'NEVER' AND column_name NOT IN ('id', 'business_expense_id', 'expense_id');
  EXECUTE format('INSERT INTO expense_lines (business_expense_id, %s) SELECT $1, %s FROM expense_lines WHERE business_expense_id = $2', v_lcols, v_lcols)
    USING v_compra, v_compra_modelo;
  INSERT INTO supplier_payments (tenant_id, business_expense_id, kind, payment_number, payment_date, amount, method,
                                 payment_account_code, reference, status, notes)
  VALUES (T, v_compra, 'payment', 'PA-910001', DATE '2026-07-25',
          (SELECT least(10, total) FROM business_expenses WHERE id = v_compra), 'transferencia', '100001',
          'PRUEBA-RETRO-PA', 'registrado', 'Prueba del posteo de documentos existentes (097)');

  -- El gasto de trámite (con proveedor y líneas clasificadas)
  SELECT x.id INTO v_gasto_modelo FROM expenses x
   WHERE x.tenant_id = T AND NOT x.de_prueba AND x.supplier_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM expense_lines l WHERE l.expense_id = x.id)
     AND NOT EXISTS (SELECT 1 FROM expense_lines l WHERE l.expense_id = x.id AND l.chart_account_code IS NULL)
   ORDER BY x.created_at DESC LIMIT 1;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND is_generated = 'NEVER';
  EXECUTE format('INSERT INTO expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::expenses, $1)', v_cols, v_cols)
    USING (SELECT to_jsonb(x) FROM expenses x WHERE x.id = v_gasto_modelo)
          || jsonb_build_object('id', v_gasto, 'date', DATE '2026-07-18', 'accounting_date', DATE '2026-07-18',
               'posted_entry_id', NULL, 'purchase_number', NULL, 'amount_paid', 0, 'status', 'pendiente_pago',
               'concept', 'Prueba retroactivo: gasto de trámite (18/07)', 'supplier_invoice_number', NULL);
  EXECUTE format('INSERT INTO expense_lines (expense_id, %s) SELECT $1, %s FROM expense_lines WHERE expense_id = $2', v_lcols, v_lcols)
    USING v_gasto, v_gasto_modelo;

  -- La corrección que pide la herramienta: proveedor a los gastos de julio sin él.
  UPDATE expenses SET supplier_id = v_prov
   WHERE tenant_id = T AND supplier_id IS NULL AND NOT de_prueba AND posted_entry_id IS NULL
     AND date BETWEEN DATE '2026-07-01' AND DATE '2026-07-31';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Agosto
  v_c := pg_temp.fac('FAC-HON-910003', DATE '2026-08-03', v_modelo);
  PERFORM pg_temp.nc('NC-910001', DATE '2026-08-05', v_b, 10);  -- la NC total de la anulación
  UPDATE invoices SET status = 'anulada', cancellation_reason = 'Prueba del posteo retroactivo: anulada el 05/08',
                      cancelled_at = TIMESTAMPTZ '2026-08-05 10:00:00-05'
   WHERE id = v_b;
  PERFORM pg_temp.nc('NC-910002', DATE '2026-08-10', v_a, 2);   -- NC parcial
  PERFORM pg_temp.cobro('CO-910003', DATE '2026-08-20', v_c, 4);

  RAISE NOTICE 'posteo-retroactivo-fixtures: creados julio y agosto; % gasto(s) de julio recibieron proveedor', v_n;
END $$;

-- La otra corrección que pide la herramienta para esos gastos de julio: la
-- cuenta de la línea. 130003 es la de los gastos de trámite (fondo del cliente).
-- Fuera del bloque de arriba para que corra aunque los documentos ya existan.
DO $$
DECLARE v_n int;
BEGIN
  UPDATE expense_lines l SET chart_account_code = '130003'
    FROM expenses x
   WHERE l.expense_id = x.id AND l.chart_account_code IS NULL
     AND x.tenant_id = 'a0000000-0000-0000-0000-000000000001' AND NOT x.de_prueba AND x.posted_entry_id IS NULL
     AND x.date BETWEEN DATE '2026-07-01' AND DATE '2026-07-31';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'posteo-retroactivo-fixtures: % línea(s) de gastos de julio clasificadas en 130003', v_n;
END $$;

COMMIT;

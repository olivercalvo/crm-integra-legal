-- ============================================================================
-- ENSAYO DE LA VENTANA · «primer uso»: lo mínimo que existe en producción
-- después del primer día de trabajo con el código nuevo
-- ============================================================================
-- Recién terminada la ventana, producción tiene el libro VACÍO, cero
-- proveedores, cero compras y ningún cobro con banco (relevamiento del 22/09).
-- Con eso, siete verificaciones de la ventana dicen «nada que verificar» y la
-- prueba de las 41 tablas y la de concurrencia no arrancan (piden un proveedor,
-- un asiento y un banco). Este archivo crea, SÓLO EN LA BASE LOCAL DEL ENSAYO,
-- lo que el bufete crea el primer día: un proveedor, una compra de dos líneas
-- con su asiento, el asiento de tres facturas ya emitidas y el banco de un cobro.
--
-- Todo pasa por el motor (`post_journal_entry`), con la cadena y el hash v5
-- como los calcula la base. Nunca se corre en producción.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T        constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_admin  uuid;
  v_prov   uuid;
  v_be     uuid;
  v_tasa   record;
  f        record;
  v_lineas jsonb;
BEGIN
  IF current_database() NOT IN ('ventana', 'prod_024') THEN
    RAISE EXCEPTION 'datos-primer-uso.sql sólo corre en la base local del ensayo (base actual: %).', current_database();
  END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT id INTO v_admin FROM users WHERE tenant_id = T AND role = 'admin' AND active ORDER BY created_at LIMIT 1;
  SELECT id, code, rate, coalesce(account_code, '200003') AS cuenta INTO v_tasa FROM tax_codes WHERE tenant_id = T AND code = 'ITBMS_7';

  -- Un proveedor.
  INSERT INTO suppliers (tenant_id, supplier_number, legal_name, ruc, dv, payment_terms_days)
  VALUES (T, 'PROV-ENSAYO-1', 'PROVEEDOR DE ENSAYO, S.A.', '155000009-2-2026', '00', 30)
  RETURNING id INTO v_prov;

  -- Una compra pendiente de dos líneas, con su asiento (gasto → 200001 con el proveedor).
  INSERT INTO business_expenses (tenant_id, supplier_id, expense_date, accounting_date, description, subtotal, tax_rate, tax_amount, status, created_by)
  VALUES (T, v_prov, current_date, current_date, 'Compra de ensayo (primer uso)', 300, 0.07, 21, 'pendiente_pago', v_admin)
  RETURNING id INTO v_be;
  INSERT INTO expense_lines (tenant_id, business_expense_id, line_order, description, amount, chart_account_code, tax_code_id, tax_rate, tax_amount)
  VALUES (T, v_be, 1, 'Traducción oficial', 200, '500001', v_tasa.id, v_tasa.rate, 14),
         (T, v_be, 2, 'Notaría',             100, '500002', v_tasa.id, v_tasa.rate, 7);
  PERFORM post_journal_entry(T, current_date, 'Compra de ensayo (primer uso)', 'gasto',
    jsonb_build_array(
      jsonb_build_object('account_code', '500001', 'debit', 200, 'credit', 0, 'description', 'Traducción oficial'),
      jsonb_build_object('account_code', '500002', 'debit', 100, 'credit', 0, 'description', 'Notaría'),
      jsonb_build_object('account_code', v_tasa.cuenta, 'debit', 21, 'credit', 0, 'description', 'ITBMS'),
      jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 321, 'description', 'Cuentas por pagar', 'supplier_id', v_prov)),
    v_be, NULL, NULL, NULL, v_admin, NULL, NULL, 'gasto:' || v_be::text, NULL);

  -- El asiento de las tres primeras facturas emitidas con saldo (100004 con el cliente).
  FOR f IN
    SELECT i.* FROM invoices i
     WHERE i.tenant_id = T AND i.status IN ('emitida', 'parcialmente_pagada') AND i.balance_due >= 5
       AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_type = 'factura' AND j.source_id = i.id)
     ORDER BY i.created_at LIMIT 3
  LOOP
    v_lineas := jsonb_build_array(
      jsonb_build_object('account_code', '100004', 'debit', f.grand_total, 'credit', 0,
                         'description', 'Factura ' || f.invoice_number, 'client_id', f.client_id),
      jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', f.subtotal_total, 'description', 'Honorarios'));
    IF f.tax_total > 0 THEN
      v_lineas := v_lineas || jsonb_build_array(
        jsonb_build_object('account_code', v_tasa.cuenta, 'debit', 0, 'credit', f.tax_total, 'description', 'ITBMS'));
    END IF;
    PERFORM post_journal_entry(T, f.accounting_date, 'Factura ' || f.invoice_number || ' (ensayo)', 'factura',
      v_lineas, f.id, NULL, NULL, NULL, v_admin, NULL, f.invoice_number, 'factura:' || f.id::text, NULL);
  END LOOP;

  -- El banco de un cobro (la 041 agrega la columna sin backfill).
  UPDATE payments SET payment_account_code = '100001'
   WHERE id = (SELECT id FROM payments WHERE tenant_id = T ORDER BY created_at LIMIT 1);

  RAISE NOTICE 'primer uso: proveedor %, compra %, % asientos en el libro, % cobro(s) con banco',
    v_prov, v_be, (SELECT count(*) FROM journal_entries WHERE tenant_id = T),
    (SELECT count(*) FROM payments WHERE tenant_id = T AND payment_account_code IS NOT NULL);
END $$;

COMMIT;

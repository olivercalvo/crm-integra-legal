-- ============================================================================
-- VERIFICACIÓN de la 051 — nota de crédito contable: columnas fiscales,
-- credited_total derivada con guard, T7a con total neto, balance_due.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja NC, pagos ni asientos.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-051-nota-de-credito.sql
--
-- Presupone la 051. Usa una factura `emitida` sin pagos ni NC del tenant de
-- staging. Esta migración NO postea nada (el asiento de la NC y la reversión
-- llegan con la 052, que trae su falla forzada); acá se prueban los derivados.
-- Nueve comprobaciones.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user    uuid;
  v_inv     uuid;
  v_grand   numeric;
  v_client  uuid;
  v_ok      int := 0;
  v_fail    int := 0;
  v_n       int;
  v_st      text;
  v_cred    numeric;
  v_bal     numeric;
  v_paid    numeric;
  v_nc      uuid;
  v_nc2     uuid;
  v_pago    uuid;
  v_fe      text;
  v_parte   numeric;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT i.id, i.grand_total, i.client_id INTO v_inv, v_grand, v_client FROM invoices i
   WHERE i.tenant_id = v_tenant AND i.status = 'emitida' AND i.amount_paid = 0
     AND NOT EXISTS (SELECT 1 FROM credit_notes c WHERE c.invoice_id = i.id)
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_inv IS NULL THEN
    RAISE NOTICE '⚠️ No hay facturas emitidas sin pagos en staging: nada que verificar.';
    RETURN;
  END IF;
  v_parte := round(v_grand / 4, 2);
  RAISE NOTICE 'Factura % · total % · NC parcial de %', v_inv, v_grand, v_parte;

  -- [1] Las 13 columnas fiscales existen y fe_estado nace 'no_emitida'.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'credit_notes'
     AND column_name IN ('fe_estado','i_amb','punto_facturacion','numero_documento','dgi_numero_documento','dgi_cufe',
                         'dgi_fecha_autorizacion','dgi_protocolo_autorizacion','dgi_cafe_url','cafe_storage_key',
                         'xml_storage_key','qr_content','ef_invoice_uuid');
  INSERT INTO credit_notes (tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason, status, currency, subtotal_total, tax_total, grand_total, created_by)
  VALUES (v_tenant, 'NC-999901', v_inv, v_client, current_date, 'verificación 051', 'emitida', 'USD', v_parte, 0, v_parte, v_user)
  RETURNING id, fe_estado INTO v_nc, v_fe;
  IF v_n = 13 AND v_fe = 'no_emitida' THEN
    RAISE NOTICE '[1] columnas fiscales ......................... ✅ 13, fe_estado nace no_emitida';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] columnas fiscales ......................... ❌ % columnas, fe_estado %', v_n, v_fe;
    v_fail := v_fail + 1;
  END IF;

  -- [2] NC parcial de 200 → credited_total 200, balance_due = total − 200, status sigue emitida.
  SELECT status, credited_total, balance_due INTO v_st, v_cred, v_bal FROM invoices WHERE id = v_inv;
  IF v_cred = v_parte AND v_bal = v_grand - v_parte AND v_st = 'emitida' THEN
    RAISE NOTICE '[2] NC parcial ................................ ✅ credited % · saldo % · emitida', v_cred, v_bal;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[2] NC parcial ................................ ❌ credited % · saldo % · %', v_cred, v_bal, v_st;
    v_fail := v_fail + 1;
  END IF;

  -- [3] credited_total a mano → rechazado por el guard.
  BEGIN
    UPDATE invoices SET credited_total = 1 WHERE id = v_inv;
    RAISE NOTICE '[3] credited_total a mano ..................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[3] credited_total a mano ..................... ✅ RECHAZADO por el guard';
    v_ok := v_ok + 1;
  END;

  -- [4] 🔒 D3: acreditada al 100% con pagos 0 → emitida, saldo 0, NO pagada.
  --     Una NC no se borra (trg_no_delete_protected), así que el sub-bloque se
  --     deshace por excepción.
  BEGIN
    INSERT INTO credit_notes (tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason, status, currency, subtotal_total, tax_total, grand_total, created_by)
    VALUES (v_tenant, 'NC-999902', v_inv, v_client, current_date, 'verificación 051 resto', 'emitida', 'USD', v_grand - v_parte, 0, v_grand - v_parte, v_user)
    RETURNING id INTO v_nc2;
    SELECT status, credited_total, balance_due INTO v_st, v_cred, v_bal FROM invoices WHERE id = v_inv;
    IF v_st = 'emitida' AND v_cred = v_grand AND v_bal = 0 THEN
      RAISE NOTICE '[4] acreditada al 100%% (D3) .................. ✅ emitida · credited = total · saldo 0 · NO pagada';
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[4] acreditada al 100%% (D3) .................. ❌ % · credited % · saldo %', v_st, v_cred, v_bal;
      v_fail := v_fail + 1;
    END IF;
    RAISE EXCEPTION 'deshacer [4]' USING ERRCODE = 'P0999';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;
  SELECT credited_total INTO v_cred FROM invoices WHERE id = v_inv;
  IF v_cred <> v_parte THEN
    RAISE NOTICE '    (el sub-bloque [4] no se deshizo: credited %)', v_cred;
  END IF;

  -- [5] Con NC parcial, un pago por el resto (total − parte) → pagada (T7a contra el neto).
  INSERT INTO payments (tenant_id, client_id, payment_number, payment_date, amount, method, payment_account_code, status, created_by)
  VALUES (v_tenant, v_client, 'REC-999901', current_date, v_grand - v_parte, 'transferencia', '100001', 'registrado', v_user)
  RETURNING id INTO v_pago;
  INSERT INTO payment_applications (tenant_id, payment_id, invoice_id, amount_applied)
  VALUES (v_tenant, v_pago, v_inv, v_grand - v_parte);
  SELECT status, amount_paid, balance_due INTO v_st, v_paid, v_bal FROM invoices WHERE id = v_inv;
  IF v_st = 'pagada' AND v_paid = v_grand - v_parte AND v_bal = 0 THEN
    RAISE NOTICE '[5] pago por el neto .......................... ✅ pagada · pagado % · saldo 0', v_paid;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] pago por el neto .......................... ❌ % · pagado % · saldo %', v_st, v_paid, v_bal;
    v_fail := v_fail + 1;
  END IF;

  -- [6] Se quita el pago → vuelve a emitida con el crédito intacto y el saldo = total − parte.
  DELETE FROM payment_applications WHERE payment_id = v_pago;
  DELETE FROM payments WHERE id = v_pago;
  SELECT status, credited_total, balance_due INTO v_st, v_cred, v_bal FROM invoices WHERE id = v_inv;
  IF v_st = 'emitida' AND v_cred = v_parte AND v_bal = v_grand - v_parte THEN
    RAISE NOTICE '[6] sin el pago ............................... ✅ emitida · credited % · saldo %', v_cred, v_bal;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[6] sin el pago ............................... ❌ % · credited % · saldo %', v_st, v_cred, v_bal;
    v_fail := v_fail + 1;
  END IF;

  -- [7] balance_due es la expresión nueva en toda la tabla.
  SELECT count(*) INTO v_n FROM invoices WHERE balance_due <> grand_total - amount_paid - credited_total;
  IF v_n = 0 THEN
    RAISE NOTICE '[7] balance_due ............................... ✅ = grand_total − amount_paid − credited_total en todas';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[7] balance_due ............................... ❌ % facturas inconsistentes', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [8] Una factura no puede nacer con crédito.
  BEGIN
    INSERT INTO invoices (tenant_id, invoice_kind, client_id, issue_date, due_date, status, currency, credited_total)
    VALUES (v_tenant, 'HONORARIOS', v_client, current_date, current_date, 'borrador', 'USD', 5);
    RAISE NOTICE '[8] factura nace con crédito .................. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[8] factura nace con crédito .................. ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  -- [9] fe_estado fuera del catálogo → rechazado.
  BEGIN
    INSERT INTO credit_notes (tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason, status, currency, subtotal_total, tax_total, grand_total, fe_estado)
    VALUES (v_tenant, 'NC-999903', v_inv, v_client, current_date, 'x', 'emitida', 'USD', 1, 0, 1, 'autorizadisima');
    RAISE NOTICE '[9] fe_estado inválido ........................ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[9] fe_estado inválido ........................ ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '════════ 051: % ✅ · % ❌ ════════', v_ok, v_fail;
END $$;

ROLLBACK;

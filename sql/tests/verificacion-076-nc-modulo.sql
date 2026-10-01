-- ============================================================================
-- VERIFICACIÓN de la 076 — notas de crédito como módulo propio (E8).
-- 🛡️ TODO DENTRO DE UN ROLLBACK: la NC de prueba, su asiento, la aplicación y
--    la reversión se deshacen al final. El correlativo NC-CO- también.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-076-nc-modulo.sql
--
--   [1] NC de compra SIN compra: se registra con su asiento y el proveedor en 200001
--   [2] un asiento que no coincide con las líneas se rechaza
--   [3] aplicar su saldo a una compra del proveedor baja el balance_due (sin asiento)
--   [4] no se aplica más que el saldo de la NC
--   [5] reversar la NC devuelve el saldo de la compra (la aplicación deja de contar)
--   [6] apply_credit_note rechaza una NC que nació con factura
--   [7] una aplicación no se borra
--   [8] los RPC y las aplicaciones no son de la sesión del usuario
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user    uuid;
  v_prov    uuid;
  v_cuenta  text;
  v_tasa    uuid;
  v_tcuenta text;
  v_hoy     date := (now() AT TIME ZONE 'America/Panama')::date;
  v_r       jsonb;
  v_nc      uuid;
  v_compra  uuid;
  v_saldo0  numeric(12,2);
  v_saldo1  numeric(12,2);
  v_nc_fac  uuid;
  v_orig    uuid;
  v_espejo  jsonb;
  v_n       int;
  v_ok      int := 0;
  v_fail    int := 0;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT code INTO v_cuenta FROM chart_of_accounts
   WHERE tenant_id = v_tenant AND active AND account_type = 'expense' AND cuenta_control IS NULL
   ORDER BY code LIMIT 1;
  SELECT id, account_code INTO v_tasa, v_tcuenta FROM tax_codes
   WHERE tenant_id = v_tenant AND code = 'ITBMS_7' LIMIT 1;

  -- Un proveedor con una compra abierta EN EL LIBRO, para poder aplicar.
  SELECT be.supplier_id, be.id, be.balance_due INTO v_prov, v_compra, v_saldo0
    FROM business_expenses be
   WHERE be.tenant_id = v_tenant AND be.supplier_id IS NOT NULL AND be.balance_due > 20
     AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_type = 'gasto' AND j.source_id = be.id)
   ORDER BY be.expense_date LIMIT 1;
  IF v_prov IS NULL THEN
    SELECT id INTO v_prov FROM suppliers WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  END IF;

  -- [1]
  v_r := create_supplier_credit_note(
    v_tenant, NULL, v_prov, 'VERIF-076', v_hoy, NULL, 'Verificación 076: NC sin compra', v_hoy,
    jsonb_build_array(jsonb_build_object(
      'expense_line_id', NULL, 'chart_account_code', v_cuenta, 'description', 'Descuento de prueba',
      'amount', 10, 'tax_code_id', v_tasa, 'tax_amount', 0.70)),
    jsonb_build_array(
      jsonb_build_object('account_code', '200001', 'debit', 10.70, 'credit', 0, 'supplier_id', v_prov),
      jsonb_build_object('account_code', v_cuenta, 'debit', 0, 'credit', 10),
      jsonb_build_object('account_code', coalesce(v_tcuenta, '200003'), 'debit', 0, 'credit', 0.70)),
    v_user);
  v_nc := (v_r->>'id')::uuid;
  IF v_nc IS NOT NULL
     AND (SELECT business_expense_id FROM supplier_credit_notes WHERE id = v_nc) IS NULL
     AND EXISTS (SELECT 1 FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id = j.id
                  JOIN chart_of_accounts c ON c.id = l.account_id
                 WHERE j.source_type = 'nota_credito_proveedor' AND j.source_id = v_nc
                   AND c.code = '200001' AND l.supplier_id = v_prov AND l.debit = 10.70) THEN
    RAISE NOTICE '[1] NC sin compra, con asiento y proveedor ........ ✅ %', v_r->>'credit_note_number'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] NC sin compra ............................... ❌ %', v_r; v_fail := v_fail + 1;
  END IF;

  -- [2]
  BEGIN
    PERFORM create_supplier_credit_note(
      v_tenant, NULL, v_prov, 'VERIF-076-B', v_hoy, NULL, 'Asiento que no coincide', v_hoy,
      jsonb_build_array(jsonb_build_object('chart_account_code', v_cuenta, 'description', 'Descuento',
        'amount', 10, 'tax_code_id', NULL, 'tax_amount', 0)),
      jsonb_build_array(
        jsonb_build_object('account_code', '200001', 'debit', 11, 'credit', 0, 'supplier_id', v_prov),
        jsonb_build_object('account_code', v_cuenta, 'debit', 0, 'credit', 11)),
      v_user);
    RAISE NOTICE '[2] asiento que no coincide ...................... ❌ se aceptó'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[2] asiento que no coincide: rechazado ........... ✅'; v_ok := v_ok + 1;
  END;

  -- [3] y [4]
  IF v_compra IS NOT NULL THEN
    PERFORM apply_supplier_credit_note(v_tenant, v_nc, v_compra, 5, v_user);
    SELECT balance_due INTO v_saldo1 FROM business_expenses WHERE id = v_compra;
    IF v_saldo1 = v_saldo0 - 5 THEN
      RAISE NOTICE '[3] aplicar baja el saldo de la compra (% → %) .. ✅', v_saldo0, v_saldo1; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[3] aplicar ..................................... ❌ % → %', v_saldo0, v_saldo1; v_fail := v_fail + 1;
    END IF;
    BEGIN
      PERFORM apply_supplier_credit_note(v_tenant, v_nc, v_compra, 6, v_user);
      RAISE NOTICE '[4] aplicar más que el saldo .................... ❌ se aceptó'; v_fail := v_fail + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[4] no se aplica más que el saldo de la NC ....... ✅'; v_ok := v_ok + 1;
    END;
  ELSE
    RAISE NOTICE '[3][4] sin compra abierta en el libro para probar: se omiten';
  END IF;

  -- [5] Reversar: el espejo exacto del asiento de la NC.
  SELECT id INTO v_orig FROM journal_entries WHERE source_type = 'nota_credito_proveedor' AND source_id = v_nc;
  SELECT jsonb_agg(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
                                      'client_id', l.client_id, 'supplier_id', l.supplier_id))
    INTO v_espejo
    FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_orig;
  PERFORM reverse_supplier_credit_note(v_tenant, v_nc, 'Verificación 076: reversa', v_hoy,
    'Reversión de prueba', v_espejo, v_user);
  IF v_compra IS NULL OR (SELECT balance_due FROM business_expenses WHERE id = v_compra) = v_saldo0 THEN
    RAISE NOTICE '[5] reversar devuelve el saldo de la compra ...... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] reversar ..................................... ❌'; v_fail := v_fail + 1;
  END IF;

  -- [6]
  SELECT id INTO v_nc_fac FROM credit_notes WHERE tenant_id = v_tenant AND invoice_id IS NOT NULL AND status = 'emitida' LIMIT 1;
  IF v_nc_fac IS NOT NULL THEN
    BEGIN
      PERFORM apply_credit_note(v_tenant, v_nc_fac, (SELECT invoice_id FROM credit_notes WHERE id = v_nc_fac), 1, v_user);
      RAISE NOTICE '[6] NC con factura aplicada otra vez ............ ❌'; v_fail := v_fail + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[6] una NC con factura no tiene saldo que aplicar  ✅'; v_ok := v_ok + 1;
    END;
  ELSE
    RAISE NOTICE '[6] sin NC con factura para probar: se omite';
  END IF;

  -- [7]
  v_n := 0;
  BEGIN
    DELETE FROM supplier_credit_note_applications WHERE credit_note_id = v_nc;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_n := -1;
  END;
  IF v_n = -1 OR v_compra IS NULL THEN
    RAISE NOTICE '[7] una aplicación no se borra ................... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[7] una aplicación no se borra ................... ❌ borró %', v_n; v_fail := v_fail + 1;
  END IF;

  -- [8]
  IF NOT has_function_privilege('authenticated', 'public.apply_credit_note(uuid,uuid,uuid,numeric,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.apply_supplier_credit_note(uuid,uuid,uuid,numeric,uuid)', 'EXECUTE')
     AND NOT has_table_privilege('authenticated', 'public.credit_note_applications', 'INSERT') THEN
    RAISE NOTICE '[8] RPC y aplicaciones fuera de la sesión ......... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[8] RPC y aplicaciones ........................... ❌'; v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 076: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

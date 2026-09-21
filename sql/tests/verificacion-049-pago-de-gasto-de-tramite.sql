-- ============================================================================
-- VERIFICACIÓN de la 049 — pago de un gasto de trámite: arco exclusivo, derivados
-- en `expenses`, guard, RPC ramificado y la 038 reabierta para supplier_id.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja pagos, asientos ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-049-pago-de-gasto-de-tramite.sql
--
-- Presupone la 049 aplicada. Usa un gasto de trámite del tenant de staging
-- (el más nuevo con amount > 0 y sin pagos), una compra pendiente (regresión del
-- lado compra) y el banco 100001. Trece comprobaciones.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant    uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user      uuid;
  v_gasto     uuid;
  v_total     numeric;
  v_compra    uuid;
  v_asentado  uuid;
  v_ok        int := 0;
  v_fail      int := 0;
  v_n         int;
  v_st        text;
  v_paid      numeric;
  v_pago1     uuid;
  v_pago2     uuid;
  v_pagoc     uuid;
  v_err       text;
  v_entry     uuid;
  v_entry_nro bigint;
  v_lines     jsonb;
  v_res       jsonb;
  v_seq_antes bigint;
  v_seq_desp  bigint;
  v_prov      uuid;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT e.id, e.amount INTO v_gasto, v_total FROM expenses e
   WHERE e.tenant_id = v_tenant AND e.amount > 0 AND e.status = 'pendiente_pago'
     AND NOT EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.expense_id = e.id)
   ORDER BY e.created_at DESC LIMIT 1;
  SELECT id INTO v_compra FROM business_expenses
   WHERE tenant_id = v_tenant AND status = 'pendiente_pago' AND total > 0
   ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_asentado FROM expenses WHERE tenant_id = v_tenant AND posted_entry_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_prov FROM suppliers WHERE tenant_id = v_tenant LIMIT 1;
  IF v_gasto IS NULL THEN
    RAISE NOTICE '⚠️ No hay gastos de trámite pendientes en staging: nada que verificar.';
    RETURN;
  END IF;
  RAISE NOTICE 'Gasto de trámite % · monto % · compra % · gasto asentado %', v_gasto, v_total, v_compra, v_asentado;

  -- [1] Arco exclusivo: sin destino → rechazado.
  BEGIN
    INSERT INTO supplier_payments (tenant_id, kind, payment_number, payment_date, amount, method, payment_account_code)
    VALUES (v_tenant, 'payment', 'CE-999901', current_date, 10, 'transferencia', '100001');
    RAISE NOTICE '[1] pago sin destino .......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[1] pago sin destino .......................... ✅ RECHAZADO por el CHECK';
    v_ok := v_ok + 1;
  END;

  -- [2] Arco exclusivo: con los dos destinos → rechazado.
  BEGIN
    INSERT INTO supplier_payments (tenant_id, business_expense_id, expense_id, kind, payment_number, payment_date, amount, method, payment_account_code)
    VALUES (v_tenant, v_compra, v_gasto, 'payment', 'CE-999902', current_date, 10, 'transferencia', '100001');
    RAISE NOTICE '[2] pago con dos destinos ..................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[2] pago con dos destinos ..................... ✅ RECHAZADO por el CHECK';
    v_ok := v_ok + 1;
  END;

  -- [3] Un gasto no puede nacer pagado.
  BEGIN
    INSERT INTO expenses (tenant_id, case_id, amount, concept, date, expense_type, status)
    SELECT v_tenant, case_id, 5, 'verificación 049', current_date, 'tramite', 'pagado' FROM expenses WHERE id = v_gasto;
    RAISE NOTICE '[3] gasto nace pagado ......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[3] gasto nace pagado ......................... ✅ RECHAZADO por el guard';
    v_ok := v_ok + 1;
  END;

  -- [4] Pago parcial → parcialmente_pagado, amount_paid = la mitad.
  INSERT INTO supplier_payments (tenant_id, expense_id, kind, payment_number, payment_date, amount, method, payment_account_code, created_by)
  VALUES (v_tenant, v_gasto, 'payment', 'CE-999903', current_date, round(v_total / 2, 2), 'transferencia', '100001', v_user)
  RETURNING id INTO v_pago1;
  SELECT status, amount_paid INTO v_st, v_paid FROM expenses WHERE id = v_gasto;
  IF v_st = 'parcialmente_pagado' AND v_paid = round(v_total / 2, 2) THEN
    RAISE NOTICE '[4] pago parcial .............................. ✅ parcialmente_pagado · %', v_paid;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[4] pago parcial .............................. ❌ % · %', v_st, v_paid;
    v_fail := v_fail + 1;
  END IF;

  -- [5] Segundo pago por el resto → pagado.
  INSERT INTO supplier_payments (tenant_id, expense_id, kind, payment_number, payment_date, amount, method, payment_account_code, created_by)
  VALUES (v_tenant, v_gasto, 'payment', 'CE-999904', current_date, v_total - round(v_total / 2, 2), 'transferencia', '100001', v_user)
  RETURNING id INTO v_pago2;
  SELECT status, amount_paid INTO v_st, v_paid FROM expenses WHERE id = v_gasto;
  IF v_st = 'pagado' AND v_paid = v_total THEN
    RAISE NOTICE '[5] pago del resto ............................ ✅ pagado · %', v_paid;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] pago del resto ............................ ❌ % · %', v_st, v_paid;
    v_fail := v_fail + 1;
  END IF;

  -- [6] Escritura manual de amount_paid → rechazada.
  BEGIN
    UPDATE expenses SET amount_paid = 1 WHERE id = v_gasto;
    RAISE NOTICE '[6] amount_paid a mano ........................ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[6] amount_paid a mano ........................ ✅ RECHAZADO por el guard';
    v_ok := v_ok + 1;
  END;

  -- [7] status → anulado a mano SIN la llave → rechazado; CON la llave → pasa (es lo que usa la 050).
  BEGIN
    UPDATE expenses SET status = 'anulado' WHERE id = v_gasto;
    RAISE NOTICE '[7] anulado sin llave ......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    BEGIN
      PERFORM set_config('finanzas.tramite_anular', 'on', true);
      UPDATE expenses SET status = 'anulado' WHERE id = v_gasto;
      PERFORM set_config('finanzas.tramite_anular', 'off', true);
      SELECT status INTO v_st FROM expenses WHERE id = v_gasto;
      -- y el recálculo NO lo pisa:
      DELETE FROM supplier_payments WHERE id = v_pago2;
      SELECT status, amount_paid INTO v_err, v_paid FROM expenses WHERE id = v_gasto;
      IF v_st = 'anulado' AND v_err = 'anulado' AND v_paid = round(v_total / 2, 2) THEN
        RAISE NOTICE '[7] anulado con llave ......................... ✅ pasa con la llave, y el recálculo conserva anulado (monto %)', v_paid;
        v_ok := v_ok + 1;
      ELSE
        RAISE NOTICE '[7] anulado con llave ......................... ❌ % / % / %', v_st, v_err, v_paid;
        v_fail := v_fail + 1;
      END IF;
    END;
  END;
  -- volver a un estado normal para lo que sigue (válvula de restauración, SOP-017)
  PERFORM set_config('finanzas.amount_paid_override', 'on', true);
  UPDATE expenses SET status = 'parcialmente_pagado' WHERE id = v_gasto;
  PERFORM set_config('finanzas.amount_paid_override', 'off', true);

  -- [8] DELETE del pago restante → pendiente_pago, 0.
  DELETE FROM supplier_payments WHERE id = v_pago1;
  SELECT status, amount_paid INTO v_st, v_paid FROM expenses WHERE id = v_gasto;
  IF v_st = 'pendiente_pago' AND v_paid = 0 THEN
    RAISE NOTICE '[8] DELETE del pago ........................... ✅ vuelve a pendiente_pago · 0';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[8] DELETE del pago ........................... ❌ % · %', v_st, v_paid;
    v_fail := v_fail + 1;
  END IF;

  -- [9] Regresión del lado COMPRA: el trigger ramificado sigue recalculando la compra.
  IF v_compra IS NOT NULL THEN
    INSERT INTO supplier_payments (tenant_id, business_expense_id, kind, payment_number, payment_date, amount, method, payment_account_code, created_by)
    VALUES (v_tenant, v_compra, 'payment', 'CE-999905', current_date, 1, 'transferencia', '100001', v_user)
    RETURNING id INTO v_pagoc;
    SELECT status, amount_paid INTO v_st, v_paid FROM business_expenses WHERE id = v_compra;
    DELETE FROM supplier_payments WHERE id = v_pagoc;
    SELECT status INTO v_err FROM business_expenses WHERE id = v_compra;
    IF v_st = 'parcialmente_pagado' AND v_paid = 1 AND v_err = 'pendiente_pago' THEN
      RAISE NOTICE '[9] lado compra intacto ....................... ✅ parcial con 1.00 y vuelve a pendiente';
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[9] lado compra intacto ....................... ❌ % · % · %', v_st, v_paid, v_err;
      v_fail := v_fail + 1;
    END IF;
  ELSE
    RAISE NOTICE '[9] lado compra intacto ....................... ⚠️ no hay compras pendientes, se omite';
  END IF;

  -- [10] Reversión de un pago de trámite: se registra, se postea, falla forzada tras el posteo.
  INSERT INTO supplier_payments (tenant_id, expense_id, kind, payment_number, payment_date, amount, method, payment_account_code, created_by)
  VALUES (v_tenant, v_gasto, 'payment', 'CE-999906', current_date, v_total, 'transferencia', '100001', v_user)
  RETURNING id INTO v_pago1;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','200001','debit',v_total,'credit',0,'description','Proveedor'),
    jsonb_build_object('account_code','100001','debit',0,'credit',v_total,'description','Pago')
  );
  v_entry := post_journal_entry(v_tenant, current_date - 1, 'Pago de gasto de trámite (verificación 049)', 'pago_proveedor',
                                v_lines, v_pago1, NULL, NULL, NULL, v_user, NULL, 'CE-999906', 'pago-proveedor:' || v_pago1);
  SELECT entry_number INTO v_entry_nro FROM journal_entries WHERE id = v_entry;
  SELECT last_number INTO v_seq_antes
    FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  CREATE OR REPLACE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''BOOM simulado después del posteo''; END';
  CREATE TRIGGER trg_boom BEFORE UPDATE OF status ON public.supplier_payments
    FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
  BEGIN
    PERFORM reverse_supplier_payment(v_tenant, v_pago1, 'Verificación 049', current_date, 'x',
      jsonb_build_array(
        jsonb_build_object('account_code','200001','debit',0,'credit',v_total),
        jsonb_build_object('account_code','100001','debit',v_total,'credit',0)
      ), v_user);
    RAISE NOTICE '[10] falla forzada tras el posteo ............ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_n FROM journal_entries WHERE reverses_entry_id = v_entry;
    SELECT last_number INTO v_seq_desp
      FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
    SELECT status INTO v_st FROM supplier_payments WHERE id = v_pago1;
    SELECT status INTO v_err FROM expenses WHERE id = v_gasto;
    IF v_n = 0 AND v_seq_desp = v_seq_antes AND v_st = 'registrado' AND v_err = 'pagado' THEN
      RAISE NOTICE '[10] falla forzada tras el posteo ............ ✅ TODO DESHECHO (0 espejos, correlativo % intacto, pago registrado, gasto pagado)', v_seq_desp;
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[10] falla forzada tras el posteo ............ ❌ QUEDÓ A MEDIAS: % espejo(s), correlativo % → %, pago "%", gasto "%"', v_n, v_seq_antes, v_seq_desp, v_st, v_err;
      v_fail := v_fail + 1;
    END IF;
  END;
  DROP TRIGGER trg_boom ON public.supplier_payments;

  -- [11] Reversión real: el gasto vuelve a pendiente y la respuesta dice kind = tramite.
  v_res := reverse_supplier_payment(v_tenant, v_pago1, 'Verificación 049', current_date,
             'Reversión del asiento ' || v_entry_nro,
             jsonb_build_array(
               jsonb_build_object('account_code','200001','debit',0,'credit',v_total),
               jsonb_build_object('account_code','100001','debit',v_total,'credit',0)
             ), v_user);
  SELECT status, amount_paid INTO v_st, v_paid FROM expenses WHERE id = v_gasto;
  SELECT status INTO v_err FROM supplier_payments WHERE id = v_pago1;
  IF v_st = 'pendiente_pago' AND v_paid = 0 AND v_err = 'anulado'
     AND (v_res->>'reversed_entry_number')::bigint = v_entry_nro
     AND v_res->'expense'->>'kind' = 'tramite' AND (v_res->'expense'->>'id')::uuid = v_gasto THEN
    RAISE NOTICE '[11] reversión real ........................... ✅ asiento % revierte al % · pago anulado · gasto pendiente_pago · kind=tramite', v_res->>'entry_number', v_entry_nro;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[11] reversión real ........................... ❌ gasto % · % · pago % · res %', v_st, v_paid, v_err, v_res;
    v_fail := v_fail + 1;
  END IF;

  -- [12] La 038 reabierta: supplier_id se puede asignar sobre un gasto asentado; el concepto no.
  IF v_asentado IS NOT NULL AND v_prov IS NOT NULL THEN
    BEGIN
      UPDATE expenses SET supplier_id = v_prov WHERE id = v_asentado;
      BEGIN
        UPDATE expenses SET concept = concept || ' (x)' WHERE id = v_asentado;
        RAISE NOTICE '[12] 038 reabierta ............................ ❌ el concepto de un gasto asentado se pudo editar';
        v_fail := v_fail + 1;
      EXCEPTION WHEN restrict_violation THEN
        RAISE NOTICE '[12] 038 reabierta ............................ ✅ supplier_id editable, concepto congelado';
        v_ok := v_ok + 1;
      END;
    EXCEPTION WHEN restrict_violation THEN
      RAISE NOTICE '[12] 038 reabierta ............................ ❌ supplier_id sigue congelado';
      v_fail := v_fail + 1;
    END;
  ELSE
    RAISE NOTICE '[12] 038 reabierta ............................ ⚠️ sin gasto asentado o sin proveedor, se omite';
  END IF;

  -- [13] payment_account_code SIGUE congelado en un gasto asentado (D3: no se escribe).
  IF v_asentado IS NOT NULL THEN
    BEGIN
      UPDATE expenses SET payment_account_code = '100001' WHERE id = v_asentado;
      RAISE NOTICE '[13] payment_account_code congelado ........... ❌ se pudo escribir';
      v_fail := v_fail + 1;
    EXCEPTION WHEN restrict_violation THEN
      RAISE NOTICE '[13] payment_account_code congelado ........... ✅ RECHAZADO (el banco va en el pago)';
      v_ok := v_ok + 1;
    END;
  ELSE
    RAISE NOTICE '[13] payment_account_code congelado ........... ⚠️ sin gasto asentado, se omite';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '════════ 049: % ✅ · % ❌ ════════', v_ok, v_fail;
END $$;

ROLLBACK;

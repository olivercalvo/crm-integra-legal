-- ============================================================================
-- VERIFICACIÓN de la 048 — pagos a proveedores: trigger, guard, saldos heredados,
-- numeración y reverse_supplier_payment.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja pagos, asientos ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-048-pagos-a-proveedores.sql
--
-- Presupone la 048 aplicada. Usa una compra `pendiente_pago` del tenant de
-- staging (la más nueva) y el banco 100001. Trece comprobaciones.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant    uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user      uuid;
  v_compra    uuid;
  v_total     numeric;
  v_ok        int := 0;
  v_fail      int := 0;
  v_n         int;
  v_st        text;
  v_paid      numeric;
  v_fecha     date;
  v_pago1     uuid;
  v_pago2     uuid;
  v_err       text;
  v_heredados int;
  v_cuenta_id uuid;
  v_cxp_id    uuid;
  v_entry     uuid;
  v_entry_nro bigint;
  v_lines     jsonb;
  v_res       jsonb;
  v_seq_antes bigint;
  v_seq_desp  bigint;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id, total INTO v_compra, v_total FROM business_expenses
   WHERE tenant_id = v_tenant AND status = 'pendiente_pago' AND total > 0
   ORDER BY created_at DESC LIMIT 1;
  IF v_compra IS NULL THEN
    RAISE NOTICE '⚠️ No hay compras pendientes en staging: nada que verificar.';
    RETURN;
  END IF;
  RAISE NOTICE 'Compra % · total %', v_compra, v_total;

  -- [1] Ninguna compra 'pagado' sin pagos detrás: o un saldo heredado del backfill
  --     o pagos reales (desde el 21/09 conviven) que sumen su total.
  SELECT COUNT(*) INTO v_n FROM business_expenses b
   WHERE b.tenant_id = v_tenant AND b.status = 'pagado'
     AND b.total > (SELECT COALESCE(SUM(sp.amount), 0) FROM supplier_payments sp
                     WHERE sp.business_expense_id = b.id AND sp.status = 'registrado');
  SELECT COUNT(*) INTO v_heredados FROM supplier_payments WHERE tenant_id = v_tenant AND kind = 'migrated_balance';
  IF v_n = 0 THEN
    RAISE NOTICE '[1] saldos heredados .......................... ✅ % saldos heredados; toda compra pagada tiene pagos por su total', v_heredados;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] saldos heredados .......................... ❌ % compras pagadas sin saldo heredado', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [2] Y amount_paid de esas compras coincide con el total.
  SELECT COUNT(*) INTO v_n FROM business_expenses
   WHERE tenant_id = v_tenant AND status = 'pagado' AND amount_paid < total;
  IF v_n = 0 THEN
    RAISE NOTICE '[2] amount_paid de las pagadas ................. ✅ todas >= total';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[2] amount_paid de las pagadas ................. ❌ % con amount_paid < total', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [3] Un saldo heredado NO puede tener número, banco ni método (CHECK).
  BEGIN
    INSERT INTO supplier_payments (tenant_id, business_expense_id, kind, payment_number, payment_date, amount, method, payment_account_code)
    VALUES (v_tenant, v_compra, 'migrated_balance', 'CE-999999', current_date, 1, NULL, NULL);
    RAISE NOTICE '[3] heredado con número ....................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[3] heredado con número ....................... ✅ RECHAZADO por el CHECK';
    v_ok := v_ok + 1;
  END;

  -- [4] Un pago sin banco tampoco (CHECK).
  BEGIN
    INSERT INTO supplier_payments (tenant_id, business_expense_id, kind, payment_number, payment_date, amount, method, payment_account_code)
    VALUES (v_tenant, v_compra, 'payment', 'CE-999998', current_date, 1, 'transferencia', NULL);
    RAISE NOTICE '[4] pago sin banco ............................ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[4] pago sin banco ............................ ✅ RECHAZADO por el CHECK';
    v_ok := v_ok + 1;
  END;

  -- [5] Pago parcial: la compra pasa a parcialmente_pagado, amount_paid y payment_date derivados.
  INSERT INTO supplier_payments (tenant_id, business_expense_id, kind, payment_number, payment_date, amount, method, payment_account_code, created_by)
  VALUES (v_tenant, v_compra, 'payment', 'CE-999001', current_date - 1, round(v_total / 2, 2), 'transferencia', '100001', v_user)
  RETURNING id INTO v_pago1;
  SELECT status, amount_paid, payment_date INTO v_st, v_paid, v_fecha FROM business_expenses WHERE id = v_compra;
  IF v_st = 'parcialmente_pagado' AND v_paid = round(v_total / 2, 2) AND v_fecha = current_date - 1 THEN
    RAISE NOTICE '[5] pago parcial .............................. ✅ parcialmente_pagado · pagado % · fecha %', v_paid, v_fecha;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] pago parcial .............................. ❌ % · % · %', v_st, v_paid, v_fecha;
    v_fail := v_fail + 1;
  END IF;

  -- [6] Segundo pago por el resto: pagado, fecha = la del último.
  INSERT INTO supplier_payments (tenant_id, business_expense_id, kind, payment_number, payment_date, amount, method, payment_account_code, created_by)
  VALUES (v_tenant, v_compra, 'payment', 'CE-999002', current_date, v_total - round(v_total / 2, 2), 'efectivo', '100001', v_user)
  RETURNING id INTO v_pago2;
  SELECT status, amount_paid, payment_date INTO v_st, v_paid, v_fecha FROM business_expenses WHERE id = v_compra;
  IF v_st = 'pagado' AND v_paid = v_total AND v_fecha = current_date THEN
    RAISE NOTICE '[6] segundo pago, saldo cero .................. ✅ pagado · % · fecha %', v_paid, v_fecha;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[6] segundo pago, saldo cero .................. ❌ % · % · %', v_st, v_paid, v_fecha;
    v_fail := v_fail + 1;
  END IF;

  -- [7] El guard: escribir amount_paid o status a mano se rechaza.
  BEGIN
    UPDATE business_expenses SET amount_paid = 0 WHERE id = v_compra;
    RAISE NOTICE '[7] UPDATE amount_paid a mano ................. ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[7] UPDATE amount_paid a mano ................. ✅ RECHAZADO por el guard';
    v_ok := v_ok + 1;
  END;
  BEGIN
    UPDATE business_expenses SET status = 'pendiente_pago' WHERE id = v_compra;
    RAISE NOTICE '[8] UPDATE status a mano ...................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[8] UPDATE status a mano ...................... ✅ RECHAZADO por el guard';
    v_ok := v_ok + 1;
  END;

  -- [9] Eliminar un pago (sin asiento) devuelve la compra a parcial.
  DELETE FROM supplier_payments WHERE id = v_pago2;
  SELECT status, amount_paid INTO v_st, v_paid FROM business_expenses WHERE id = v_compra;
  IF v_st = 'parcialmente_pagado' AND v_paid = round(v_total / 2, 2) THEN
    RAISE NOTICE '[9] DELETE del pago ........................... ✅ vuelve a parcialmente_pagado · %', v_paid;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[9] DELETE del pago ........................... ❌ % · %', v_st, v_paid;
    v_fail := v_fail + 1;
  END IF;

  -- [10] reverse_supplier_payment sobre un saldo heredado → rechazado con el mensaje honesto.
  IF v_heredados > 0 THEN
    BEGIN
      SELECT id INTO v_pago2 FROM supplier_payments WHERE tenant_id = v_tenant AND kind = 'migrated_balance' LIMIT 1;
      PERFORM reverse_supplier_payment(v_tenant, v_pago2, 'motivo de prueba', current_date, 'x',
        '[{"account_code":"200001","debit":0,"credit":1},{"account_code":"100001","debit":1,"credit":0}]'::jsonb, v_user);
      RAISE NOTICE '[10] reversar un saldo heredado ............... ❌ PASÓ (debía fallar)';
      v_fail := v_fail + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%saldo heredado%' THEN
        RAISE NOTICE '[10] reversar un saldo heredado ............... ✅ RECHAZADO: %', left(v_err, 70);
        v_ok := v_ok + 1;
      ELSE
        RAISE NOTICE '[10] reversar un saldo heredado ............... ❌ falló por otra cosa: %', v_err;
        v_fail := v_fail + 1;
      END IF;
    END;
  ELSE
    RAISE NOTICE '[10] reversar un saldo heredado ............... ⚠️ no hay heredados, se omite';
  END IF;

  -- [11] Reversión real: se postea el asiento del pago 1, se reversa, la compra vuelve a pendiente.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','200001','debit',round(v_total/2,2),'credit',0,'description','Proveedor'),
    jsonb_build_object('account_code','100001','debit',0,'credit',round(v_total/2,2),'description','Pago')
  );
  v_entry := post_journal_entry(v_tenant, current_date - 1, 'Pago a proveedor (verificación 048)', 'pago_proveedor',
                                v_lines, v_pago1, NULL, NULL, NULL, v_user, NULL, 'CE-999001', 'pago-proveedor:' || v_pago1);
  SELECT entry_number INTO v_entry_nro FROM journal_entries WHERE id = v_entry;

  -- [11a] ATOMICIDAD: falla forzada DESPUÉS del posteo (en el UPDATE que anula el
  --       pago). Ni el espejo ni el correlativo pueden quedar.
  SELECT last_number INTO v_seq_antes
    FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  CREATE OR REPLACE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''BOOM simulado después del posteo''; END';
  CREATE TRIGGER trg_boom BEFORE UPDATE OF status ON public.supplier_payments
    FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
  BEGIN
    PERFORM reverse_supplier_payment(v_tenant, v_pago1, 'Verificación 048', current_date, 'x',
      jsonb_build_array(
        jsonb_build_object('account_code','200001','debit',0,'credit',round(v_total/2,2)),
        jsonb_build_object('account_code','100001','debit',round(v_total/2,2),'credit',0)
      ), v_user);
    RAISE NOTICE '[11a] falla forzada tras el posteo ............ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    SELECT count(*) INTO v_n FROM journal_entries WHERE reverses_entry_id = v_entry;
    SELECT last_number INTO v_seq_desp
      FROM accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
    SELECT status INTO v_st FROM supplier_payments WHERE id = v_pago1;
    IF v_n = 0 AND v_seq_desp = v_seq_antes AND v_st = 'registrado' THEN
      RAISE NOTICE '[11a] falla forzada tras el posteo ............ ✅ TODO DESHECHO (0 espejos, correlativo % intacto, pago sigue registrado)', v_seq_desp;
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[11a] falla forzada tras el posteo ............ ❌ QUEDÓ A MEDIAS: % espejo(s), correlativo % → %, pago "%"', v_n, v_seq_antes, v_seq_desp, v_st;
      v_fail := v_fail + 1;
    END IF;
  END;
  DROP TRIGGER trg_boom ON public.supplier_payments;
  v_res := reverse_supplier_payment(v_tenant, v_pago1, 'Verificación 048', current_date,
             'Reversión del asiento ' || v_entry_nro,
             jsonb_build_array(
               jsonb_build_object('account_code','200001','debit',0,'credit',round(v_total/2,2)),
               jsonb_build_object('account_code','100001','debit',round(v_total/2,2),'credit',0)
             ), v_user);
  SELECT status, amount_paid INTO v_st, v_paid FROM business_expenses WHERE id = v_compra;
  SELECT status INTO v_err FROM supplier_payments WHERE id = v_pago1;
  IF v_st = 'pendiente_pago' AND v_paid = 0 AND v_err = 'anulado' AND (v_res->>'reversed_entry_number')::bigint = v_entry_nro THEN
    RAISE NOTICE '[11] reversión real ............................ ✅ asiento % revierte al % · pago anulado · compra pendiente_pago', v_res->>'entry_number', v_entry_nro;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[11] reversión real ............................ ❌ compra % · % · pago % · res %', v_st, v_paid, v_err, v_res;
    v_fail := v_fail + 1;
  END IF;

  -- [12] Reversar dos veces → rechazado.
  BEGIN
    PERFORM reverse_supplier_payment(v_tenant, v_pago1, 'otra vez', current_date, 'x', v_lines, v_user);
    RAISE NOTICE '[12] reversar dos veces ........................ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[12] reversar dos veces ........................ ✅ RECHAZADO: %', left(v_err, 60);
    v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '════════ 048: % ✅ · % ❌ ════════', v_ok, v_fail;
END $$;

ROLLBACK;

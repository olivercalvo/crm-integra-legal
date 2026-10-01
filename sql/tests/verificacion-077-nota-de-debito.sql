-- ============================================================================
-- VERIFICACIÓN de la 077 — nota de débito.
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-077-nota-de-debito.sql
--
--   [1] un borrador NOTA_DEBITO se crea, con la factura que ajusta
--   [2] la referencia a una factura de OTRO cliente se rechaza
--   [3] la referencia en una factura que no es nota de débito se rechaza
--   [4] la secuencia debit_note existe y da ND-000001 en adelante
--   [5] emitida, la referencia queda congelada (T4)
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_fac    record;
  v_otro   uuid;
  v_nd     uuid;
  v_seq    int;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  SELECT id, client_id INTO v_fac FROM invoices
   WHERE tenant_id = v_tenant AND status IN ('emitida', 'parcialmente_pagada', 'pagada') AND invoice_kind <> 'NOTA_DEBITO'
   ORDER BY issue_date LIMIT 1;
  SELECT id INTO v_otro FROM clients WHERE tenant_id = v_tenant AND id <> v_fac.client_id LIMIT 1;

  -- [1]
  INSERT INTO invoices (tenant_id, invoice_number, invoice_kind, client_id, issue_date, accounting_date, due_date,
                        status, currency, referenced_invoice_id)
  VALUES (v_tenant, 'DRAFT-VERIF077', 'NOTA_DEBITO', v_fac.client_id, current_date, current_date, current_date + 30,
          'borrador', 'USD', v_fac.id)
  RETURNING id INTO v_nd;
  IF v_nd IS NOT NULL THEN
    RAISE NOTICE '[1] borrador de nota de débito con referencia ...... ✅'; v_ok := v_ok + 1;
  END IF;

  -- [2]
  BEGIN
    UPDATE invoices SET client_id = v_otro WHERE id = v_nd;
    RAISE NOTICE '[2] referencia de otro cliente ..................... ❌ se aceptó'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[2] referencia de otro cliente: rechazada .......... ✅'; v_ok := v_ok + 1;
  END;

  -- [3]
  BEGIN
    UPDATE invoices SET invoice_kind = 'HONORARIOS' WHERE id = v_nd;
    RAISE NOTICE '[3] referencia fuera de una nota de débito ......... ❌ se aceptó'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[3] referencia fuera de una nota de débito: rechazada ✅'; v_ok := v_ok + 1;
  END;

  -- [4]
  v_seq := get_next_sequence_number(v_tenant, 'debit_note');
  IF v_seq >= 1 THEN
    RAISE NOTICE '[4] secuencia debit_note: ND-% ................. ✅', lpad(v_seq::text, 6, '0'); v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[4] secuencia debit_note ......................... ❌'; v_fail := v_fail + 1;
  END IF;

  -- [5] Se marca emitida sin líneas (los totales quedan en 0): sólo se prueba T4.
  UPDATE invoices SET status = 'emitida', invoice_number = 'ND-' || lpad(v_seq::text, 6, '0') WHERE id = v_nd;
  BEGIN
    UPDATE invoices SET referenced_invoice_id = NULL WHERE id = v_nd;
    RAISE NOTICE '[5] referencia congelada al emitir ................ ❌ se cambió'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[5] referencia congelada al emitir (T4) ............ ✅'; v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '======== 077: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;

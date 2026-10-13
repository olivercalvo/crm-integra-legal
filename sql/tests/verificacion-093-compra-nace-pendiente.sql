-- ============================================================================
-- VERIFICACIÓN de la 093 — una compra sin `status` nace «pendiente_pago».
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja compras.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-093-compra-nace-pendiente.sql
--
-- Presupone la 048 y la 093 aplicadas. No necesita datos: crea la compra adentro.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_id     uuid;
  v_st     text;
  v_err    text;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  -- [1] Sin nombrar `status`: nace pendiente (antes de la 093, el DEFAULT
  --     'pagado' chocaba con el guard de la 048).
  BEGIN
    INSERT INTO business_expenses (tenant_id, expense_date, description, subtotal, tax_rate, tax_amount)
    VALUES (v_tenant, current_date, 'Verificación 093', 10, 0, 0)
    RETURNING id, status INTO v_id, v_st;
    IF v_st = 'pendiente_pago' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [1] sin status → %', v_st;
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE '❌ [1] sin status → %', v_st;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; RAISE NOTICE '❌ [1] sin status falló: %', SQLERRM;
  END;

  -- [2] El guard de la 048 sigue rechazando nacer 'pagado' a propósito.
  BEGIN
    INSERT INTO business_expenses (tenant_id, expense_date, description, subtotal, tax_rate, tax_amount, status)
    VALUES (v_tenant, current_date, 'Verificación 093 (pagado)', 10, 0, 0, 'pagado');
    v_fail := v_fail + 1; RAISE NOTICE '❌ [2] una compra nació pagada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%no puede nacer con status%' THEN
      v_ok := v_ok + 1; RAISE NOTICE '✅ [2] nacer pagada sigue rechazado';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE '❌ [2] rechazo inesperado: %', v_err;
    END IF;
  END;

  RAISE NOTICE '093: % OK, % FALLAS', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'verificación 093: % fallas', v_fail;
  END IF;
END $$;

ROLLBACK;

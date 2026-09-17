-- ============================================================================
-- VERIFICACIÓN de la 045 — tax_code_id en expense_lines.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja líneas, compras ni gastos.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-045-tax-code-id.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_exento  uuid;
  v_itbms7  uuid;
  v_compra  uuid;
  v_caso    uuid;
  v_gasto   uuid;
  v_sin     bigint;
  v_desc    bigint;
BEGIN
  SELECT id INTO v_exento FROM public.tax_codes WHERE tenant_id = v_tenant AND code = 'EXENTO';
  SELECT id INTO v_itbms7 FROM public.tax_codes WHERE tenant_id = v_tenant AND code = 'ITBMS_7';
  IF v_exento IS NULL OR v_itbms7 IS NULL THEN
    RAISE EXCEPTION 'Faltan EXENTO / ITBMS_7 en tax_codes del tenant de prueba';
  END IF;

  -- [0] El backfill no dejó ninguna línea de compra sin código, y el snapshot
  --     coincide con el catálogo.
  SELECT COUNT(*) INTO v_sin
    FROM public.expense_lines WHERE business_expense_id IS NOT NULL AND tax_code_id IS NULL;
  SELECT COUNT(*) INTO v_desc
    FROM public.expense_lines l JOIN public.tax_codes tc ON tc.id = l.tax_code_id
   WHERE l.business_expense_id IS NOT NULL AND tc.rate <> l.tax_rate;
  IF v_sin = 0 AND v_desc = 0 THEN
    RAISE NOTICE '[0] backfill de compras ....................... ✅ 0 sin código, 0 con tasa ≠ catálogo';
  ELSE
    RAISE NOTICE '[0] backfill de compras ....................... ❌ % sin código, % con tasa ≠ catálogo', v_sin, v_desc;
  END IF;

  -- Una compra de prueba (sin asiento: nada la gatea).
  INSERT INTO public.business_expenses
    (tenant_id, expense_date, description, subtotal, tax_rate, tax_amount, status)
  VALUES (v_tenant, current_date, 'Verificación 045', 35, 0.07, 1.75, 'pendiente_pago')
  RETURNING id INTO v_compra;

  -- [1] Línea de compra SIN código → el CHECK la rechaza.
  BEGIN
    INSERT INTO public.expense_lines
      (tenant_id, business_expense_id, line_order, description, chart_account_code, amount, tax_rate, tax_amount)
    VALUES (v_tenant, v_compra, 1, 'Internet de agosto', '610005', 25, 0.07, 1.75);
    RAISE NOTICE '[1] línea de compra sin tax_code_id ........... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[1] línea de compra sin tax_code_id ........... ✅ RECHAZADA por el CHECK';
  END;

  -- [2] Las dos líneas de la factura del internet, cada una con su código.
  INSERT INTO public.expense_lines
    (tenant_id, business_expense_id, line_order, description, chart_account_code, amount, tax_code_id, tax_rate, tax_amount)
  VALUES
    (v_tenant, v_compra, 1, 'Internet de agosto',       '610005', 25, v_itbms7, 0.07, 1.75),
    (v_tenant, v_compra, 2, 'Tasa municipal (exenta)',  '610001', 10, v_exento, 0,    0);
  RAISE NOTICE '[2] compra mixta (7%% + exento) ................ ✅ 2 líneas, cada una con su código';

  -- [3] Un id que no está en tax_codes → la FK lo rechaza.
  BEGIN
    INSERT INTO public.expense_lines
      (tenant_id, business_expense_id, line_order, description, chart_account_code, amount, tax_code_id, tax_rate, tax_amount)
    VALUES (v_tenant, v_compra, 3, 'Código inventado', '610005', 5, gen_random_uuid(), 0, 0);
    RAISE NOTICE '[3] tax_code_id inexistente ................... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '[3] tax_code_id inexistente ................... ✅ RECHAZADO por la FK';
  END;

  -- [4] Una línea de TRÁMITE sin código sigue entrando: el CHECK no la cubre.
  SELECT id INTO v_caso FROM public.cases WHERE tenant_id = v_tenant LIMIT 1;
  IF v_caso IS NULL THEN
    RAISE NOTICE '[4] línea de trámite sin tax_code_id .......... ⏭️ sin casos en este tenant, no se prueba';
  ELSE
    INSERT INTO public.expenses (tenant_id, case_id, amount, concept, date, expense_type, registered_by)
    VALUES (v_tenant, v_caso, 100, 'Verificación 045', current_date, 'tramite',
            (SELECT id FROM public.users WHERE tenant_id = v_tenant LIMIT 1))
    RETURNING id INTO v_gasto;
    INSERT INTO public.expense_lines
      (tenant_id, expense_id, line_order, description, chart_account_code, amount, tax_rate, tax_amount)
    VALUES (v_tenant, v_gasto, 1, 'Timbres fiscales', '130003', 100, 0, 0);
    RAISE NOTICE '[4] línea de trámite sin tax_code_id .......... ✅ ACEPTADA (el CHECK es solo para compras)';
  END IF;
END $$;

ROLLBACK;

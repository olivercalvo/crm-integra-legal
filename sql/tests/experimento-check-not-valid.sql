-- ============================================================================
-- EXPERIMENTO — ¿sirve `CHECK (chart_account_code IS NOT NULL) NOT VALID` para
-- cerrar el hueco del validador sin romper los 128 gastos históricos?
-- ============================================================================
-- La pregunta exacta de Oliver: qué pasa con un UPDATE sobre una fila vieja que
-- sigue en NULL — por ejemplo cambiarle la descripción sin tocar la cuenta.
--
-- TODO CORRE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK. No deja nada.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant  uuid;
  v_gasto   uuid;
  v_linea   uuid;
  v_desc    text;
  v_err     text;
BEGIN
  SELECT tenant_id, id INTO v_tenant, v_gasto FROM public.expenses LIMIT 1;
  SELECT id INTO v_linea FROM public.expense_lines
   WHERE expense_id = v_gasto AND chart_account_code IS NULL LIMIT 1;

  IF v_linea IS NULL THEN
    RAISE EXCEPTION 'No hay ninguna línea en NULL para probar. ¿Se corrió la 036?';
  END IF;

  RAISE NOTICE '=== Línea de prueba: % (gasto %) ===', v_linea, v_gasto;

  -- -------------------------------------------------------------------------
  ALTER TABLE public.expense_lines
    ADD CONSTRAINT _exp_cuenta_obligatoria CHECK (chart_account_code IS NOT NULL) NOT VALID;
  RAISE NOTICE '[1] ADD CONSTRAINT ... NOT VALID sobre una tabla con % filas en NULL: OK',
    (SELECT COUNT(*) FROM public.expense_lines WHERE chart_account_code IS NULL);

  -- -------------------------------------------------------------------------
  -- [2] INSERT nuevo SIN cuenta → tiene que fallar (es el objetivo).
  BEGIN
    INSERT INTO public.expense_lines
      (tenant_id, expense_id, line_order, description, chart_account_code, amount)
    VALUES (v_tenant, v_gasto, 990, 'prueba sin cuenta', NULL, 1.00);
    RAISE NOTICE '[2] INSERT sin cuenta: ⚠️ PASÓ — el CHECK no sirve para esto';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[2] INSERT sin cuenta: ✅ RECHAZADO (que es lo que se busca)';
  END;

  -- -------------------------------------------------------------------------
  -- [3] INSERT nuevo CON cuenta → tiene que pasar.
  BEGIN
    INSERT INTO public.expense_lines
      (tenant_id, expense_id, line_order, description, chart_account_code, amount)
    VALUES (v_tenant, v_gasto, 991, 'prueba con cuenta', '130003', 1.00);
    RAISE NOTICE '[3] INSERT con cuenta: ✅ ACEPTADO';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] INSERT con cuenta: ⚠️ RECHAZADO — %', v_err;
  END;

  -- -------------------------------------------------------------------------
  -- [4] 🔑 LA PREGUNTA DE OLIVER. UPDATE de una fila vieja que sigue en NULL,
  --     tocando SOLO la descripción.
  BEGIN
    UPDATE public.expense_lines
       SET description = 'descripción corregida a mano'
     WHERE id = v_linea;
    SELECT description INTO v_desc FROM public.expense_lines WHERE id = v_linea;
    RAISE NOTICE '[4] UPDATE de descripción en fila NULL: ✅ PASÓ (quedó "%")', v_desc;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[4] UPDATE de descripción en fila NULL: ❌ RECHAZADO por el CHECK';
    RAISE NOTICE '    → una fila histórica queda CONGELADA: no se le puede corregir';
    RAISE NOTICE '      ni un typo sin clasificarla primero.';
  END;

  -- -------------------------------------------------------------------------
  -- [5] UPDATE que SÍ clasifica la fila vieja → es el camino de salida.
  BEGIN
    UPDATE public.expense_lines SET chart_account_code = '130003' WHERE id = v_linea;
    RAISE NOTICE '[5] UPDATE que asigna la cuenta: ✅ PASÓ';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[5] UPDATE que asigna la cuenta: ❌ RECHAZADO — no habría salida';
  END;

  -- -------------------------------------------------------------------------
  -- [6] ¿VALIDATE CONSTRAINT falla mientras queden NULLs? (tiene que fallar)
  BEGIN
    ALTER TABLE public.expense_lines VALIDATE CONSTRAINT _exp_cuenta_obligatoria;
    RAISE NOTICE '[6] VALIDATE con NULLs presentes: ⚠️ PASÓ (inesperado)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[6] VALIDATE con NULLs presentes: ✅ RECHAZADO (correcto)';
  END;
END $$;

ROLLBACK;

-- ============================================================================
-- VERIFICACIÓN de los triggers de la 038 — un gasto asentado no se toca.
-- ============================================================================
-- Postea un gasto de trámite REAL con el RPC real y después intenta las ocho
-- operaciones que el trigger tiene que permitir o rechazar.
--
-- 🛡️ TODO DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK. No deja asiento,
--    no consume correlativo, no clasifica ninguna línea. Nada persiste.
--
-- Se postea por `post_journal_entry` y NO con un INSERT directo, aunque sea un
-- test: el INSERT directo se saltea partida doble, correlativo y hash-chain, y
-- lo que se quiere verificar es el comportamiento REAL (SOP-014).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant  uuid;
  v_gasto   uuid;
  v_linea   uuid;
  v_entry   uuid;
  v_num     bigint;
  v_fecha   date;
  v_ok      int := 0;
  v_fail    int := 0;
BEGIN
  SELECT e.tenant_id, e.id, e.date, l.id
    INTO v_tenant, v_gasto, v_fecha, v_linea
    FROM public.expenses e
    JOIN public.expense_lines l ON l.expense_id = e.id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.journal_entries j
      WHERE j.source_type = 'gasto_tramite' AND j.source_id = e.id
   )
   LIMIT 1;

  IF v_gasto IS NULL THEN
    RAISE EXCEPTION 'No hay ningún gasto con línea para probar. ¿Corriste la 036?';
  END IF;

  RAISE NOTICE '=== Gasto de prueba: % (línea %) ===', v_gasto, v_linea;

  -- Clasificar la línea (permitido: todavía no hay asiento).
  UPDATE public.expense_lines SET chart_account_code = '130003' WHERE id = v_linea;
  RAISE NOTICE '[0] clasificar la línea antes del asiento .............. OK';

  -- Postear con el RPC real.
  SELECT public.post_journal_entry(
    v_tenant, v_fecha, 'Gasto de trámite — verificación 038',
    'gasto_tramite',
    jsonb_build_array(
      jsonb_build_object('account_code','130003','debit',
        (SELECT line_total FROM public.expense_lines WHERE id = v_linea),'credit',0,'description','prueba'),
      jsonb_build_object('account_code','200001','debit',0,'credit',
        (SELECT line_total FROM public.expense_lines WHERE id = v_linea),'description','prueba')
    ),
    v_gasto, NULL, NULL, NULL, NULL, NULL
  ) INTO v_entry;

  SELECT entry_number INTO v_num FROM public.journal_entries WHERE id = v_entry;
  RAISE NOTICE '[1] postear por post_journal_entry ..................... OK (asiento %)', v_num;
  v_ok := v_ok + 1;

  -- ── LO QUE DEBE RECHAZAR ────────────────────────────────────────────────
  BEGIN
    UPDATE public.expenses SET concept = 'cambiado' WHERE id = v_gasto;
    RAISE NOTICE '[2] cambiar el CONCEPTO ............................... ⚠️ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '[2] cambiar el CONCEPTO ............................... ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  BEGIN
    UPDATE public.expenses SET amount = amount + 1 WHERE id = v_gasto;
    RAISE NOTICE '[3] cambiar el MONTO .................................. ⚠️ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '[3] cambiar el MONTO .................................. ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  BEGIN
    DELETE FROM public.expenses WHERE id = v_gasto;
    RAISE NOTICE '[4] BORRAR el gasto ................................... ⚠️ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '[4] BORRAR el gasto ................................... ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  BEGIN
    UPDATE public.expense_lines SET amount = amount + 1 WHERE id = v_linea;
    RAISE NOTICE '[5] cambiar el monto de una LÍNEA ..................... ⚠️ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '[5] cambiar el monto de una LÍNEA ..................... ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  BEGIN
    INSERT INTO public.expense_lines
      (tenant_id, expense_id, line_order, description, chart_account_code, amount)
    VALUES (v_tenant, v_gasto, 99, 'línea colada', '130003', 5.00);
    RAISE NOTICE '[6] AGREGAR una línea a un gasto asentado ............. ⚠️ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '[6] AGREGAR una línea a un gasto asentado ............. ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  -- ── LO QUE DEBE PERMITIR (la lista blanca) ──────────────────────────────
  BEGIN
    UPDATE public.expenses
       SET receipt_url = 'business-expenses/x/scan.pdf', receipt_filename = 'scan.pdf'
     WHERE id = v_gasto;
    RAISE NOTICE '[7] adjuntar el COMPROBANTE ........................... ✅ PERMITIDO';
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '[7] adjuntar el COMPROBANTE ........................... ❌ RECHAZADO (debía pasar)';
    v_fail := v_fail + 1;
  END;

  BEGIN
    UPDATE public.expenses SET posted_entry_id = v_entry WHERE id = v_gasto;
    RAISE NOTICE '[8] escribir posted_entry_id (el cache del posteo) ..... ✅ PERMITIDO';
    v_ok := v_ok + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '[8] escribir posted_entry_id .......................... ❌ RECHAZADO (rompe la ruta)';
    v_fail := v_fail + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '=== % correctas, % incorrectas ===', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'La verificación de la 038 falló en % caso(s).', v_fail;
  END IF;
END $$;

ROLLBACK;

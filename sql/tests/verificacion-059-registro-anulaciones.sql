-- ============================================================================
-- VERIFICACIÓN DE LA 059 — la tabla `fe_anulaciones`
-- ============================================================================
--
--   node scripts/run-sql.mjs sql/tests/verificacion-059-registro-anulaciones.sql
--
-- Todo adentro de BEGIN/ROLLBACK. Las pruebas 5 a 9 FUERZAN fallas a propósito:
-- un archivo que sólo comprueba que el INSERT feliz funciona no prueba que los
-- candados estén puestos, prueba que la base sabe insertar.
--
-- Corre DESPUÉS de aplicar la 059.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant  uuid;
  v_inv     uuid;
  v_user    uuid;
  v_ok      boolean;
  v_fallos  int := 0;
  v_n       int;
  v_motivo  text := 'Se anula por error en el monto facturado';
  v_cufe    text := 'FE0120000015555555552020202609150000000010512345678901234567890';
BEGIN
  SELECT id, tenant_id INTO v_inv, v_tenant FROM public.invoices ORDER BY created_at LIMIT 1;
  IF v_inv IS NULL THEN
    RAISE EXCEPTION '059-test: no hay ninguna factura en la base para probar.';
  END IF;
  SELECT id INTO v_user FROM public.users WHERE tenant_id = v_tenant LIMIT 1;

  -- ── 1. El alta normal entra ──────────────────────────────────────────────
  INSERT INTO public.fe_anulaciones
    (tenant_id, invoice_id, intento, cufe, motivo, resultado, i_amb, created_by)
  VALUES (v_tenant, v_inv, 1, v_cufe, v_motivo, 'sin_respuesta', 2, v_user);
  RAISE NOTICE '✔ 1/9  un intento se registra';

  -- ── 2. 🔴 Se registra ANTES de saber el resultado ────────────────────────
  --    'sin_respuesta' tiene que ser un valor legal al insertar: es lo que
  --    permite que un proceso que se muere a mitad de camino deje rastro.
  SELECT count(*) INTO v_n FROM public.fe_anulaciones
   WHERE invoice_id = v_inv AND resultado = 'sin_respuesta';
  IF v_n <> 1 THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 2/9  no quedó el registro previo a la respuesta';
  ELSE
    RAISE NOTICE '✔ 2/9  ''sin_respuesta'' es un estado válido al insertar';
  END IF;

  -- ── 3. El mismo registro se actualiza con lo que contestó el PAC ─────────
  UPDATE public.fe_anulaciones
     SET resultado = 'indeterminada',
         response_payload = '[]'::jsonb
   WHERE invoice_id = v_inv AND intento = 1;
  SELECT count(*) INTO v_n FROM public.fe_anulaciones
   WHERE invoice_id = v_inv AND intento = 1 AND resultado = 'indeterminada';
  IF v_n <> 1 THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 3/9  no se pudo cerrar el intento con la respuesta';
  ELSE
    RAISE NOTICE '✔ 3/9  ''indeterminada'' se guarda como estado, no como error';
  END IF;

  -- ── 4. Un segundo intento convive con el primero ─────────────────────────
  INSERT INTO public.fe_anulaciones
    (tenant_id, invoice_id, intento, cufe, motivo, resultado, i_amb, created_by)
  VALUES (v_tenant, v_inv, 2, v_cufe, v_motivo, 'anulada', 2, v_user);
  SELECT count(*) INTO v_n FROM public.fe_anulaciones WHERE invoice_id = v_inv;
  IF v_n <> 2 THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 4/9  el segundo intento pisó al primero (hay % filas)', v_n;
  ELSE
    RAISE NOTICE '✔ 4/9  el reintento NO pisa al primero: los dos quedan';
  END IF;

  -- ── 5. 🔴 FALLA FORZADA: el mismo intento dos veces REBOTA ───────────────
  v_ok := false;
  BEGIN
    INSERT INTO public.fe_anulaciones
      (tenant_id, invoice_id, intento, cufe, motivo, resultado, i_amb, created_by)
    VALUES (v_tenant, v_inv, 2, v_cufe, v_motivo, 'anulada', 2, v_user);
    v_ok := true;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '✔ 5/9  (invoice_id, intento) es único: no hay dos intentos 2';
  END;
  IF v_ok THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 5/9  🔴 se insertó dos veces el intento 2';
  END IF;

  -- ── 6. 🔴 FALLA FORZADA: un resultado inventado REBOTA ───────────────────
  --    Sin este CHECK, un typo ('anulado' en vez de 'anulada') se guardaría y
  --    ninguna consulta lo encontraría después.
  v_ok := false;
  BEGIN
    INSERT INTO public.fe_anulaciones
      (tenant_id, invoice_id, intento, cufe, motivo, resultado, created_by)
    VALUES (v_tenant, v_inv, 3, v_cufe, v_motivo, 'anulado', v_user);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✔ 6/9  un resultado fuera de la lista REBOTA';
  END;
  IF v_ok THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 6/9  🔴 se guardó un resultado inventado';
  END IF;

  -- ── 7. 🔴 FALLA FORZADA: motivo corto REBOTA (el mínimo de la DGI) ───────
  v_ok := false;
  BEGIN
    INSERT INTO public.fe_anulaciones
      (tenant_id, invoice_id, intento, cufe, motivo, resultado, created_by)
    VALUES (v_tenant, v_inv, 4, v_cufe, 'monto mal.', 'anulada', v_user);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✔ 7/9  un motivo de menos de 15 REBOTA (igual que en invoices)';
  END;
  IF v_ok THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 7/9  🔴 se guardó un motivo que la DGI va a rechazar';
  END IF;

  -- ── 8. 🔴 FALLA FORZADA: CUFE vacío REBOTA ───────────────────────────────
  --    Un registro de anulación sin CUFE no sirve para nada: no se puede saber
  --    qué documento se pidió anular.
  v_ok := false;
  BEGIN
    INSERT INTO public.fe_anulaciones
      (tenant_id, invoice_id, intento, cufe, motivo, resultado, created_by)
    VALUES (v_tenant, v_inv, 5, '   ', v_motivo, 'anulada', v_user);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✔ 8/9  un CUFE vacío REBOTA';
  END;
  IF v_ok THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 8/9  🔴 se registró una anulación sin CUFE';
  END IF;

  -- ── 9. 🔴 FALLA FORZADA: i_amb inventado REBOTA ──────────────────────────
  --    Sin esto, una anulación de sandbox y una real se verían igual.
  v_ok := false;
  BEGIN
    INSERT INTO public.fe_anulaciones
      (tenant_id, invoice_id, intento, cufe, motivo, resultado, i_amb, created_by)
    VALUES (v_tenant, v_inv, 6, v_cufe, v_motivo, 'anulada', 3, v_user);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✔ 9/9  i_amb sólo admite 1 (producción DGI) o 2 (sandbox)';
  END;
  IF v_ok THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 9/9  🔴 se guardó un ambiente que no existe';
  END IF;

  RAISE NOTICE '─────────────────────────────────';
  IF v_fallos = 0 THEN
    RAISE NOTICE '059 — 9/9 OK';
  ELSE
    RAISE EXCEPTION '059 — % verificación(es) FALLARON (ver los WARNING de arriba)', v_fallos;
  END IF;
  RAISE NOTICE '─────────────────────────────────';
END $$;

ROLLBACK;

-- ============================================================================
-- VERIFICACIÓN DE LA 058 — el motivo de anulación exige 15..1000
-- ============================================================================
--
--   node scripts/run-sql.mjs sql/tests/verificacion-058-motivo-anulacion.sql
--
-- Todo adentro de BEGIN/ROLLBACK: no deja nada en la base. La última prueba
-- FUERZA una falla a propósito, porque un archivo de verificación que sólo
-- comprueba lo que funciona no prueba que el candado esté puesto: prueba que la
-- base sabe hacer INSERT.
--
-- Corre DESPUÉS de aplicar la 058.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_def      text;
  v_tenant   uuid;
  v_inv      uuid;
  v_ok       boolean;
  v_msg      text;
  v_fallos   int := 0;
BEGIN
  -- ── 0. El CHECK existe y dice lo que tiene que decir ─────────────────────
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
   WHERE r.relname = 'invoices' AND c.conname = 'invoices_cancellation_reason_largo';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '058-test: el CHECK invoices_cancellation_reason_largo NO existe. ¿Se aplicó la 058?';
  END IF;
  RAISE NOTICE '✔ 1/6  el CHECK existe: %', v_def;

  IF v_def NOT ILIKE '%15%' OR v_def NOT ILIKE '%1000%' THEN
    RAISE EXCEPTION '058-test: el CHECK no menciona 15 y 1000: %', v_def;
  END IF;
  RAISE NOTICE '✔ 2/6  declara los dos extremos (15 y 1000)';

  -- ── 1. Una factura real de la base para ensuciar dentro de la transacción ─
  SELECT id, tenant_id INTO v_inv, v_tenant
    FROM public.invoices
   WHERE status = 'anulada'
   ORDER BY created_at
   LIMIT 1;

  IF v_inv IS NULL THEN
    SELECT id, tenant_id INTO v_inv, v_tenant FROM public.invoices ORDER BY created_at LIMIT 1;
  END IF;
  IF v_inv IS NULL THEN
    RAISE EXCEPTION '058-test: no hay ninguna factura en la base para probar.';
  END IF;

  -- ── 2. NULL sigue permitido: una factura viva no tiene motivo ────────────
  BEGIN
    UPDATE public.invoices SET cancellation_reason = NULL WHERE id = v_inv;
    RAISE NOTICE '✔ 3/6  NULL sigue permitido (una factura no anulada no tiene motivo)';
  EXCEPTION WHEN check_violation THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 3/6  NULL fue rechazado, y no debería';
  END;

  -- ── 3. Un motivo de 15 justos ENTRA ──────────────────────────────────────
  BEGIN
    UPDATE public.invoices SET cancellation_reason = repeat('a', 15) WHERE id = v_inv;
    RAISE NOTICE '✔ 4/6  15 caracteres justos entran (el borde es inclusivo)';
  EXCEPTION WHEN check_violation THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 4/6  15 caracteres fueron rechazados: el borde quedó exclusivo';
  END;

  -- ── 4. 🔴 LA FALLA FORZADA: 14 caracteres tienen que REBOTAR ─────────────
  --    Es la prueba que importa. Si esto pasa, el CHECK no está haciendo nada
  --    y en cuanto 9B cablee el envío la DGI va a rechazar la anulación de una
  --    factura real.
  v_ok := false;
  BEGIN
    UPDATE public.invoices SET cancellation_reason = repeat('a', 14) WHERE id = v_inv;
    v_ok := true;  -- no debería llegar acá
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE '✔ 5/6  14 caracteres REBOTAN, como tiene que ser';
  END;
  IF v_ok THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 5/6  🔴 14 caracteres ENTRARON. El CHECK no está funcionando.';
  END IF;

  -- ── 5. El espacio no cuenta: "   hola   " son 4, no 10 ───────────────────
  --    El CHECK usa btrim. Sin eso, quince espacios pasarían el mínimo.
  v_ok := false;
  BEGIN
    UPDATE public.invoices SET cancellation_reason = repeat(' ', 20) || 'corto' WHERE id = v_inv;
    v_ok := true;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✔ 6/6  el relleno de espacios NO alcanza el mínimo (el CHECK usa btrim)';
  END;
  IF v_ok THEN
    v_fallos := v_fallos + 1;
    RAISE WARNING '✗ 6/6  🔴 veinte espacios + "corto" entraron: falta el btrim.';
  END IF;

  RAISE NOTICE '─────────────────────────────────';
  IF v_fallos = 0 THEN
    RAISE NOTICE '058 — 6/6 OK';
  ELSE
    RAISE EXCEPTION '058 — % verificación(es) FALLARON (ver los WARNING de arriba)', v_fallos;
  END IF;
  RAISE NOTICE '─────────────────────────────────';
END $$;

ROLLBACK;

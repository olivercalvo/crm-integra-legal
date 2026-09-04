-- ============================================================================
-- 042 — `pago_proveedor` ENTRA AL CHECK DE `source_type`
-- ============================================================================
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ UN VALOR NUEVO Y NO REUSAR `pago`
-- ─────────────────────────────────────────────────────────────────────────────
-- Un pago a proveedor podría haber usado `source_type = 'pago'`: el UNIQUE de la
-- `034` es `(tenant_id, source_type, source_id)` y como el `source_id` sería el
-- id de una COMPRA —otra tabla, otro uuid— no chocaría con ningún cobro.
--
-- 🔴 **Pero rompería el enlace del Libro Mayor**, y de una forma que ya pasó una
-- vez. `reports/destino-documento.ts:50` dice:
--
--     pago: (id) => `/finanzas/facturas/${id}`
--
-- porque un cobro vive en el detalle de la factura que canceló. Un pago a
-- proveedor con `source_type='pago'` mandaría al contador a
-- `/finanzas/facturas/<id-de-una-compra>`, una factura que no existe.
--
-- Ese archivo YA argumenta este caso exacto, para `gasto_tramite`:
--
--   > `gasto` ya está tomado por `business_expenses` (las compras del bufete)…
--   > Un gasto de trámite es otra tabla y otra pantalla: si compartieran
--   > source_type, el ícono del mayor mandaría un gasto de trámite a
--   > `/finanzas/gastos-bufete` con un id que ahí no existe. Sería el bug del
--   > 01/09 que originó este archivo, reintroducido un módulo más adelante.
--
-- Es la misma situación una tabla más adelante. Se aplica el mismo criterio.
--
-- ⚠️ Y como allá: **cero backfill**. `pago` sigue significando exactamente lo que
-- significa hoy —el cobro de una factura— y los dos asientos que ya existen con
-- ese tipo no se tocan.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL FILTRO PARA ENCONTRAR EL CHECK, Y POR QUÉ LLEVA DOS CONDICIONES
-- ─────────────────────────────────────────────────────────────────────────────
-- Se busca por CONTENIDO, no por nombre, porque el nombre cambió entre
-- migraciones. Las dos condiciones (`%source_type%` Y `%factura%`) son las que
-- evitan el bug de la `028`: hay más de un CHECK que menciona `source_type`, y
-- solo el del enum lista los valores. Si se dropea más de uno, aborta.
--
-- IDEMPOTENCIA: la segunda corrida encuentra el CHECK nuevo (que también dice
-- `source_type` y `factura`), lo dropea y lo vuelve a crear idéntico.
-- Re-ejecutable.
--
-- DEPENDE DE: `038`, que fue la última en tocar este CHECK (agregó
-- `gasto_tramite`).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_nombre text;
  v_dropeados int := 0;
BEGIN
  FOR v_nombre IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'journal_entries'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%source_type%'
       AND pg_get_constraintdef(con.oid) ILIKE '%factura%'
  LOOP
    EXECUTE format('ALTER TABLE public.journal_entries DROP CONSTRAINT %I', v_nombre);
    v_dropeados := v_dropeados + 1;
    RAISE NOTICE 'CHECK viejo de source_type eliminado: %', v_nombre;
  END LOOP;

  IF v_dropeados > 1 THEN
    RAISE EXCEPTION
      'Se dropearon % constraints y se esperaba 1. Es el bug de la 028: revisá el filtro antes de seguir.',
      v_dropeados;
  END IF;
END $$;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN (
    'factura', 'gasto', 'gasto_tramite', 'pago', 'pago_proveedor',
    'nota_credito', 'manual', 'reversion', 'apertura'
  ));

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def       text;
  v_reversion int;
  v_pagos     int;
BEGIN
  SELECT pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'journal_entries'
     AND con.conname = 'journal_entries_source_type_check';

  IF v_def IS NULL OR v_def NOT ILIKE '%pago_proveedor%' THEN
    RAISE EXCEPTION 'El CHECK nuevo no quedó, o no incluye pago_proveedor.';
  END IF;
  IF v_def NOT ILIKE '%gasto_tramite%' THEN
    RAISE EXCEPTION
      'El CHECK nuevo perdió gasto_tramite. Se pisó lo que hizo la 038.';
  END IF;

  -- El CHECK de la reversión es OTRO constraint sobre la misma tabla, y es el
  -- que el filtro de dos condiciones tiene que haber dejado en paz. Se verifica
  -- explícitamente, igual que en la 038.
  SELECT COUNT(*) INTO v_reversion
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'journal_entries'
     AND con.conname = 'je_reversion_requires_ref';
  IF v_reversion <> 1 THEN
    RAISE EXCEPTION
      'je_reversion_requires_ref no sobrevivió (encontrados: %). El filtro dropeó de más.',
      v_reversion;
  END IF;

  SELECT COUNT(*) INTO v_pagos
    FROM journal_entries WHERE source_type = 'pago';

  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '042 OK';
  RAISE NOTICE '  source_type ahora admite pago_proveedor';
  RAISE NOTICE '  asientos con source_type=pago (intactos): %', v_pagos;
  RAISE NOTICE '  je_reversion_requires_ref: sobrevivió';
  RAISE NOTICE '════════════════════════════════════════════════════';
END $$;

COMMIT;

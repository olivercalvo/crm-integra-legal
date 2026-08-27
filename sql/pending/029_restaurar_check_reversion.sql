-- =============================================================================
-- FIX: restaurar el CHECK je_reversion_requires_ref
-- Sprint:  Contabilidad — Fase 2
-- Fecha:   2026-08-27
--
-- QUÉ PASÓ:
--   La primera versión de `028_fase2_motor_posteo.sql` tenía que ampliar el
--   CHECK de `source_type` para aceptar 'apertura'. Como ese CHECK se declaró
--   inline y sin nombre en la migración 023, la 028 lo buscaba dinámicamente
--   así:
--
--       AND pg_get_constraintdef(con.oid) ILIKE '%source_type%'
--
--   El problema es que la tabla tiene DOS checks que mencionan `source_type`, y
--   ese filtro los dropeó a los dos. El que se perdió sin querer fue:
--
--       CONSTRAINT je_reversion_requires_ref CHECK (
--         source_type <> 'reversion'
--         OR (reverses_entry_id IS NOT NULL
--             AND reversal_reason IS NOT NULL
--             AND length(reversal_reason) >= 3)
--       )
--
--   No es un detalle: es la regla que hace cumplir el Art. 5.7 del DE 34/1998 —
--   una reversión tiene que apuntar al asiento que corrige y traer un motivo.
--   Sin ese CHECK se podía escribir una reversión huérfana y sin explicación, y
--   como los asientos son inmutables, quedaría así para siempre.
--
--   El bug se detectó leyendo los NOTICE de la aplicación en staging: la 028
--   avisó que había eliminado DOS constraints donde debía eliminar una.
--
-- ALCANCE:
--   Staging es el único entorno donde llegó a correr la 028 con el filtro
--   ancho. Producción nunca la vio. La 028 ya quedó corregida (ahora pide
--   además '%factura%', que solo matchea el CHECK del enum), así que una base
--   recreada desde cero no reproduce el problema; esta migración repara las que
--   ya lo sufrieron.
--
-- IDEMPOTENCIA:
--   Comprueba si el constraint existe y SOLO lo crea si falta. Sobre una base
--   sana —producción incluida— no toca nada y lo dice por NOTICE. Verificado
--   corriéndola dos veces contra staging.
-- =============================================================================

BEGIN;

-- ⚠️ SOLO CREA SI FALTA. No hace DROP + ADD.
--
-- Esta migración repara un daño que sufrió UNA base (staging). Cuando corra
-- contra producción —o contra cualquier base sana— la constraint va a estar ahí
-- y correcta, y no hay que tocarla: un DROP + ADD la reescribiría sin motivo, y
-- el ADD sobre una tabla con asientos dispara una revalidación completa que toma
-- lock. Sobre un ledger grande eso es una pausa de escritura por nada.
--
-- Además avisa qué hizo, para que quede en el log de la corrida.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'journal_entries'
       AND con.contype = 'c'
       AND con.conname = 'je_reversion_requires_ref'
  ) THEN
    RAISE NOTICE 'je_reversion_requires_ref ya existe: base sana, no se toca.';
  ELSE
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT je_reversion_requires_ref CHECK (
        source_type <> 'reversion'
        OR (reverses_entry_id IS NOT NULL
            AND reversal_reason IS NOT NULL
            AND length(reversal_reason) >= 3)
      );
    RAISE NOTICE 'je_reversion_requires_ref RESTAURADO (faltaba).';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- VERIFICACIÓN — los DOS checks tienen que estar
-- =============================================================================
DO $$
DECLARE
  v_enum      int;
  v_reversion int;
BEGIN
  SELECT COUNT(*) INTO v_enum
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'journal_entries' AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%apertura%';

  SELECT COUNT(*) INTO v_reversion
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'journal_entries' AND con.contype = 'c'
     AND con.conname = 'je_reversion_requires_ref';

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'CHECK del enum con apertura ...... % (esperado 1)', v_enum;
  RAISE NOTICE 'CHECK je_reversion_requires_ref .. % (esperado 1)', v_reversion;

  IF v_enum <> 1 THEN
    RAISE EXCEPTION 'ABORT: falta el CHECK de source_type con apertura';
  END IF;
  IF v_reversion <> 1 THEN
    RAISE EXCEPTION 'ABORT: no se restauró je_reversion_requires_ref';
  END IF;
END $$;

SELECT con.conname, pg_get_constraintdef(con.oid) AS definicion
FROM   pg_constraint con
JOIN   pg_class rel ON rel.oid = con.conrelid
WHERE  rel.relname = 'journal_entries' AND con.contype = 'c'
ORDER  BY con.conname;

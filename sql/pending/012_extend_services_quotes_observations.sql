-- =============================================================================
-- FEATURE: Sprint QUOTES-POLISH — extensiones services_catalog + quotes/credit_notes.observations
-- Fecha:   2026-05-16
-- Sprint:  QUOTES-POLISH (encima de develop 5f9cb52)
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   Feedback de Milena Batista / Daveiva post-onboarding:
--     1. Agregar más opciones de reembolso al catálogo de servicios sin tocar
--        las 9 entradas existentes (preserva FKs en cotizaciones/facturas
--        históricas).
--     2. Permitir un campo "observations" cliente-visible en cotizaciones,
--        separado de las notas internas (quotes.notes que hoy se filtran al
--        PDF por bug pre-existente; se corrige en este sprint quitándolas
--        del template).
--     3. Mismo campo "observations" en notas de crédito para que el flujo de
--        anulación de factura permita capturar contexto adicional al motivo
--        obligatorio (campo "reason").
--
--   La tabla `observation_templates` (catálogo administrable de plantillas)
--   se crea en sql/pending/013 — esta migración se queda en cambios a tablas
--   existentes.
--
-- Cambios:
--   1. services_catalog ADD COLUMN sort_order INT NULL + backfill alfabético
--      por code (NULLS LAST en la query del backend).
--   2. 4 INSERT nuevos en services_catalog (REIM-NOT/TIM/REG/ADM) para
--      reflejar la práctica real del bufete (notariales, timbres, Registro
--      Público, administrativos). REIM-GOB y REIM-OTH siguen activos.
--   3. quotes ADD COLUMN observations TEXT NULL + CHECK char_length <= 2000.
--   4. credit_notes ADD COLUMN observations TEXT NULL + CHECK char_length
--      <= 2000.
--
-- Reversibilidad:
--   ROLLBACK al final, comentado. ADD COLUMN + INSERT son no-destructivos;
--   el DROP COLUMN del rollback PIERDE los valores guardados, así que solo
--   tiene sentido revertir antes de que las abogadas empiecen a usar el
--   campo.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (dashboard del cliente).
--   No reaplicar si ya se ejecutó (IF NOT EXISTS protege agregar columnas;
--   los INSERT usan ON CONFLICT DO NOTHING).
-- =============================================================================

-- =============================================================================
-- PRE-CHECK
-- =============================================================================
DO $$
DECLARE
  v_services_count    INT;
  v_quotes_has_obs    INT;
  v_cn_has_obs        INT;
  v_services_has_sort INT;
BEGIN
  SELECT COUNT(*) INTO v_services_count
    FROM services_catalog
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID;

  SELECT COUNT(*) INTO v_quotes_has_obs
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='quotes' AND column_name='observations';

  SELECT COUNT(*) INTO v_cn_has_obs
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_notes' AND column_name='observations';

  SELECT COUNT(*) INTO v_services_has_sort
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='services_catalog' AND column_name='sort_order';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'services_catalog filas tenant Integra: % (esperado 9 si sprint nuevo)', v_services_count;
  RAISE NOTICE 'quotes.observations existe: % (esperado 0)', v_quotes_has_obs;
  RAISE NOTICE 'credit_notes.observations existe: % (esperado 0)', v_cn_has_obs;
  RAISE NOTICE 'services_catalog.sort_order existe: % (esperado 0)', v_services_has_sort;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. services_catalog — ADD sort_order + backfill alfabético + 4 INSERT REIM
-- -----------------------------------------------------------------------------
ALTER TABLE services_catalog
  ADD COLUMN IF NOT EXISTS sort_order INT NULL;

COMMENT ON COLUMN services_catalog.sort_order IS
  'Orden de presentación en dropdowns. NULL = al final (NULLS LAST en la query). Backfill alfabético por code en este sprint; admin podrá editar manualmente en ADMIN-CATALOGS futuro.';

-- Backfill alfabético: posición incremental ordenada por code (10, 20, 30, …)
-- usando WINDOW para que sea idempotente y deje gaps para inserciones
-- manuales futuras sin renumerar todo.
UPDATE services_catalog s
SET    sort_order = ranked.new_order
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY code) * 10 AS new_order
  FROM   services_catalog
  WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID
    AND  sort_order IS NULL
) AS ranked
WHERE  s.id = ranked.id;

-- 4 nuevas líneas de reembolso. REIM-* convención existente (no SVC-*).
-- revenue_account = '2201' (pasivo, pass-through al cliente, igual que las
-- REIM existentes). default_tax_code = 'EXENTO' (reembolsos no llevan ITBMS).
-- sort_order asignado manualmente para que queden DESPUÉS de REIM-GOB
-- (orden actual = 80 después del backfill) y antes de REIM-OTH (= 90).
-- 4 nuevos: 81, 82, 83, 84.
INSERT INTO services_catalog
  (tenant_id, code, name, service_type, revenue_account, default_tax_code, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'REIM-NOT', 'Reembolso de gastos notariales',     'reembolso', '2201', 'EXENTO', 81),
  ('a0000000-0000-0000-0000-000000000001', 'REIM-TIM', 'Reembolso de timbres fiscales',      'reembolso', '2201', 'EXENTO', 82),
  ('a0000000-0000-0000-0000-000000000001', 'REIM-REG', 'Reembolso de gastos Registro Público','reembolso', '2201', 'EXENTO', 83),
  ('a0000000-0000-0000-0000-000000000001', 'REIM-ADM', 'Reembolso de gastos administrativos','reembolso', '2201', 'EXENTO', 84)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. quotes — ADD observations + CHECK <= 2000
-- -----------------------------------------------------------------------------
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS observations TEXT NULL;

-- CHECK separado para que el ADD COLUMN sea idempotente.
ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_observations_length_check;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_observations_length_check
  CHECK (observations IS NULL OR char_length(observations) <= 2000);

COMMENT ON COLUMN quotes.observations IS
  'Observaciones cliente-visible en el PDF de la cotización (Sprint QUOTES-POLISH). Distintas de quotes.notes (interno). NULL si la abogada no agrega nada — la sección OBSERVACIONES no se renderiza en ese caso. Limitado a 2000 caracteres para evitar PDFs descontrolados.';

-- -----------------------------------------------------------------------------
-- 3. credit_notes — ADD observations + CHECK <= 2000
-- -----------------------------------------------------------------------------
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS observations TEXT NULL;

ALTER TABLE credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_observations_length_check;
ALTER TABLE credit_notes
  ADD CONSTRAINT credit_notes_observations_length_check
  CHECK (observations IS NULL OR char_length(observations) <= 2000);

COMMENT ON COLUMN credit_notes.observations IS
  'Observaciones adicionales que se muestran en el PDF de la NC, debajo del motivo obligatorio (reason). NULL si no se agrega. Limitado a 2000 caracteres.';

COMMIT;

-- =============================================================================
-- POST-CHECK
-- =============================================================================
DO $$
DECLARE
  v_services_count    INT;
  v_services_reim_new INT;
  v_quotes_has_obs    INT;
  v_cn_has_obs        INT;
  v_services_has_sort INT;
BEGIN
  SELECT COUNT(*) INTO v_services_count
    FROM services_catalog
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID;

  SELECT COUNT(*) INTO v_services_reim_new
    FROM services_catalog
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID
      AND code IN ('REIM-NOT','REIM-TIM','REIM-REG','REIM-ADM');

  SELECT COUNT(*) INTO v_quotes_has_obs
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='quotes' AND column_name='observations';

  SELECT COUNT(*) INTO v_cn_has_obs
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='credit_notes' AND column_name='observations';

  SELECT COUNT(*) INTO v_services_has_sort
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='services_catalog' AND column_name='sort_order';

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'services_catalog filas: % (esperado 13)', v_services_count;
  RAISE NOTICE 'services REIM-* nuevas: % (esperado 4)', v_services_reim_new;
  RAISE NOTICE 'quotes.observations existe: % (esperado 1)', v_quotes_has_obs;
  RAISE NOTICE 'credit_notes.observations existe: % (esperado 1)', v_cn_has_obs;
  RAISE NOTICE 'services_catalog.sort_order existe: % (esperado 1)', v_services_has_sort;
END $$;

-- Listado final services_catalog ordenado
SELECT code, name, service_type, sort_order
FROM   services_catalog
WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID
ORDER  BY sort_order NULLS LAST, code;

-- =============================================================================
-- ROLLBACK (descomentar para revertir — PIERDE valores de observations
-- guardados por las abogadas si ya empezaron a usar el campo)
-- =============================================================================
-- BEGIN;
--
-- ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_observations_length_check;
-- ALTER TABLE credit_notes DROP COLUMN IF EXISTS observations;
--
-- ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_observations_length_check;
-- ALTER TABLE quotes DROP COLUMN IF EXISTS observations;
--
-- DELETE FROM services_catalog
-- WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID
--   AND code IN ('REIM-NOT','REIM-TIM','REIM-REG','REIM-ADM');
--
-- ALTER TABLE services_catalog DROP COLUMN IF EXISTS sort_order;
--
-- COMMIT;
-- =============================================================================

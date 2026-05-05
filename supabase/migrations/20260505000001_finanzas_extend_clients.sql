-- =============================================================================
-- FEATURE: Finanzas — extender tabla clients con campos fiscales/cobranza
-- Fecha: 2026-05-05
-- Sprint: Fase 1B — Módulo Finanzas (Batch 1 de 6)
--
-- Contexto:
--   El módulo Finanzas (cotizaciones, facturas, pagos, fideicomiso de gastos
--   de clientes) requiere información fiscal y de cobranza por cliente que el
--   módulo Legal no captura. Este batch extiende public.clients con esos
--   campos sin tocar la lógica existente.
--
--   Convención del proyecto: NO se usan enums nativos de Postgres. Los
--   "enums" se modelan como TEXT + CHECK constraint nombrado, idempotente
--   vía DROP+ADD. Valores de dominio en español; valores 100% técnicos en
--   inglés (ver CLAUDE.md y migration 20260504000001_add_contador_role).
--
-- Tablas afectadas:
--   - public.clients (ALTER, agrega 7 columnas + 4 CHECK constraints)
--
-- Columnas agregadas:
--   tax_id                      TEXT          — identificador fiscal (RUC, cédula, pasaporte, otro)
--   tax_id_type                 TEXT          — tipo del identificador. Valores admitidos:
--                                                 'ruc'        — RUC empresarial panameño
--                                                 'cedula'     — cédula de persona natural panameña
--                                                 'pasaporte'  — pasaporte (extranjeros residentes)
--                                                 'extranjero' — identificación fiscal extranjera
--   billing_address             TEXT          — dirección de facturación (puede diferir de la operativa)
--   default_payment_terms_days  INT           — términos de pago por defecto en días.
--                                                 NULL = usar default del sistema (0 = pago al acto, semántica panameña).
--                                                 Si se define: >= 0.
--                                                 Restricción CHECK: NULL o >= 0.
--   collection_status           TEXT DEFAULT 'normal' — estado de cobranza. Valores admitidos:
--                                                 'normal'   — al día / sin observaciones
--                                                 'atencion' — atrasos leves, monitoreo
--                                                 'critico'  — atrasos significativos, suspender crédito
--   credit_limit                NUMERIC(12,2) — límite de crédito en USD. NULL = sin límite definido.
--                                                 Restricción: NULL o >= 0.
--   qb_legacy_id                TEXT          — ID del cliente en el sistema QuickBooks legacy
--                                                 (para reconciliación durante migración inicial).
--
-- Backfill:
--   Se copia clients.ruc → clients.tax_id donde tax_id es NULL y ruc no.
--   tax_id_type queda NULL (la abogada lo captura manualmente al editar
--   el cliente, ya que no se puede inferir con seguridad si un valor de
--   ruc es RUC empresarial o cédula sin parsing específico de formato PA).
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (proyecto del cliente
--   Integra Legal). Convención del proyecto desde 2026-04-05: las
--   migraciones nuevas se ejecutan a mano, no vía `supabase db push`.
--
-- Reversibilidad:
--   ADD COLUMN no es destructivo. El rollback (al final del archivo) hace
--   DROP COLUMN IF EXISTS de las 7 columnas y descarta el backfill, lo que
--   pierde solo los valores copiados/capturados en tax_id, no el ruc origen.
--   Seguro.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Agregar columnas (idempotente: ADD COLUMN IF NOT EXISTS)
-- -----------------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_id                     TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_id_type                TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_address            TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_payment_terms_days INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS collection_status          TEXT          NOT NULL DEFAULT 'normal';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_limit               NUMERIC(12,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS qb_legacy_id               TEXT;

-- -----------------------------------------------------------------------------
-- 2. CHECK constraints nombrados (idempotente: DROP IF EXISTS + ADD)
--    Patrón estándar del repo (ver 20260504000001_add_contador_role.sql).
-- -----------------------------------------------------------------------------

-- 2.1 tax_id_type IN ('ruc','cedula','pasaporte','extranjero')
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tax_id_type_check;
ALTER TABLE clients
  ADD CONSTRAINT clients_tax_id_type_check
  CHECK (tax_id_type IS NULL OR tax_id_type IN ('ruc', 'cedula', 'pasaporte', 'extranjero'));

-- 2.2 default_payment_terms_days NULL o >= 0
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_default_payment_terms_days_check;
ALTER TABLE clients
  ADD CONSTRAINT clients_default_payment_terms_days_check
  CHECK (default_payment_terms_days IS NULL OR default_payment_terms_days >= 0);

-- 2.3 collection_status IN ('normal','atencion','critico')
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_collection_status_check;
ALTER TABLE clients
  ADD CONSTRAINT clients_collection_status_check
  CHECK (collection_status IN ('normal', 'atencion', 'critico'));

-- 2.4 credit_limit IS NULL OR credit_limit >= 0
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_credit_limit_check;
ALTER TABLE clients
  ADD CONSTRAINT clients_credit_limit_check
  CHECK (credit_limit IS NULL OR credit_limit >= 0);

-- -----------------------------------------------------------------------------
-- 3. Backfill: copiar ruc → tax_id donde proceda.
--    Solo si la columna ruc existe (defensa por si el ambiente no la tiene).
--    Idempotente: el WHERE tax_id IS NULL impide sobrescribir capturas previas.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  ruc_exists BOOLEAN;
  rows_updated INT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'clients'
      AND column_name  = 'ruc'
  ) INTO ruc_exists;

  IF ruc_exists THEN
    UPDATE clients
    SET    tax_id = ruc
    WHERE  tax_id IS NULL
      AND  ruc    IS NOT NULL
      AND  btrim(ruc) <> '';
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RAISE NOTICE 'Backfill clients.ruc -> clients.tax_id: % filas actualizadas.', rows_updated;
  ELSE
    RAISE NOTICE 'Columna clients.ruc no existe en este ambiente. Backfill omitido.';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Listar columnas nuevas en clients (deben aparecer las 7):
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public'
--   AND  table_name   = 'clients'
--   AND  column_name IN ('tax_id', 'tax_id_type', 'billing_address',
--                        'default_payment_terms_days', 'collection_status',
--                        'credit_limit', 'qb_legacy_id')
-- ORDER BY column_name;

-- 2. Listar los 4 CHECK constraints agregados:
-- SELECT conname, pg_get_constraintdef(oid) AS definition
-- FROM   pg_constraint
-- WHERE  conrelid = 'public.clients'::regclass
--   AND  contype  = 'c'
--   AND  conname IN ('clients_tax_id_type_check',
--                    'clients_default_payment_terms_days_check',
--                    'clients_collection_status_check',
--                    'clients_credit_limit_check')
-- ORDER BY conname;

-- 3. Confirmar backfill — debería retornar 0 (todos los ruc ya copiados):
-- SELECT COUNT(*) AS pendientes_backfill
-- FROM   clients
-- WHERE  tax_id IS NULL
--   AND  ruc    IS NOT NULL
--   AND  btrim(ruc) <> '';

-- 4. Distribución de collection_status (deberían estar todos en 'normal'):
-- SELECT collection_status, COUNT(*) FROM clients GROUP BY collection_status;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: el rollback descarta el backfill. Los valores copiados a tax_id
-- se pierden, pero el dato original en clients.ruc permanece intacto. Si se
-- capturaron tax_id manualmente (no vía backfill), también se perderán.
-- =============================================================================
-- BEGIN;
--
-- ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tax_id_type_check;
-- ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_default_payment_terms_days_check;
-- ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_collection_status_check;
-- ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_credit_limit_check;
--
-- ALTER TABLE clients DROP COLUMN IF EXISTS qb_legacy_id;
-- ALTER TABLE clients DROP COLUMN IF EXISTS credit_limit;
-- ALTER TABLE clients DROP COLUMN IF EXISTS collection_status;
-- ALTER TABLE clients DROP COLUMN IF EXISTS default_payment_terms_days;
-- ALTER TABLE clients DROP COLUMN IF EXISTS billing_address;
-- ALTER TABLE clients DROP COLUMN IF EXISTS tax_id_type;
-- ALTER TABLE clients DROP COLUMN IF EXISTS tax_id;
--
-- COMMIT;

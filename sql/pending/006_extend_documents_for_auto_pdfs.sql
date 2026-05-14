-- =============================================================================
-- FEATURE: Extender documents para soportar PDFs auto-generados (cotizaciones)
-- Sprint:  2E.3 (PDF Cotizaciones) — Decisión D3 + D10
-- Fecha:   2026-05-14
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   El Sprint 2E.3 implementa generación on-demand de PDFs para cotizaciones,
--   con cache por hash de contenido (D4). Decisión D3: el PDF se guarda
--   como UNA fila en la tabla `documents` polimórfica (Opción A) con
--   `entity_type='quote'` y `source='auto_quote_pdf'`. Esto da doble
--   visibilidad (sección Documentos del cliente + detalle de la cotización)
--   con una sola copia del archivo en Storage.
--
-- Cambios:
--   1. documents.entity_type CHECK extendido: agrega 'quote' y 'invoice'.
--      ('invoice' queda preparado para Fase 2F futura — D10 future-proof).
--   2. documents.source TEXT NOT NULL DEFAULT 'manual' con CHECK
--      ∈ ('manual','auto_quote_pdf','auto_invoice_pdf').
--      Todas las filas existentes quedan en 'manual' (no hay PDFs auto hoy).
--   3. documents.source_version INT NULL — incrementa en cada regeneración.
--   4. documents.source_generated_at TIMESTAMPTZ NULL — auditoría del último
--      momento de regeneración.
--   5. documents.source_content_hash TEXT NULL — SHA-256 hex del contenido
--      que produjo el PDF actual. Si el contenido del quote cambia, el hash
--      difiere y el endpoint regenera.
--   6. Índice parcial idx_documents_source para acelerar queries por
--      source != 'manual' (búsquedas administrativas).
--   7. Índice parcial idx_documents_quote_entity para acelerar el lookup
--      "¿existe ya un row auto_quote_pdf para este quote_id?".
--
-- Reversibilidad:
--   Todos los ADD son aditivos. El DROP+ADD del CHECK constraint es seguro
--   (no rechaza filas existentes; los valores nuevos solo amplían el dominio).
--   ROLLBACK al final, comentado.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor del proyecto Integra Legal.
--   Convención del repo desde 2026-04-05.
-- =============================================================================

-- =============================================================================
-- PRE-CHECK (informativo)
-- =============================================================================
DO $$
DECLARE
  v_constraint_def TEXT;
  v_total_docs INT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_constraint_def
  FROM pg_constraint
  WHERE conrelid = 'public.documents'::regclass
    AND conname  = 'documents_entity_type_check';

  SELECT COUNT(*) INTO v_total_docs FROM documents;

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Constraint actual: %', COALESCE(v_constraint_def, '(no existe)');
  RAISE NOTICE 'Filas actuales en documents: %', v_total_docs;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extender CHECK de entity_type (agregar 'quote' e 'invoice')
-- -----------------------------------------------------------------------------
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_entity_type_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_entity_type_check
  CHECK (entity_type IN ('client', 'case', 'task', 'comment', 'quote', 'invoice'));

-- -----------------------------------------------------------------------------
-- 2. Agregar columnas (idempotente: ADD COLUMN IF NOT EXISTS)
-- -----------------------------------------------------------------------------
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source_version       INT          NULL;
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source_generated_at  TIMESTAMPTZ  NULL;
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source_content_hash  TEXT         NULL;

-- -----------------------------------------------------------------------------
-- 3. CHECK constraint para source (nombrado, idempotente)
-- -----------------------------------------------------------------------------
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_source_check
  CHECK (source IN ('manual', 'auto_quote_pdf', 'auto_invoice_pdf'));

-- -----------------------------------------------------------------------------
-- 4. Índices parciales
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_documents_source
  ON documents(source)
  WHERE source <> 'manual';

CREATE INDEX IF NOT EXISTS idx_documents_quote_entity
  ON documents(entity_id)
  WHERE entity_type = 'quote';

-- -----------------------------------------------------------------------------
-- 5. Comments para documentación in-DB
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN documents.source IS
  'Origen del adjunto. ''manual'' = subido por usuario via UI. ''auto_quote_pdf'' = PDF generado por el sistema desde una cotización (Sprint 2E.3). ''auto_invoice_pdf'' = preparado para Fase 2F (factura). Sólo los rows con source=''manual'' pueden eliminarse via /api/documents/[id]/delete (gate en app layer).';

COMMENT ON COLUMN documents.source_version IS
  'Incrementa cada vez que el PDF auto-generado se regenera por cambio en el contenido fuente. NULL para source=''manual''.';

COMMENT ON COLUMN documents.source_generated_at IS
  'Timestamp de la última regeneración del PDF auto. NULL para source=''manual''.';

COMMENT ON COLUMN documents.source_content_hash IS
  'SHA-256 hex (64 chars) del payload canónico que generó el PDF actual. Cache: si recalcular este hash sobre el quote vigente coincide con este valor, el endpoint devuelve el signed URL sin regenerar. NULL para source=''manual''.';

COMMIT;

-- =============================================================================
-- POST-CHECK (informativo + verificación visible)
-- =============================================================================
DO $$
DECLARE
  v_constraint_def TEXT;
  v_source_check TEXT;
  v_col_count INT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_constraint_def
  FROM pg_constraint
  WHERE conrelid = 'public.documents'::regclass
    AND conname  = 'documents_entity_type_check';

  SELECT pg_get_constraintdef(oid) INTO v_source_check
  FROM pg_constraint
  WHERE conrelid = 'public.documents'::regclass
    AND conname  = 'documents_source_check';

  SELECT COUNT(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'documents'
    AND column_name  IN ('source', 'source_version', 'source_generated_at', 'source_content_hash');

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'entity_type CHECK actualizado: %', v_constraint_def;
  RAISE NOTICE 'source CHECK creado: %', v_source_check;
  RAISE NOTICE 'Columnas nuevas presentes (esperado 4): %', v_col_count;
END $$;

-- Verificación final visible (debe retornar 4 columnas nuevas)
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'documents'
  AND  column_name  IN ('source', 'source_version', 'source_generated_at', 'source_content_hash')
ORDER  BY column_name;

-- Verificación final visible (debe retornar los 2 índices nuevos)
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  schemaname = 'public'
  AND  tablename  = 'documents'
  AND  indexname  IN ('idx_documents_source', 'idx_documents_quote_entity')
ORDER  BY indexname;

-- Distribución de source (todas deberían ser 'manual' tras aplicar):
SELECT source, COUNT(*) AS filas FROM documents GROUP BY source ORDER BY source;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: el rollback dropea columnas. Si ya hay PDFs auto-generados
-- registrados, se PIERDE el tracking (source/version/hash). Los archivos
-- en Storage NO se borran (limpieza manual aparte si se requiere).
-- =============================================================================
-- BEGIN;
--
-- DROP INDEX IF EXISTS idx_documents_quote_entity;
-- DROP INDEX IF EXISTS idx_documents_source;
--
-- ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_check;
--
-- ALTER TABLE documents DROP COLUMN IF EXISTS source_content_hash;
-- ALTER TABLE documents DROP COLUMN IF EXISTS source_generated_at;
-- ALTER TABLE documents DROP COLUMN IF EXISTS source_version;
-- ALTER TABLE documents DROP COLUMN IF EXISTS source;
--
-- ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_entity_type_check;
-- ALTER TABLE documents
--   ADD CONSTRAINT documents_entity_type_check
--   CHECK (entity_type IN ('client', 'case', 'task', 'comment'));
--
-- COMMIT;

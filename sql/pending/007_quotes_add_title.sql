-- ════════════════════════════════════════════════════════════════════
-- Sprint 2E.3.2: agregar columna title a quotes (OBLIGATORIO)
-- Fecha: 2026-05-14
-- ════════════════════════════════════════════════════════════════════
--
-- Contexto:
--   Hasta ahora las cotizaciones se identificaban solo por COT-NNNNNN, lo
--   que dificulta distinguir cotizaciones del mismo cliente en el listado
--   ("¿cuál era la del trámite migratorio y cuál la del divorcio?").
--
--   Este sprint introduce un campo title obligatorio (3-100 chars) que
--   funciona como descripción corta para el operador. Se muestra en:
--     - Listado de cotizaciones (debajo del nombre del cliente)
--     - Detalle de cotización (debajo del COT-NNNNNN)
--     - Header del PDF generado
--     - Subject + cuerpo del email enviado al cliente
--     - Portal público /cotizacion/[token]
--
-- Migración:
--   1. Pre-check defensivo: aborta si la columna ya existe.
--   2. ADD COLUMN nullable para permitir backfill.
--   3. UPDATE con título auto-generado para cotizaciones existentes
--      ("Cotización <nombre cliente> <DD/MM/YYYY>").
--   4. Verifica que TODAS quedan con título antes de ajustar NOT NULL.
--   5. ALTER ... SET NOT NULL + CHECK length 3-100.
--   6. Índice gin sobre to_tsvector('spanish', title) para búsqueda futura.
--
-- Rollback:
--   Comentado al final. NO ejecutar a menos que sea necesario.
--
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Pre-check defensivo
DO $$
DECLARE c_total INT; c_title_col_exists INT;
BEGIN
  SELECT COUNT(*) INTO c_total FROM quotes;
  SELECT COUNT(*) INTO c_title_col_exists
    FROM information_schema.columns
    WHERE table_name='quotes' AND column_name='title';

  RAISE NOTICE 'PRE: % cotizaciones total, columna title existe: %',
    c_total, c_title_col_exists;

  IF c_title_col_exists > 0 THEN
    RAISE EXCEPTION 'ABORT: columna title YA existe';
  END IF;
END $$;

-- Agregar columna nullable (para hacer backfill)
ALTER TABLE quotes ADD COLUMN title TEXT;

-- Backfill: cotizaciones existentes reciben título automático
UPDATE quotes
SET title = 'Cotización ' || COALESCE(
  (SELECT name FROM clients WHERE clients.id = quotes.client_id LIMIT 1),
  'sin nombre'
) || ' ' || TO_CHAR(issue_date, 'DD/MM/YYYY')
WHERE title IS NULL;

-- Verificar que TODAS tienen título
DO $$
DECLARE c_null INT;
BEGIN
  SELECT COUNT(*) INTO c_null FROM quotes WHERE title IS NULL;
  IF c_null > 0 THEN
    RAISE EXCEPTION 'ABORT: % cotizaciones quedaron sin título', c_null;
  END IF;
END $$;

-- Ahora hacer NOT NULL
ALTER TABLE quotes ALTER COLUMN title SET NOT NULL;

-- CHECK de longitud 3-100 chars
ALTER TABLE quotes ADD CONSTRAINT quotes_title_length
  CHECK (char_length(title) BETWEEN 3 AND 100);

-- Índice para búsqueda futura (opcional pero barato)
CREATE INDEX idx_quotes_title_search ON quotes USING gin(to_tsvector('spanish', title));

COMMIT;

-- Verificación post-aplicación
SELECT 'total_cotizaciones' AS info, COUNT(*)::text AS valor FROM quotes
UNION ALL
SELECT 'cotizaciones_con_title', COUNT(*)::text FROM quotes WHERE title IS NOT NULL
UNION ALL
SELECT 'columna_title_NOT_NULL',
  CASE WHEN is_nullable = 'NO' THEN 'SI (correcto)' ELSE 'NO (BUG)' END
  FROM information_schema.columns
  WHERE table_name='quotes' AND column_name='title'
UNION ALL
SELECT 'sample_titles', STRING_AGG(LEFT(title, 50), ' | ' ORDER BY created_at DESC)::text
  FROM (SELECT title, created_at FROM quotes ORDER BY created_at DESC LIMIT 3) AS sub;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK si hay problema (NO ejecutar a menos que sea necesario):
-- ALTER TABLE quotes DROP CONSTRAINT quotes_title_length;
-- DROP INDEX IF EXISTS idx_quotes_title_search;
-- ALTER TABLE quotes DROP COLUMN title;
-- ════════════════════════════════════════════════════════════════════

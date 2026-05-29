-- =============================================================================
-- 016 — quotes.source_quote_id (Sprint 2E.4 — feature Duplicar cotización)
-- Fecha: 2026-05-29
--
-- Agrega columna `source_quote_id UUID NULL` a `quotes`. Referencia al quote
-- original del cual fue duplicado.
--
-- Uso:
--   - Banner amarillo en el editor: mientras la duplicada conserve el cliente
--     del origen (sin cambiar), se muestra "verificá cliente y fechas".
--   - Trazabilidad histórica (de dónde salió esta cotización).
--
-- Diseño:
--   - Nullable: las cotizaciones existentes y las creadas desde cero quedan
--     con NULL — no rompe nada.
--   - ON DELETE SET NULL: si el origen se elimina (solo posible si era
--     borrador o cancelada_pre_envio, ver T6-quote), la duplicada no se
--     rompe — simplemente pierde la referencia.
--   - Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- Aplicación: Oliver lo ejecuta manualmente en Supabase SQL Editor (dev
-- primero, después prod). Sin breaking changes.
-- =============================================================================

BEGIN;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS source_quote_id UUID NULL
    REFERENCES quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_source_quote_id
  ON quotes(tenant_id, source_quote_id)
  WHERE source_quote_id IS NOT NULL;

COMMENT ON COLUMN quotes.source_quote_id IS
  'UUID del quote del cual se duplicó esta cotización (Sprint 2E.4). NULL = creada desde cero.';

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'quotes' AND column_name = 'source_quote_id';

COMMIT;

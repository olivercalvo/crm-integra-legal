-- =============================================================================
-- FEATURE: Finanzas — cotizaciones (quotes + quote_lines)
-- Fecha: 2026-05-05
-- Sprint: Fase 1B — Módulo Finanzas (Batch 3a de 6)
--
-- Contexto:
--   Primer documento financiero del flujo: cotización propuesta al cliente
--   antes de iniciar trabajo. Si se acepta → puede convertirse en factura
--   (invoices.quote_id, ver Batch 3b).
--
--   Decisiones congeladas D1-D9 (ver mensaje de planificación):
--     D3: status ∈ {borrador, enviada, aceptada, rechazada, expirada}.
--         Transiciones validadas por trigger en Batch 3e (T1).
--     D6: líneas con generated columns (subtotal/tax_amount/line_total).
--         tax_rate es snapshot DECIMAL idéntico a tax_codes.rate (0.0700
--         para 7%). La app guarda tax_rate = (SELECT rate FROM tax_codes
--         WHERE id = ?) sin conversión. La conversión a "%" es solo en
--         presentación UI.
--     D8: solo borradores se pueden eliminar (validado por trigger T6 en 3e).
--     D9: RLS solo tenant_isolation, igual que catálogos y Legal.
--
-- Tablas creadas:
--   1. quotes        (cabecera)
--   2. quote_lines   (detalle, FK CASCADE a quotes)
--
-- NO incluye en este archivo:
--   - Triggers de status_transition / immutability / no_delete / recalc_totals
--     → todos van en 3e una vez creadas las 8 tablas (a-d).
--   - Función create_quote_with_lines (transacción atómica) → Fase 2.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor. Convención del proyecto.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. QUOTES (cabecera de cotización)
-- =============================================================================
DROP TABLE IF EXISTS quote_lines CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;

CREATE TABLE quotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL DEFAULT public.get_tenant_id()
                       REFERENCES tenants(id) ON DELETE CASCADE,
  quote_number    TEXT NOT NULL,
  client_id       UUID NOT NULL REFERENCES clients(id),
  case_id         UUID NULL REFERENCES cases(id),
  issue_date      DATE NOT NULL,
  valid_until     DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'borrador',
  currency        TEXT NOT NULL DEFAULT 'USD',
  subtotal_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes           TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NULL REFERENCES public.users(id),

  CONSTRAINT quotes_status_check
    CHECK (status IN ('borrador', 'enviada', 'aceptada', 'rechazada', 'expirada')),
  CONSTRAINT quotes_currency_check
    CHECK (currency = 'USD'),
  CONSTRAINT quotes_valid_until_check
    CHECK (valid_until >= issue_date),
  CONSTRAINT quotes_totals_non_negative_check
    CHECK (subtotal_total >= 0 AND tax_total >= 0 AND grand_total >= 0),
  CONSTRAINT quotes_tenant_number_unique
    UNIQUE (tenant_id, quote_number)
);

CREATE INDEX idx_quotes_tenant       ON quotes(tenant_id);
CREATE INDEX idx_quotes_client       ON quotes(tenant_id, client_id);
CREATE INDEX idx_quotes_case         ON quotes(tenant_id, case_id) WHERE case_id IS NOT NULL;
CREATE INDEX idx_quotes_status       ON quotes(tenant_id, status);
CREATE INDEX idx_quotes_issue_date   ON quotes(tenant_id, issue_date DESC);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotes_tenant_isolation ON quotes;
CREATE POLICY quotes_tenant_isolation ON quotes
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_quotes_updated_at ON quotes;
CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. QUOTE_LINES (detalle de cotización)
-- -----------------------------------------------------------------------------
-- Generated columns:
--   subtotal   = quantity * unit_price
--   tax_amount = quantity * unit_price * tax_rate
--   line_total = quantity * unit_price * (1 + tax_rate)
--
-- tax_rate es decimal (0.0700 = 7%), idéntico a tax_codes.rate. La app
-- snapshot el valor del catálogo sin conversión.
--
-- service_id es NULLABLE para permitir items custom no catalogados.
-- tax_code_id es referencia/audit; el cálculo real usa tax_rate cacheado
-- (ver D6, preserva integridad histórica si DGI cambia los rates).
-- =============================================================================
CREATE TABLE quote_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL DEFAULT public.get_tenant_id()
                    REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id     UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  line_order   INT NOT NULL,
  service_id   UUID NULL REFERENCES services_catalog(id),
  description  TEXT NOT NULL,
  quantity     NUMERIC(10,2) NOT NULL,
  unit_price   NUMERIC(12,2) NOT NULL,
  tax_code     TEXT NOT NULL,
  tax_rate     NUMERIC(6,4) NOT NULL,
  tax_code_id  UUID NULL REFERENCES tax_codes(id),
  subtotal     NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  tax_amount   NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price * tax_rate) STORED,
  line_total   NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price * (1 + tax_rate)) STORED,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NULL REFERENCES public.users(id),

  CONSTRAINT quote_lines_quantity_positive_check
    CHECK (quantity > 0),
  CONSTRAINT quote_lines_unit_price_non_negative_check
    CHECK (unit_price >= 0),
  CONSTRAINT quote_lines_tax_rate_range_check
    CHECK (tax_rate >= 0 AND tax_rate <= 1),
  CONSTRAINT quote_lines_line_order_non_negative_check
    CHECK (line_order >= 0)
);

CREATE INDEX idx_quote_lines_tenant     ON quote_lines(tenant_id);
CREATE INDEX idx_quote_lines_quote      ON quote_lines(quote_id, line_order);
CREATE INDEX idx_quote_lines_service    ON quote_lines(tenant_id, service_id) WHERE service_id IS NOT NULL;

ALTER TABLE quote_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_lines_tenant_isolation ON quote_lines;
CREATE POLICY quote_lines_tenant_isolation ON quote_lines
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_quote_lines_updated_at ON quote_lines;
CREATE TRIGGER trg_quote_lines_updated_at
  BEFORE UPDATE ON quote_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Tablas existen, RLS habilitado:
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relname IN ('quotes', 'quote_lines')
ORDER BY c.relname;
-- Esperado: 2 filas, rls_enabled=true en ambas.

-- 2. Counts iniciales (tablas vacías):
SELECT 'quotes' AS tbl, COUNT(*) FROM quotes
UNION ALL
SELECT 'quote_lines', COUNT(*) FROM quote_lines;
-- Esperado: 0 en ambas.

-- 3. Sample row con generated columns (smoke test, REQUIERE primero un quote
--    con FK válido; comentado para no contaminar prod. Descomentá y ajustá
--    los UUIDs si querés testear localmente):
-- WITH q AS (
--   INSERT INTO quotes (tenant_id, quote_number, client_id, issue_date, valid_until)
--   VALUES ('a0000000-0000-0000-0000-000000000001', 'COT-TEST', '<client_id>', CURRENT_DATE, CURRENT_DATE + 30)
--   RETURNING id
-- )
-- INSERT INTO quote_lines (quote_id, line_order, description, quantity, unit_price, tax_code, tax_rate)
-- SELECT id, 0, 'Smoke test', 2, 100.00, 'ITBMS_7', 0.0700 FROM q
-- RETURNING quantity, unit_price, tax_rate, subtotal, tax_amount, line_total;
-- Esperado: subtotal=200.00, tax_amount=14.00, line_total=214.00.

-- 4. Confirmar CHECK constraints nombrados:
SELECT conname
FROM   pg_constraint
WHERE  conrelid IN ('public.quotes'::regclass, 'public.quote_lines'::regclass)
  AND  contype = 'c'
ORDER BY conname;
-- Esperado: quotes_currency_check, quotes_status_check, quotes_totals_non_negative_check,
--           quotes_valid_until_check, quote_lines_line_order_non_negative_check,
--           quote_lines_quantity_positive_check, quote_lines_tax_rate_range_check,
--           quote_lines_unit_price_non_negative_check.

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS quote_lines CASCADE;
--   DROP TABLE IF EXISTS quotes CASCADE;
-- COMMIT;
-- =============================================================================

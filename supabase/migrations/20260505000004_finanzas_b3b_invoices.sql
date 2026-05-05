-- =============================================================================
-- FEATURE: Finanzas — facturas (invoices + invoice_lines)
-- Fecha: 2026-05-05
-- Sprint: Fase 1B — Módulo Finanzas (Batch 3b de 6)
--
-- Contexto:
--   Documento contable principal. Una sola tabla cubre HONORARIOS y REEMBOLSO
--   (decisión D1) discriminado por invoice_kind. La numeración la maneja la
--   app vía get_next_sequence_number(tenant, 'invoice_hon' | 'invoice_reim')
--   y formatea el string ('FAC-HON-000454' o 'FAC-REI-000038').
--
--   Decisiones congeladas D1-D9:
--     D1: invoice_kind ∈ {HONORARIOS, REEMBOLSO} en la misma tabla.
--     D2: inmutabilidad post-emisión por trigger (T4 en Batch 3e).
--     D3: status ∈ {borrador, emitida, parcialmente_pagada, pagada, anulada,
--                   cancelada_pre_emision}. Transiciones validadas (T2 en 3e).
--     D6: invoice_lines con generated columns idénticas a quote_lines.
--     D7: quote_id UUID NULL FK opcional a quotes.
--     D8: solo borradores se pueden eliminar (T6 en 3e).
--
--   amount_paid: lo recalcula trigger T7 (3e) desde payment_applications.
--   balance_due: GENERATED column (grand_total - amount_paid). Se actualiza
--     automáticamente cuando T7 modifica amount_paid.
--
-- Tablas creadas:
--   1. invoices       (cabecera)
--   2. invoice_lines  (detalle, FK CASCADE a invoices)
--
-- NO incluye en este archivo:
--   - Triggers de status_transition / immutability / no_delete / recalc_*
--     → Batch 3e.
--   - Función create_invoice_with_lines (transacción atómica) → Fase 2.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. INVOICES (cabecera de factura)
-- -----------------------------------------------------------------------------
-- amount_paid: NUMERIC(12,2) DEFAULT 0. Lo mantiene trigger T7 (en 3e) desde
--   payment_applications. NO actualizar manualmente desde la app.
--
-- balance_due: GENERATED ALWAYS AS (grand_total - amount_paid) STORED. Se
--   recalcula automáticamente. Puede ser negativo si amount_paid > grand_total
--   (sobrepago) — eso es válido y la app debe surfacearlo en aging.
--
-- due_date: la app la calcula al INSERT usando issue_date +
--   clients.default_payment_terms_days. La DB no la calcula (decisión de
--   simplicidad: política de plazos puede cambiar y queremos snapshot).
-- =============================================================================
DROP TABLE IF EXISTS invoice_lines CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL DEFAULT public.get_tenant_id()
                       REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number  TEXT NOT NULL,
  invoice_kind    TEXT NOT NULL,
  quote_id        UUID NULL REFERENCES quotes(id) ON DELETE SET NULL,
  client_id       UUID NOT NULL REFERENCES clients(id),
  case_id         UUID NULL REFERENCES cases(id),
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'borrador',
  currency        TEXT NOT NULL DEFAULT 'USD',
  subtotal_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due     NUMERIC(12,2) GENERATED ALWAYS AS (grand_total - amount_paid) STORED,
  notes           TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NULL REFERENCES public.users(id),

  CONSTRAINT invoices_status_check
    CHECK (status IN ('borrador', 'emitida', 'parcialmente_pagada',
                      'pagada', 'anulada', 'cancelada_pre_emision')),
  CONSTRAINT invoices_invoice_kind_check
    CHECK (invoice_kind IN ('HONORARIOS', 'REEMBOLSO')),
  CONSTRAINT invoices_currency_check
    CHECK (currency = 'USD'),
  CONSTRAINT invoices_due_date_check
    CHECK (due_date >= issue_date),
  CONSTRAINT invoices_totals_non_negative_check
    CHECK (subtotal_total >= 0 AND tax_total >= 0 AND grand_total >= 0),
  CONSTRAINT invoices_amount_paid_non_negative_check
    CHECK (amount_paid >= 0),
  CONSTRAINT invoices_tenant_number_unique
    UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX idx_invoices_tenant      ON invoices(tenant_id);
CREATE INDEX idx_invoices_client      ON invoices(tenant_id, client_id);
CREATE INDEX idx_invoices_case        ON invoices(tenant_id, case_id) WHERE case_id IS NOT NULL;
CREATE INDEX idx_invoices_quote       ON invoices(tenant_id, quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX idx_invoices_status      ON invoices(tenant_id, status);
CREATE INDEX idx_invoices_kind        ON invoices(tenant_id, invoice_kind);
CREATE INDEX idx_invoices_issue_date  ON invoices(tenant_id, issue_date DESC);
CREATE INDEX idx_invoices_due_date    ON invoices(tenant_id, due_date);
CREATE INDEX idx_invoices_open        ON invoices(tenant_id, status, due_date)
  WHERE status IN ('emitida', 'parcialmente_pagada');

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_isolation ON invoices;
CREATE POLICY invoices_tenant_isolation ON invoices
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. INVOICE_LINES (detalle de factura)
-- -----------------------------------------------------------------------------
-- Estructura idéntica a quote_lines (D6). Mismo patrón de generated columns
-- y snapshot de tax_rate (decimal idéntico a tax_codes.rate).
--
-- IMPORTANTE: la inmutabilidad indirecta de invoice_lines tras emitir la
-- factura se enforza vía cadena de triggers:
--   modificar invoice_lines → T8 (3e) UPDATE invoices.subtotal_total/tax_total/
--   grand_total → T4 (3e) detecta cambio en columnas restringidas para
--   status no-borrador → RAISE EXCEPTION → rollback de la modificación de
--   la línea. Ver comentarios extensos en 3e.
-- =============================================================================
CREATE TABLE invoice_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL DEFAULT public.get_tenant_id()
                    REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
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

  CONSTRAINT invoice_lines_quantity_positive_check
    CHECK (quantity > 0),
  CONSTRAINT invoice_lines_unit_price_non_negative_check
    CHECK (unit_price >= 0),
  CONSTRAINT invoice_lines_tax_rate_range_check
    CHECK (tax_rate >= 0 AND tax_rate <= 1),
  CONSTRAINT invoice_lines_line_order_non_negative_check
    CHECK (line_order >= 0)
);

CREATE INDEX idx_invoice_lines_tenant   ON invoice_lines(tenant_id);
CREATE INDEX idx_invoice_lines_invoice  ON invoice_lines(invoice_id, line_order);
CREATE INDEX idx_invoice_lines_service  ON invoice_lines(tenant_id, service_id) WHERE service_id IS NOT NULL;

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_lines_tenant_isolation ON invoice_lines;
CREATE POLICY invoice_lines_tenant_isolation ON invoice_lines
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_invoice_lines_updated_at ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_updated_at
  BEFORE UPDATE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relname IN ('invoices', 'invoice_lines')
ORDER BY c.relname;
-- Esperado: 2 filas, rls_enabled=true.

SELECT 'invoices' AS tbl, COUNT(*) FROM invoices
UNION ALL
SELECT 'invoice_lines', COUNT(*) FROM invoice_lines;
-- Esperado: 0 en ambas.

-- Confirmar que balance_due es generated:
SELECT column_name, is_generated, generation_expression
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name = 'invoices'
  AND  column_name = 'balance_due';
-- Esperado: is_generated='ALWAYS', generation_expression contiene 'grand_total - amount_paid'.

-- CHECKs nombrados:
SELECT conname
FROM   pg_constraint
WHERE  conrelid IN ('public.invoices'::regclass, 'public.invoice_lines'::regclass)
  AND  contype = 'c'
ORDER BY conname;

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS invoice_lines CASCADE;
--   DROP TABLE IF EXISTS invoices CASCADE;
-- COMMIT;
-- =============================================================================

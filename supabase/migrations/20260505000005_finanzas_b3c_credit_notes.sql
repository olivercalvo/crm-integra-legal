-- =============================================================================
-- FEATURE: Finanzas — notas de crédito (credit_notes + credit_note_lines)
-- Fecha: 2026-05-05
-- Sprint: Fase 1B — Módulo Finanzas (Batch 3c de 6)
--
-- Contexto:
--   Documento que anula total o parcialmente una factura emitida. SIEMPRE
--   referencia una factura (invoice_id NOT NULL). Una vez emitida, es
--   inmutable y NO se puede eliminar (D8: credit_notes nunca se eliminan).
--
--   Decisiones congeladas D1-D9:
--     D3: status valor único 'emitida' (sin transiciones).
--     D4: con líneas (credit_note_lines). FK opcional invoice_line_id NULL
--         para permitir líneas sin trazabilidad a línea específica de la
--         factura original (ej: descuento global o ajuste no atribuible).
--     D6: líneas con generated columns idénticas a invoice_lines.
--     D8: credit_notes NUNCA se eliminan (T6 en 3e rechaza siempre).
--
--   Inmutabilidad post-creación: T5 (3e) rechaza cualquier UPDATE a columnas
--   de contenido. PERO permite UPDATE a subtotal_total/tax_total/grand_total/
--   updated_at, porque T8 (recalc) DEBE poder poblar los totales cuando se
--   insertan las líneas iniciales en la misma transacción de creación. Ver
--   ambigüedad #2 en el reporte final.
--
-- Tablas creadas:
--   1. credit_notes        (cabecera)
--   2. credit_note_lines   (detalle, FK CASCADE a credit_notes)
--
-- NO incluye en este archivo:
--   - Triggers de immutability / no_delete / recalc_totals → Batch 3e.
--   - Función create_credit_note_with_lines (transacción atómica) → Fase 2.
--   - Lógica que ajusta contablemente la factura origen (anulación contable
--     no implica modificar la factura — la factura sigue 'emitida'/'pagada';
--     la NC vive en su propio registro). Reportes resuelven la neta en query.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CREDIT_NOTES (cabecera de nota de crédito)
-- -----------------------------------------------------------------------------
-- client_id está DENORMALIZADO (también podría inferirse vía invoice_id ->
-- invoices.client_id). Se replica para queries directas de "NCs por cliente"
-- sin JOIN, y como salvaguarda: aunque ON DELETE de invoices está bloqueado
-- por T6, si en el futuro se permitiera el unlink, las NCs siguen sabiendo
-- a qué cliente pertenecen.
--
-- reason es NOT NULL: una NC sin motivo explícito es auditable problemática.
-- =============================================================================
DROP TABLE IF EXISTS credit_note_lines CASCADE;
DROP TABLE IF EXISTS credit_notes CASCADE;

CREATE TABLE credit_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL DEFAULT public.get_tenant_id()
                           REFERENCES tenants(id) ON DELETE CASCADE,
  credit_note_number  TEXT NOT NULL,
  invoice_id          UUID NOT NULL REFERENCES invoices(id),
  client_id           UUID NOT NULL REFERENCES clients(id),
  issue_date          DATE NOT NULL,
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'emitida',
  currency            TEXT NOT NULL DEFAULT 'USD',
  subtotal_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID NULL REFERENCES public.users(id),

  CONSTRAINT credit_notes_status_check
    CHECK (status = 'emitida'),
  CONSTRAINT credit_notes_currency_check
    CHECK (currency = 'USD'),
  CONSTRAINT credit_notes_totals_non_negative_check
    CHECK (subtotal_total >= 0 AND tax_total >= 0 AND grand_total >= 0),
  CONSTRAINT credit_notes_reason_not_empty_check
    CHECK (length(trim(reason)) > 0),
  CONSTRAINT credit_notes_tenant_number_unique
    UNIQUE (tenant_id, credit_note_number)
);

CREATE INDEX idx_credit_notes_tenant      ON credit_notes(tenant_id);
CREATE INDEX idx_credit_notes_invoice     ON credit_notes(tenant_id, invoice_id);
CREATE INDEX idx_credit_notes_client      ON credit_notes(tenant_id, client_id);
CREATE INDEX idx_credit_notes_issue_date  ON credit_notes(tenant_id, issue_date DESC);

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_notes_tenant_isolation ON credit_notes;
CREATE POLICY credit_notes_tenant_isolation ON credit_notes
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_credit_notes_updated_at ON credit_notes;
CREATE TRIGGER trg_credit_notes_updated_at
  BEFORE UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. CREDIT_NOTE_LINES (detalle de nota de crédito)
-- -----------------------------------------------------------------------------
-- Mismo patrón que invoice_lines + campo extra invoice_line_id NULL
-- (trazabilidad opcional a línea específica de la factura original, D4).
--
-- ON DELETE SET NULL en invoice_line_id: si un día la factura de origen
-- fuera modificada (en estado borrador → pero T6 no permite borrar
-- facturas no-borrador, así que en la práctica esto no ocurre), el
-- registro histórico de la NC sobrevive con el link en NULL.
-- =============================================================================
CREATE TABLE credit_note_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL DEFAULT public.get_tenant_id()
                        REFERENCES tenants(id) ON DELETE CASCADE,
  credit_note_id   UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_line_id  UUID NULL REFERENCES invoice_lines(id) ON DELETE SET NULL,
  line_order       INT NOT NULL,
  service_id       UUID NULL REFERENCES services_catalog(id),
  description      TEXT NOT NULL,
  quantity         NUMERIC(10,2) NOT NULL,
  unit_price       NUMERIC(12,2) NOT NULL,
  tax_code         TEXT NOT NULL,
  tax_rate         NUMERIC(6,4) NOT NULL,
  tax_code_id      UUID NULL REFERENCES tax_codes(id),
  subtotal         NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  tax_amount       NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price * tax_rate) STORED,
  line_total       NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price * (1 + tax_rate)) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID NULL REFERENCES public.users(id),

  CONSTRAINT credit_note_lines_quantity_positive_check
    CHECK (quantity > 0),
  CONSTRAINT credit_note_lines_unit_price_non_negative_check
    CHECK (unit_price >= 0),
  CONSTRAINT credit_note_lines_tax_rate_range_check
    CHECK (tax_rate >= 0 AND tax_rate <= 1),
  CONSTRAINT credit_note_lines_line_order_non_negative_check
    CHECK (line_order >= 0)
);

CREATE INDEX idx_credit_note_lines_tenant       ON credit_note_lines(tenant_id);
CREATE INDEX idx_credit_note_lines_credit_note  ON credit_note_lines(credit_note_id, line_order);
CREATE INDEX idx_credit_note_lines_invoice_line ON credit_note_lines(tenant_id, invoice_line_id) WHERE invoice_line_id IS NOT NULL;
CREATE INDEX idx_credit_note_lines_service      ON credit_note_lines(tenant_id, service_id) WHERE service_id IS NOT NULL;

ALTER TABLE credit_note_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_note_lines_tenant_isolation ON credit_note_lines;
CREATE POLICY credit_note_lines_tenant_isolation ON credit_note_lines
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_credit_note_lines_updated_at ON credit_note_lines;
CREATE TRIGGER trg_credit_note_lines_updated_at
  BEFORE UPDATE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relname IN ('credit_notes', 'credit_note_lines')
ORDER BY c.relname;
-- Esperado: 2 filas, rls_enabled=true.

SELECT 'credit_notes' AS tbl, COUNT(*) FROM credit_notes
UNION ALL
SELECT 'credit_note_lines', COUNT(*) FROM credit_note_lines;
-- Esperado: 0 en ambas.

-- CHECKs nombrados:
SELECT conname
FROM   pg_constraint
WHERE  conrelid IN ('public.credit_notes'::regclass, 'public.credit_note_lines'::regclass)
  AND  contype = 'c'
ORDER BY conname;

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS credit_note_lines CASCADE;
--   DROP TABLE IF EXISTS credit_notes CASCADE;
-- COMMIT;
-- =============================================================================

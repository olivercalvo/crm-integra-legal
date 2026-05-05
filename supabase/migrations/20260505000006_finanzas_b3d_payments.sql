-- =============================================================================
-- FEATURE: Finanzas — pagos (payments + payment_applications)
-- Fecha: 2026-05-05
-- Sprint: Fase 1B — Módulo Finanzas (Batch 3d de 6)
--
-- Contexto:
--   Pago recibido de un cliente. Un pago puede aplicarse a una o varias
--   facturas (relación N:M vía payment_applications). La aplicación es
--   ESPECÍFICA, no FIFO (D5): la app decide qué facturas se aplican y
--   por cuánto. La DB no infiere automáticamente.
--
--   Decisiones congeladas D1-D9:
--     D3: payment.status ∈ {registrado, conciliado, anulado}.
--         Transiciones: registrado→{conciliado|anulado} (T3 en 3e).
--     D5: payment_applications con UNIQUE (payment_id, invoice_id) — un
--         pago se aplica como máximo UNA línea por factura. Si el usuario
--         quiere "dos aplicaciones" a la misma factura, suma los montos.
--     D8: solo pagos en status 'registrado' se pueden eliminar (T6 en 3e).
--
--   amount_unapplied: implementado como columna NUMERIC mantenida por
--     trigger T7 (3e), NO como GENERATED column. Razón: PostgreSQL no
--     permite subqueries en STORED GENERATED COLUMNS (la expresión debe
--     ser IMMUTABLE y solo referenciar columnas de la misma fila). El
--     trigger se dispara desde payments (INSERT) y desde payment_applications
--     (INSERT/UPDATE/DELETE) — ver 3e.
--
-- Tablas creadas:
--   1. payments              (pagos recibidos)
--   2. payment_applications  (N:M pago↔factura)
--
-- NO incluye en este archivo:
--   - Triggers de status_transition / no_delete / recalc_amount_paid /
--     recalc_amount_unapplied → Batch 3e.
--   - Función create_payment_with_applications (transacción atómica) → Fase 2.
--   - Trust account / fideicomiso → Batch 4.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. PAYMENTS (pagos recibidos)
-- -----------------------------------------------------------------------------
-- payment_number: NULLABLE (no todos los pagos llevan número correlativo;
--   ej: depósitos directos sin recibo formal).
--
-- amount_unapplied: lo mantiene el trigger T7. Inicializado en 0 al INSERT
--   y actualizado por trigger BEFORE INSERT (3e) a igualar amount.
--
-- method: TEXT con CHECK. Valores cubren las formas de pago panameñas
--   estándar. 'ach' separado de 'transferencia' porque ACH local tiene
--   conciliación diferente a wire/transferencia bancaria internacional.
-- =============================================================================
DROP TABLE IF EXISTS payment_applications CASCADE;
DROP TABLE IF EXISTS payments CASCADE;

CREATE TABLE payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL DEFAULT public.get_tenant_id()
                         REFERENCES tenants(id) ON DELETE CASCADE,
  payment_number    TEXT NULL,
  client_id         UUID NOT NULL REFERENCES clients(id),
  payment_date      DATE NOT NULL,
  amount            NUMERIC(12,2) NOT NULL,
  amount_unapplied  NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'USD',
  method            TEXT NOT NULL,
  reference         TEXT NULL,
  status            TEXT NOT NULL DEFAULT 'registrado',
  notes             TEXT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID NULL REFERENCES public.users(id),

  CONSTRAINT payments_status_check
    CHECK (status IN ('registrado', 'conciliado', 'anulado')),
  CONSTRAINT payments_method_check
    CHECK (method IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'ach', 'otro')),
  CONSTRAINT payments_currency_check
    CHECK (currency = 'USD'),
  CONSTRAINT payments_amount_positive_check
    CHECK (amount > 0),
  CONSTRAINT payments_amount_unapplied_range_check
    CHECK (amount_unapplied >= 0 AND amount_unapplied <= amount)
);

CREATE INDEX idx_payments_tenant         ON payments(tenant_id);
CREATE INDEX idx_payments_client         ON payments(tenant_id, client_id);
CREATE INDEX idx_payments_status         ON payments(tenant_id, status);
CREATE INDEX idx_payments_date           ON payments(tenant_id, payment_date DESC);
CREATE INDEX idx_payments_with_balance   ON payments(tenant_id, client_id)
  WHERE amount_unapplied > 0 AND status != 'anulado';

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_tenant_isolation ON payments;
CREATE POLICY payments_tenant_isolation ON payments
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 2. PAYMENT_APPLICATIONS (N:M pago ↔ factura)
-- -----------------------------------------------------------------------------
-- UNIQUE (payment_id, invoice_id): un pago aplica máximo UNA fila por
-- factura (D5). El monto aplicado se suma en una sola fila.
--
-- ON DELETE CASCADE en payment_id: si se elimina un pago (solo permitido
-- en status='registrado' por T6), las aplicaciones desaparecen con él, y
-- T7 recalcula amount_paid de las facturas afectadas vía el AFTER trigger
-- (que dispara con OLD en DELETE).
--
-- ON DELETE NO ACTION en invoice_id (default): no se puede borrar una
-- factura que tenga pagos aplicados. T6 además rechaza eliminar facturas
-- no-borrador, así que la combinación es coherente.
--
-- amount_applied > 0: NO se permiten aplicaciones de monto cero (sería un
-- registro fantasma sin efecto contable).
--
-- NOTA: NO hay CHECK aquí que valide "SUM(amount_applied) <= payments.amount"
-- porque CHECK no puede consultar otras filas. Esa validación la enforza la
-- combinación de:
--   - constraint payments_amount_unapplied_range_check (>= 0)
--   - trigger T7 que recalcula amount_unapplied = amount - SUM(applied) y
--     fallaría el CHECK al intentar dejarlo negativo.
-- =============================================================================
CREATE TABLE payment_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL DEFAULT public.get_tenant_id()
                       REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id      UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id      UUID NOT NULL REFERENCES invoices(id),
  amount_applied  NUMERIC(12,2) NOT NULL,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by      UUID NULL REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NULL REFERENCES public.users(id),

  CONSTRAINT payment_applications_amount_positive_check
    CHECK (amount_applied > 0),
  CONSTRAINT payment_applications_payment_invoice_unique
    UNIQUE (payment_id, invoice_id)
);

CREATE INDEX idx_payment_applications_tenant   ON payment_applications(tenant_id);
CREATE INDEX idx_payment_applications_payment  ON payment_applications(payment_id);
CREATE INDEX idx_payment_applications_invoice  ON payment_applications(invoice_id);

ALTER TABLE payment_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_applications_tenant_isolation ON payment_applications;
CREATE POLICY payment_applications_tenant_isolation ON payment_applications
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_payment_applications_updated_at ON payment_applications;
CREATE TRIGGER trg_payment_applications_updated_at
  BEFORE UPDATE ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relname IN ('payments', 'payment_applications')
ORDER BY c.relname;
-- Esperado: 2 filas, rls_enabled=true.

SELECT 'payments' AS tbl, COUNT(*) FROM payments
UNION ALL
SELECT 'payment_applications', COUNT(*) FROM payment_applications;
-- Esperado: 0 en ambas.

-- Confirmar UNIQUE (payment_id, invoice_id):
SELECT conname, pg_get_constraintdef(oid)
FROM   pg_constraint
WHERE  conrelid = 'public.payment_applications'::regclass
  AND  contype = 'u'
ORDER BY conname;
-- Esperado: payment_applications_payment_invoice_unique UNIQUE (payment_id, invoice_id).

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS payment_applications CASCADE;
--   DROP TABLE IF EXISTS payments CASCADE;
-- COMMIT;
-- =============================================================================

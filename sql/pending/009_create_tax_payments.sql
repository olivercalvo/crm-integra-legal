-- =============================================================================
-- FEATURE: tax_payments — pagos hechos a DGI por ITBMS — Sprint 2F Parte 1B
-- Sprint:  2F (Reportes Contador)
-- Fecha:   2026-05-15
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   El VAT Summary (Sprint 2F Parte 3) replica las 10 líneas estándar de
--   QuickBooks. La línea 9 ("Tax payments made this period") representa los
--   pagos que el bufete hace a la DGI por concepto de ITBMS, y resta del
--   balance acumulado para llegar a la línea 10 ("Total amount due").
--
--   Modelo contable (D4): cada fila en esta tabla representa un débito a
--   "2105 ITBMS por Pagar". Antes del pago, el saldo de 2105 acumula los
--   créditos de facturas HON con ITBMS menos los débitos por ITBMS
--   recuperable en gastos. El pago a DGI cierra el ciclo del período.
--
--   No representa un asiento contable completo (en Sprint futuro habrá
--   journal_entries con débito y crédito). Por ahora es la fuente de la
--   línea 9 del reporte.
--
-- Cambios:
--   1. CREATE TABLE tax_payments con:
--      - PK uuid, FK created_by → users(id) ON DELETE SET NULL
--      - amount NUMERIC(12,2) CHECK > 0
--      - period_covered_to >= period_covered_from (defensivo)
--   2. Índices: (tenant_id, payment_date DESC), (tenant_id, period_covered_from, period_covered_to)
--   3. Trigger updated_at reusando función update_updated_at() del repo.
--   4. RLS habilitado:
--      - SELECT: todos los del tenant (admin/abogada/asistente/contador)
--      - INSERT/UPDATE/DELETE: solo admin y contador (las abogadas no registran pagos a DGI)
--   5. COMMENT ON TABLE y COMMENT ON COLUMN explicativos.
--
-- Reversibilidad:
--   ROLLBACK al final, comentado. Drop completo de la tabla.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (dashboard del cliente).
-- =============================================================================

-- =============================================================================
-- PRE-CHECK (informativo + aborta si la tabla ya existe)
-- =============================================================================
DO $$
DECLARE
  v_table_exists INT;
  v_function_exists INT;
  v_users_exists INT;
BEGIN
  SELECT COUNT(*) INTO v_table_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='tax_payments';

  SELECT COUNT(*) INTO v_function_exists
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_updated_at';

  SELECT COUNT(*) INTO v_users_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='users';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Tabla tax_payments existe: %', v_table_exists;
  RAISE NOTICE 'Función update_updated_at() existe: %', v_function_exists;
  RAISE NOTICE 'Tabla public.users existe (para FK created_by): %', v_users_exists;

  IF v_table_exists > 0 THEN
    RAISE EXCEPTION 'ABORT: tabla tax_payments YA existe. Si querés re-aplicar, ejecutá primero el bloque ROLLBACK comentado al final.';
  END IF;

  IF v_function_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: función public.update_updated_at() no existe. Esperada del initial_schema. Investigar antes de continuar.';
  END IF;

  IF v_users_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: tabla public.users no existe. FK created_by no se puede crear.';
  END IF;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CREATE TABLE tax_payments
-- -----------------------------------------------------------------------------
CREATE TABLE tax_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL DEFAULT public.get_tenant_id()
                              REFERENCES tenants(id) ON DELETE CASCADE,
  payment_date          DATE NOT NULL,
  amount                NUMERIC(12,2) NOT NULL,
  period_covered_from   DATE NOT NULL,
  period_covered_to     DATE NOT NULL,
  reference_number      TEXT NULL,
  notes                 TEXT NULL,
  created_by            UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tax_payments_amount_positive_check
    CHECK (amount > 0),

  CONSTRAINT tax_payments_period_order_check
    CHECK (period_covered_to >= period_covered_from),

  CONSTRAINT tax_payments_reference_length_check
    CHECK (reference_number IS NULL OR char_length(reference_number) BETWEEN 1 AND 100)
);

-- -----------------------------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------------------------
CREATE INDEX idx_tax_payments_payment_date
  ON tax_payments(tenant_id, payment_date DESC);

CREATE INDEX idx_tax_payments_period
  ON tax_payments(tenant_id, period_covered_from, period_covered_to);

CREATE INDEX idx_tax_payments_created_by
  ON tax_payments(created_by)
  WHERE created_by IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Trigger updated_at (reusa función global del repo)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_tax_payments_updated_at ON tax_payments;
CREATE TRIGGER trg_tax_payments_updated_at
  BEFORE UPDATE ON tax_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — tenant isolation + permisos granulares por rol
--    SELECT: todos los del tenant
--    INSERT/UPDATE/DELETE: solo admin y contador
-- -----------------------------------------------------------------------------
ALTER TABLE tax_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_payments_select ON tax_payments;
CREATE POLICY tax_payments_select ON tax_payments
  FOR SELECT
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS tax_payments_insert ON tax_payments;
CREATE POLICY tax_payments_insert ON tax_payments
  FOR INSERT
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

DROP POLICY IF EXISTS tax_payments_update ON tax_payments;
CREATE POLICY tax_payments_update ON tax_payments
  FOR UPDATE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

DROP POLICY IF EXISTS tax_payments_delete ON tax_payments;
CREATE POLICY tax_payments_delete ON tax_payments
  FOR DELETE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

-- -----------------------------------------------------------------------------
-- 5. COMMENT ON TABLE / COLUMNS
-- -----------------------------------------------------------------------------
COMMENT ON TABLE tax_payments IS
  'Pagos hechos a la DGI por concepto de ITBMS. Fuente de la línea 9 del VAT Summary ("Tax payments made this period"). Cada fila representa, contablemente, un débito a "2105 ITBMS por Pagar". En sprint futuro de journal_entries será el lado débito de un asiento completo.';

COMMENT ON COLUMN tax_payments.payment_date IS
  'Fecha real del pago a la DGI (la que figura en la boleta).';

COMMENT ON COLUMN tax_payments.amount IS
  'Monto del pago en B/. (mismo valor que la moneda local). Siempre positivo.';

COMMENT ON COLUMN tax_payments.period_covered_from IS
  'Inicio del período fiscal que cubre el pago. Junto con period_covered_to define el rango que el VAT Summary cruzará para asignar el pago a la línea 9 del reporte.';

COMMENT ON COLUMN tax_payments.period_covered_to IS
  'Fin del período fiscal que cubre el pago. Debe ser >= period_covered_from.';

COMMENT ON COLUMN tax_payments.reference_number IS
  'Número de boleta DGI o referencia bancaria del pago. Opcional pero recomendado para auditoría.';

COMMENT ON COLUMN tax_payments.created_by IS
  'Usuario que registró el pago. FK soft (ON DELETE SET NULL) para no perder el row si el usuario se elimina del sistema.';

COMMIT;

-- =============================================================================
-- POST-CHECK (verificación visible al ejecutar)
-- =============================================================================
DO $$
DECLARE
  v_total INT;
  v_rls_enabled BOOLEAN;
  v_policy_count INT;
  v_index_count INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM tax_payments;

  SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='tax_payments';

  SELECT COUNT(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.tax_payments'::regclass;

  SELECT COUNT(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='tax_payments';

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'Filas iniciales: % (esperado 0)', v_total;
  RAISE NOTICE 'RLS habilitado: % (esperado true)', v_rls_enabled;
  RAISE NOTICE 'Policies creadas: % (esperado 4: select/insert/update/delete)', v_policy_count;
  RAISE NOTICE 'Índices creados: % (esperado 4: pkey + 3 idx)', v_index_count;
END $$;

-- Estructura final
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema='public' AND table_name='tax_payments'
ORDER  BY ordinal_position;

-- Policies creadas
SELECT polname, polcmd
FROM   pg_policy
WHERE  polrelid = 'public.tax_payments'::regclass
ORDER  BY polname;

-- Constraints
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM   pg_constraint
WHERE  conrelid = 'public.tax_payments'::regclass
ORDER  BY conname;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- =============================================================================
-- BEGIN;
--
-- DROP TRIGGER IF EXISTS trg_tax_payments_updated_at ON tax_payments;
-- DROP POLICY  IF EXISTS tax_payments_select ON tax_payments;
-- DROP POLICY  IF EXISTS tax_payments_insert ON tax_payments;
-- DROP POLICY  IF EXISTS tax_payments_update ON tax_payments;
-- DROP POLICY  IF EXISTS tax_payments_delete ON tax_payments;
-- DROP TABLE   IF EXISTS tax_payments CASCADE;
--
-- COMMIT;
-- =============================================================================

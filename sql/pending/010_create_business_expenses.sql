-- =============================================================================
-- FEATURE: business_expenses — compras propias del bufete — Sprint 2F Parte 3a
-- Sprint:  2F (Reportes Contador)
-- Fecha:   2026-05-15
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   El VAT Summary (Sprint 2F Parte 3b) necesita una fuente de datos para la
--   Línea 6 "Tax reclaimable on purchases" = SUM(tax_amount) sobre las compras
--   del bufete a sus proveedores donde el ITBMS pagado es crédito fiscal
--   recuperable contra DGI.
--
--   El módulo Legal ya tiene una tabla `expenses` pero modela un concepto
--   DISTINTO: adelantos al cliente reembolsables vía facturas REI (tasas,
--   peritos, mensajería judicial). Esos gastos NO generan crédito fiscal
--   propio del bufete — son pass-through al cliente.
--
--   Por eso creamos `business_expenses` como tabla independiente con:
--   - Breakdown subtotal/tax_rate/tax_amount/total (no presente en expenses)
--   - status pendiente_pago/pagado (no presente en expenses)
--   - chart_account_code para clasificar al P&L (FK lógica a chart_of_accounts)
--   - Supplier (nombre + RUC) para auditoría DGI
--   - receipt en bucket "documents" con prefix business-expenses/{id}/...
--
-- Cambios:
--   1. CREATE TABLE business_expenses con:
--      - tax_rate NUMERIC(5,4) en formato decimal (0.07 para 7%) — soporta
--        valores Panamá actuales (0%, 7%, 10%, 15%) y futuros sin migración.
--      - total NUMERIC GENERATED ALWAYS AS (subtotal + tax_amount) STORED —
--        consistencia garantizada por BD, no recalculable manualmente.
--      - CHECK tax_consistency permisivo: permite tax_rate>0 con subtotal=0
--        para el caso transitorio donde el usuario aún no ingresó subtotal.
--      - CHECK payment_date_consistency defensivo: pendiente_pago obliga
--        payment_date NULL (status=pagado puede tener payment_date NULL si
--        el usuario aún no lo registró).
--   2. Índices: 4 — date DESC, status, account (parcial), taxable (parcial,
--      crítico para query del VAT Summary Línea 6).
--   3. Trigger updated_at reusando función update_updated_at() del repo.
--   4. RLS habilitado con permisos asimétricos:
--      - SELECT: admin, abogada, contador (asistente NO; no es su flujo)
--      - INSERT/UPDATE/DELETE: solo admin + contador (las abogadas lo ven
--        read-only — quien registra gastos del bufete es el contador).
--   5. COMMENT ON TABLE + COMMENT ON COLUMN explicativos.
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
  v_coa_exists INT;
BEGIN
  SELECT COUNT(*) INTO v_table_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='business_expenses';

  SELECT COUNT(*) INTO v_function_exists
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_updated_at';

  SELECT COUNT(*) INTO v_users_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='users';

  SELECT COUNT(*) INTO v_coa_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='chart_of_accounts';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Tabla business_expenses existe: %', v_table_exists;
  RAISE NOTICE 'Función update_updated_at() existe: %', v_function_exists;
  RAISE NOTICE 'Tabla public.users existe (para FK created_by): %', v_users_exists;
  RAISE NOTICE 'Tabla chart_of_accounts existe (FK lógica a code): %', v_coa_exists;

  IF v_table_exists > 0 THEN
    RAISE EXCEPTION 'ABORT: tabla business_expenses YA existe. Si querés re-aplicar, ejecutá primero el bloque ROLLBACK comentado al final.';
  END IF;

  IF v_function_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: función public.update_updated_at() no existe. Esperada del initial_schema. Investigar antes de continuar.';
  END IF;

  IF v_users_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: tabla public.users no existe. FK created_by no se puede crear.';
  END IF;

  IF v_coa_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: tabla chart_of_accounts no existe. Esperada del Sprint 1B/Batch 3. La FK es lógica (sin constraint real) pero la columna chart_account_code igual queda huérfana sin la tabla destino.';
  END IF;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CREATE TABLE business_expenses
-- -----------------------------------------------------------------------------
CREATE TABLE business_expenses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL DEFAULT public.get_tenant_id()
                              REFERENCES tenants(id) ON DELETE CASCADE,

  -- Datos del gasto
  expense_date          DATE NOT NULL,
  supplier_name         TEXT NULL,
  supplier_ruc          TEXT NULL,
  chart_account_code    TEXT NULL,  -- FK lógica a chart_of_accounts(code) — validada en aplicación
  description           TEXT NOT NULL,

  -- Montos
  subtotal              NUMERIC(12,2) NOT NULL,
  tax_rate              NUMERIC(5,4)  NOT NULL DEFAULT 0,   -- formato decimal: 0.0700 para 7%
  tax_amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                 NUMERIC(12,2) NOT NULL GENERATED ALWAYS AS (subtotal + tax_amount) STORED,

  -- Estado de pago
  status                TEXT NOT NULL DEFAULT 'pagado',
  payment_date          DATE NULL,
  payment_method        TEXT NULL,

  -- Comprobante (bucket "documents", prefix "business-expenses/{id}/...")
  receipt_url           TEXT NULL,
  receipt_filename      TEXT NULL,

  -- Operativo
  notes                 TEXT NULL,
  created_by            UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ----- CONSTRAINTS DE VALORES ---------------------------------------------
  CONSTRAINT business_expenses_subtotal_nonneg_check
    CHECK (subtotal >= 0),

  CONSTRAINT business_expenses_tax_rate_range_check
    CHECK (tax_rate >= 0 AND tax_rate <= 1),

  CONSTRAINT business_expenses_tax_amount_nonneg_check
    CHECK (tax_amount >= 0),

  CONSTRAINT business_expenses_description_length_check
    CHECK (char_length(description) BETWEEN 3 AND 500),

  CONSTRAINT business_expenses_supplier_name_length_check
    CHECK (supplier_name IS NULL OR char_length(supplier_name) BETWEEN 1 AND 200),

  CONSTRAINT business_expenses_supplier_ruc_length_check
    CHECK (supplier_ruc IS NULL OR char_length(supplier_ruc) BETWEEN 1 AND 50),

  CONSTRAINT business_expenses_status_check
    CHECK (status IN ('pendiente_pago', 'pagado')),

  CONSTRAINT business_expenses_payment_method_check
    CHECK (
      payment_method IS NULL OR
      payment_method IN ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro')
    ),

  -- ----- CONSTRAINTS DE COHERENCIA ------------------------------------------
  -- tax_consistency (permisivo):
  --   - Sin impuesto: rate=0 ⇒ amount=0
  --   - Con impuesto y sin monto base aún: rate>0 ∧ subtotal=0 ⇒ amount=0
  --     (caso transitorio durante edición — el form auto-calcula al ingresar subtotal)
  --   - Con impuesto y monto base: rate>0 ∧ subtotal>0 ⇒ amount>0
  CONSTRAINT business_expenses_tax_consistency_check
    CHECK (
      (tax_rate = 0 AND tax_amount = 0) OR
      (tax_rate > 0 AND subtotal = 0 AND tax_amount = 0) OR
      (tax_rate > 0 AND subtotal > 0 AND tax_amount > 0)
    ),

  -- payment_date_consistency (defensivo):
  --   - pendiente_pago: obliga payment_date NULL (evita filas con fecha colgada
  --     por error de UI tras cambiar status).
  --   - pagado: payment_date opcional (el usuario puede no haberla cargado aún).
  CONSTRAINT business_expenses_payment_date_consistency_check
    CHECK (
      (status = 'pendiente_pago' AND payment_date IS NULL) OR
      (status = 'pagado')
    )
);

-- -----------------------------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------------------------

-- Listado ordenado por fecha descendente (consulta por defecto de la UI).
CREATE INDEX idx_business_expenses_expense_date
  ON business_expenses(tenant_id, expense_date DESC);

-- Filtro por status (pendiente_pago vs pagado).
CREATE INDEX idx_business_expenses_status
  ON business_expenses(tenant_id, status);

-- Filtro por cuenta contable (parcial — la mayoría de filas tendrán cuenta).
CREATE INDEX idx_business_expenses_account
  ON business_expenses(tenant_id, chart_account_code)
  WHERE chart_account_code IS NOT NULL;

-- CRÍTICO para VAT Summary Línea 6 (Tax reclaimable on purchases).
-- Parcial sobre filas con ITBMS > 0 — descarta el ruido de gastos exentos.
CREATE INDEX idx_business_expenses_taxable
  ON business_expenses(tenant_id, expense_date)
  WHERE tax_amount > 0;

-- -----------------------------------------------------------------------------
-- 3. Trigger updated_at (reusa función global del repo)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_business_expenses_updated_at ON business_expenses;
CREATE TRIGGER trg_business_expenses_updated_at
  BEFORE UPDATE ON business_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — tenant isolation + permisos asimétricos por rol
--    SELECT: admin + abogada + contador (asistente NO — no es su flujo)
--    INSERT/UPDATE/DELETE: admin + contador (las abogadas lo ven read-only)
-- -----------------------------------------------------------------------------
ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_expenses_select ON business_expenses;
CREATE POLICY business_expenses_select ON business_expenses
  FOR SELECT
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'abogada', 'contador')
  );

DROP POLICY IF EXISTS business_expenses_insert ON business_expenses;
CREATE POLICY business_expenses_insert ON business_expenses
  FOR INSERT
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

DROP POLICY IF EXISTS business_expenses_update ON business_expenses;
CREATE POLICY business_expenses_update ON business_expenses
  FOR UPDATE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

DROP POLICY IF EXISTS business_expenses_delete ON business_expenses;
CREATE POLICY business_expenses_delete ON business_expenses
  FOR DELETE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

-- -----------------------------------------------------------------------------
-- 5. COMMENT ON TABLE / COLUMNS
-- -----------------------------------------------------------------------------
COMMENT ON TABLE business_expenses IS
  'Compras del bufete a proveedores (alquiler, oficina, servicios, suministros). El tax_amount es ITBMS recuperable contra DGI vía Línea 6 del VAT Summary. NO confundir con tabla expenses, que modela adelantos al cliente (reembolsables vía facturas REI).';

COMMENT ON COLUMN business_expenses.expense_date IS
  'Fecha del gasto según el comprobante del proveedor. Usada como criterio de devengo para el VAT Summary (Línea 4/5/6).';

COMMENT ON COLUMN business_expenses.supplier_name IS
  'Nombre del proveedor (ej. "Cable Onda S.A."). Opcional pero recomendado para auditoría DGI.';

COMMENT ON COLUMN business_expenses.supplier_ruc IS
  'RUC del proveedor en formato libre. Opcional pero recomendado para cruces fiscales con DGI.';

COMMENT ON COLUMN business_expenses.chart_account_code IS
  'FK lógica a chart_of_accounts.code (validada en aplicación, no por constraint). NULL si todavía no se categorizó. Usada por el P&L para clasificar el gasto.';

COMMENT ON COLUMN business_expenses.subtotal IS
  'Monto base del gasto SIN ITBMS, en B/.';

COMMENT ON COLUMN business_expenses.tax_rate IS
  'Tasa ITBMS en formato decimal. 0.0000 = exento, 0.0700 = 7%, 0.1000 = 10%, 0.1500 = 15%. La aplicación whitelista a {0, 0.07, 0.10, 0.15} para Panamá actual; el CHECK acepta cualquier valor en [0,1] para future-proof.';

COMMENT ON COLUMN business_expenses.tax_amount IS
  'ITBMS efectivamente pagado al proveedor, en B/. Crédito fiscal recuperable contra DGI. Idealmente subtotal * tax_rate, pero el campo es editable manualmente para casos donde el comprobante muestra un valor con redondeo distinto.';

COMMENT ON COLUMN business_expenses.total IS
  'Total pagado (subtotal + tax_amount). Calculado por la BD; no escribir directamente.';

COMMENT ON COLUMN business_expenses.status IS
  'pendiente_pago = registrado pero aún no pagado al proveedor. pagado = liquidado. Para el VAT Summary se computan AMBOS (criterio devengado, no caja).';

COMMENT ON COLUMN business_expenses.payment_date IS
  'Fecha en que se pagó al proveedor. NULL si status=pendiente_pago (enforzado por CHECK). Puede ser NULL incluso en status=pagado si el usuario no la cargó.';

COMMENT ON COLUMN business_expenses.receipt_url IS
  'Storage path en bucket "documents", prefix "business-expenses/{id}/...". NULL si no se subió comprobante.';

COMMENT ON COLUMN business_expenses.created_by IS
  'Usuario que registró el gasto. FK soft (ON DELETE SET NULL) para no perder el row si el usuario se elimina del sistema.';

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
  v_constraint_count INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM business_expenses;

  SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='business_expenses';

  SELECT COUNT(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.business_expenses'::regclass;

  SELECT COUNT(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='business_expenses';

  SELECT COUNT(*) INTO v_constraint_count
    FROM pg_constraint
    WHERE conrelid = 'public.business_expenses'::regclass
      AND contype = 'c';  -- solo CHECK constraints

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'Filas iniciales: % (esperado 0)', v_total;
  RAISE NOTICE 'RLS habilitado: % (esperado true)', v_rls_enabled;
  RAISE NOTICE 'Policies creadas: % (esperado 4: select/insert/update/delete)', v_policy_count;
  RAISE NOTICE 'Índices creados: % (esperado 5: pkey + 4 idx)', v_index_count;
  RAISE NOTICE 'CHECK constraints: % (esperado 9: 7 valores + 2 coherencia)', v_constraint_count;
END $$;

-- Estructura final
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema='public' AND table_name='business_expenses'
ORDER  BY ordinal_position;

-- Policies creadas
SELECT polname, polcmd
FROM   pg_policy
WHERE  polrelid = 'public.business_expenses'::regclass
ORDER  BY polname;

-- Constraints
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM   pg_constraint
WHERE  conrelid = 'public.business_expenses'::regclass
ORDER  BY conname;

-- Índices
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  schemaname='public' AND tablename='business_expenses'
ORDER  BY indexname;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- =============================================================================
-- BEGIN;
--
-- DROP TRIGGER IF EXISTS trg_business_expenses_updated_at ON business_expenses;
-- DROP POLICY  IF EXISTS business_expenses_select ON business_expenses;
-- DROP POLICY  IF EXISTS business_expenses_insert ON business_expenses;
-- DROP POLICY  IF EXISTS business_expenses_update ON business_expenses;
-- DROP POLICY  IF EXISTS business_expenses_delete ON business_expenses;
-- DROP TABLE   IF EXISTS business_expenses CASCADE;
--
-- COMMIT;
-- =============================================================================

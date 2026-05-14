-- =============================================================================
-- FEATURE: Plan de cuentas (chart_of_accounts) — Sprint 2F Parte 1A
-- Sprint:  2F (Reportes Contador)
-- Fecha:   2026-05-15
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   El bufete migra de QuickBooks al CRM para cierre mensual contable.
--   QB usa plantilla genérica sin numerar y sin jerarquía. Esta tabla
--   introduce un plan de cuentas panameño numerado (1xxx-7xxx) con
--   numeración estándar local:
--     1xxx — Activos    2xxx — Pasivos       3xxx — Patrimonio
--     4xxx — Ingresos   5xxx — Costos        6xxx — Gastos
--     7xxx — Otros ingresos
--
--   Decisión D3 (nomenclatura dual): las cuentas críticas guardan el
--   nombre QB original en account_name_qb para que el contador identifique
--   el mapeo durante la migración paralela. Ejemplo: 2105 lleva
--   account_name='ITBMS por Pagar' y account_name_qb='VAT Control'.
--
--   Decisión D6 (seed mínimo): se siembran ~34 cuentas con movimiento real
--   del bufete (basadas en P&L 2025), no las 84 genéricas de QB. Solo 4
--   cuentas se marcan is_system=true (no eliminables):
--     - 1201 Cuentas por Cobrar       (Aging depende)
--     - 2105 ITBMS por Pagar          (VAT Summary depende)
--     - 4101 Honorarios Profesionales (facturas HON van acá)
--     - 4102 Reembolsos de Gastos     (facturas REI van acá)
--
-- Cambios:
--   1. CREATE TABLE chart_of_accounts con:
--      - PK uuid, FK self-reference parent_account_id, UNIQUE(tenant_id, account_code)
--      - account_type CHECK ∈ ('activo','pasivo','patrimonio','ingreso','costo','gasto','otro_ingreso')
--      - account_code CHECK formato 4 dígitos (defensivo)
--   2. Índices: (tenant_id, account_type), (tenant_id, is_active)
--   3. Trigger updated_at reusando función update_updated_at() del repo.
--   4. RLS habilitado:
--      - SELECT: todos los usuarios del tenant pueden leer (admin/abogada/asistente/contador)
--      - INSERT/UPDATE/DELETE: solo admin y contador (gestión de catálogo)
--   5. Seed inicial de 34 cuentas (basado en P&L 2025 real + cuentas auxiliares).
--   6. COMMENT ON TABLE y COMMENT ON COLUMN explicativos.
--
-- Reversibilidad:
--   ROLLBACK al final, comentado. Drop completo de la tabla y sus dependencias.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (dashboard del cliente).
--   Convención del repo desde 2026-04-05.
-- =============================================================================

-- =============================================================================
-- PRE-CHECK (informativo + aborta si la tabla ya existe)
-- =============================================================================
DO $$
DECLARE
  v_table_exists INT;
  v_function_exists INT;
BEGIN
  SELECT COUNT(*) INTO v_table_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='chart_of_accounts';

  SELECT COUNT(*) INTO v_function_exists
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_updated_at';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Tabla chart_of_accounts existe: %', v_table_exists;
  RAISE NOTICE 'Función update_updated_at() existe: %', v_function_exists;

  IF v_table_exists > 0 THEN
    RAISE EXCEPTION 'ABORT: tabla chart_of_accounts YA existe. Si querés re-aplicar, ejecutá primero el bloque ROLLBACK comentado al final.';
  END IF;

  IF v_function_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: función public.update_updated_at() no existe. Esperada del initial_schema. Investigar antes de continuar.';
  END IF;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CREATE TABLE chart_of_accounts
-- -----------------------------------------------------------------------------
CREATE TABLE chart_of_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL DEFAULT public.get_tenant_id()
                            REFERENCES tenants(id) ON DELETE CASCADE,
  account_code        TEXT NOT NULL,
  account_name        TEXT NOT NULL,
  account_name_qb     TEXT NULL,
  account_type        TEXT NOT NULL,
  account_subtype     TEXT NULL,
  parent_account_id   UUID NULL REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_system           BOOLEAN NOT NULL DEFAULT false,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  description         TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chart_of_accounts_code_unique
    UNIQUE (tenant_id, account_code),

  CONSTRAINT chart_of_accounts_type_check
    CHECK (account_type IN ('activo','pasivo','patrimonio','ingreso','costo','gasto','otro_ingreso')),

  CONSTRAINT chart_of_accounts_code_format_check
    CHECK (account_code ~ '^[0-9]{4}$'),

  CONSTRAINT chart_of_accounts_name_length_check
    CHECK (char_length(account_name) BETWEEN 1 AND 200)
);

-- -----------------------------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------------------------
CREATE INDEX idx_chart_of_accounts_type
  ON chart_of_accounts(tenant_id, account_type);

CREATE INDEX idx_chart_of_accounts_active
  ON chart_of_accounts(tenant_id, is_active)
  WHERE is_active = true;

CREATE INDEX idx_chart_of_accounts_parent
  ON chart_of_accounts(parent_account_id)
  WHERE parent_account_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Trigger updated_at (reusa función global del repo)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_chart_of_accounts_updated_at ON chart_of_accounts;
CREATE TRIGGER trg_chart_of_accounts_updated_at
  BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — tenant isolation + permisos granulares por rol
--    SELECT: todos los del tenant (admin, abogada, asistente, contador)
--    INSERT/UPDATE/DELETE: solo admin y contador (gestión de catálogo)
-- -----------------------------------------------------------------------------
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chart_of_accounts_select ON chart_of_accounts;
CREATE POLICY chart_of_accounts_select ON chart_of_accounts
  FOR SELECT
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS chart_of_accounts_insert ON chart_of_accounts;
CREATE POLICY chart_of_accounts_insert ON chart_of_accounts
  FOR INSERT
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

DROP POLICY IF EXISTS chart_of_accounts_update ON chart_of_accounts;
CREATE POLICY chart_of_accounts_update ON chart_of_accounts
  FOR UPDATE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

DROP POLICY IF EXISTS chart_of_accounts_delete ON chart_of_accounts;
CREATE POLICY chart_of_accounts_delete ON chart_of_accounts
  FOR DELETE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
    AND is_system = false
  );

-- -----------------------------------------------------------------------------
-- 5. COMMENT ON TABLE / COLUMNS
-- -----------------------------------------------------------------------------
COMMENT ON TABLE chart_of_accounts IS
  'Plan de cuentas contable panameño numerado (1xxx-7xxx). Reemplaza la lista plana de QuickBooks durante la migración paralela. Cuentas con is_system=true son críticas para los reportes (VAT Summary, Aging, P&L) y no pueden eliminarse.';

COMMENT ON COLUMN chart_of_accounts.account_code IS
  'Código contable de 4 dígitos. Familia: 1xxx activo, 2xxx pasivo, 3xxx patrimonio, 4xxx ingreso, 5xxx costo, 6xxx gasto, 7xxx otro ingreso. Único por tenant.';

COMMENT ON COLUMN chart_of_accounts.account_name IS
  'Nombre local panameño de la cuenta (ej: ''Honorarios Profesionales'', ''ITBMS por Pagar'').';

COMMENT ON COLUMN chart_of_accounts.account_name_qb IS
  'Nombre original en QuickBooks (D3 nomenclatura dual). Permite al contador identificar el mapeo durante la migración paralela. NULL si no aplica o si el nombre es idéntico al local.';

COMMENT ON COLUMN chart_of_accounts.account_subtype IS
  'Subtipo informativo para reportes: ''corriente''/''no_corriente'' para activos y pasivos, ''operativo''/''no_operativo'' para ingresos y gastos, NULL para patrimonio.';

COMMENT ON COLUMN chart_of_accounts.is_system IS
  'true = cuenta crítica que los reportes referencian por código. Bloqueada para DELETE. Hoy: 1201, 2105, 4101, 4102.';

-- -----------------------------------------------------------------------------
-- 6. SEED INICIAL (34 cuentas con movimiento real del bufete, basado en P&L 2025)
-- -----------------------------------------------------------------------------

-- ACTIVOS (1xxx) — 6 cuentas
INSERT INTO chart_of_accounts (account_code, account_name, account_name_qb, account_type, account_subtype, is_system, description) VALUES
  ('1101', 'Efectivo y equivalentes (Banco)', NULL, 'activo', 'corriente', false, NULL),
  ('1102', 'Banco Operativo',                  NULL, 'activo', 'corriente', false, NULL),
  ('1103', 'GASTOS CLIENTES — Trust Fund (Banco)', 'GASTOS CLIENTES — Trust Fund', 'activo', 'corriente', false,
   'Reclasificar a pasivo (Trust Fund Clientes) en sprint futuro. Hoy mirrors QB que la tiene como activo erróneamente.'),
  ('1201', 'Cuentas por Cobrar',               NULL, 'activo', 'corriente', true,
   'Aging de cuentas por cobrar (Sprint 2F) referencia esta cuenta por código. is_system bloquea DELETE.'),
  ('1301', 'Gastos pagados por anticipado',    NULL, 'activo', 'corriente', false, NULL),
  ('1401', 'Activo de inventario',             NULL, 'activo', 'corriente', false, NULL);

-- PASIVOS (2xxx) — 4 cuentas
INSERT INTO chart_of_accounts (account_code, account_name, account_name_qb, account_type, account_subtype, is_system, description) VALUES
  ('2101', 'Cuentas por Pagar',                NULL, 'pasivo', 'corriente', false, NULL),
  ('2105', 'ITBMS por Pagar (VAT Control)',    'VAT Control', 'pasivo', 'corriente', true,
   'D4 modelo contable. Factura HON con ITBMS → crédito; gasto con ITBMS recuperable → débito; pago a DGI → débito (tax_payments). VAT Summary depende. is_system bloquea DELETE.'),
  ('2106', 'ITBMS Provisional (VAT Suspense)', 'VAT Suspense', 'pasivo', 'corriente', false,
   'Cuenta puente para ITBMS pendiente de causar. Si el VAT Summary la requiere en Parte 3, evaluar marcarla is_system en migración posterior.'),
  ('2201', 'Impuesto a las ganancias por pagar', NULL, 'pasivo', 'corriente', false, NULL);

-- PATRIMONIO (3xxx) — 2 cuentas
INSERT INTO chart_of_accounts (account_code, account_name, account_name_qb, account_type, account_subtype, is_system, description) VALUES
  ('3101', 'Capital social',                   NULL, 'patrimonio', NULL, false, NULL),
  ('3201', 'Ganancias acumuladas',             NULL, 'patrimonio', NULL, false, NULL);

-- INGRESOS (4xxx) — 3 cuentas
INSERT INTO chart_of_accounts (account_code, account_name, account_name_qb, account_type, account_subtype, is_system, description) VALUES
  ('4101', 'Honorarios Profesionales',         'Servicios', 'ingreso', 'operativo', true,
   'Facturas HON (honorarios) van a esta cuenta. 96% del ingreso del bufete según P&L 2025. is_system bloquea DELETE.'),
  ('4102', 'Reembolsos de Gastos a Clientes',  NULL, 'ingreso', 'operativo', true,
   'Facturas REI (reembolso/pass-through) van a esta cuenta. is_system bloquea DELETE.'),
  ('4901', 'Descuentos otorgados',             NULL, 'ingreso', 'operativo', false,
   'Contra-ingreso. Se registra con signo negativo o como reducción del ingreso bruto.');

-- GASTOS (6xxx) — 17 cuentas, basadas en P&L 2025 real
INSERT INTO chart_of_accounts (account_code, account_name, account_name_qb, account_type, account_subtype, is_system, description) VALUES
  ('6101', 'Honorarios profesionales y tasas judiciales', NULL, 'gasto', 'operativo', false, '35.6% del gasto 2025 (B/.13,199).'),
  ('6102', 'Pagos de alquiler o arrendamiento', NULL, 'gasto', 'operativo', false, '27.6% del gasto 2025 (B/.10,224).'),
  ('6103', 'Gastos de oficina',                NULL, 'gasto', 'operativo', false, '10.6% del gasto 2025 (B/.3,927).'),
  ('6104', 'Mensajería y entregas',            'Gasto de envío y entrega', 'gasto', 'operativo', false, '10% del gasto 2025 (B/.3,697).'),
  ('6105', 'Reparaciones y mantenimiento',     NULL, 'gasto', 'operativo', false, NULL),
  ('6106', 'Utilidades / Servicios públicos',  'Utilidades', 'gasto', 'operativo', false, NULL),
  ('6107', 'Combustible',                      NULL, 'gasto', 'operativo', false, NULL),
  ('6108', 'Tasas y comisiones',               NULL, 'gasto', 'operativo', false, NULL),
  ('6109', 'Alquiler de equipo',               NULL, 'gasto', 'operativo', false, NULL),
  ('6110', 'Gastos bancarios',                 NULL, 'gasto', 'operativo', false, NULL),
  ('6111', 'Gastos de viaje',                  NULL, 'gasto', 'operativo', false, NULL),
  ('6112', 'Otros gastos G&A',                 NULL, 'gasto', 'operativo', false, NULL),
  ('6113', 'Suministros',                      NULL, 'gasto', 'operativo', false, NULL),
  ('6114', 'Comidas y ocio',                   NULL, 'gasto', 'operativo', false, NULL),
  ('6115', 'Publicidad y promociones',         NULL, 'gasto', 'operativo', false, NULL),
  ('6116', 'Gastos de nóminas',                NULL, 'gasto', 'operativo', false, NULL),
  ('6117', 'Seguros',                          NULL, 'gasto', 'operativo', false, NULL);

-- OTROS INGRESOS (7xxx) — 2 cuentas
INSERT INTO chart_of_accounts (account_code, account_name, account_name_qb, account_type, account_subtype, is_system, description) VALUES
  ('7101', 'Ingresos por intereses',           NULL, 'otro_ingreso', 'no_operativo', false, NULL),
  ('7102', 'Otros ingresos operativos',        NULL, 'otro_ingreso', 'no_operativo', false, NULL);

COMMIT;

-- =============================================================================
-- POST-CHECK (verificación visible al ejecutar)
-- =============================================================================
DO $$
DECLARE
  v_total INT;
  v_system_count INT;
  v_rls_enabled BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_total FROM chart_of_accounts;
  SELECT COUNT(*) INTO v_system_count FROM chart_of_accounts WHERE is_system = true;

  SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='chart_of_accounts';

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'Total cuentas sembradas: % (esperado 34)', v_total;
  RAISE NOTICE 'Cuentas is_system=true: % (esperado 4)', v_system_count;
  RAISE NOTICE 'RLS habilitado: % (esperado true)', v_rls_enabled;
END $$;

-- Distribución por tipo
SELECT account_type, COUNT(*) AS cuentas
FROM   chart_of_accounts
GROUP  BY account_type
ORDER  BY account_type;

-- Cuentas críticas is_system
SELECT account_code, account_name, account_name_qb
FROM   chart_of_accounts
WHERE  is_system = true
ORDER  BY account_code;

-- Verificación de policies
SELECT polname, polcmd
FROM   pg_policy
WHERE  polrelid = 'public.chart_of_accounts'::regclass
ORDER  BY polname;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: dropea la tabla completa con CASCADE. Si ya hay referencias FK
-- desde otras tablas (futuras: journal_entries, etc.), se pierden esos rows.
-- =============================================================================
-- BEGIN;
--
-- DROP TRIGGER IF EXISTS trg_chart_of_accounts_updated_at ON chart_of_accounts;
-- DROP POLICY  IF EXISTS chart_of_accounts_select ON chart_of_accounts;
-- DROP POLICY  IF EXISTS chart_of_accounts_insert ON chart_of_accounts;
-- DROP POLICY  IF EXISTS chart_of_accounts_update ON chart_of_accounts;
-- DROP POLICY  IF EXISTS chart_of_accounts_delete ON chart_of_accounts;
-- DROP TABLE   IF EXISTS chart_of_accounts CASCADE;
--
-- COMMIT;
-- =============================================================================

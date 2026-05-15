-- =============================================================================
-- FEATURE: Extender chart_of_accounts para reportes contables — Sprint 2F Parte 1A
-- Sprint:  2F (Reportes Contador)
-- Fecha:   2026-05-15
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- HISTORIA DEL CAMBIO:
--   Esta migración corrige un error de planeación inicial del Sprint 2F. El
--   archivo 008_create_chart_of_accounts.sql (no aplicado) asumía que la
--   tabla NO existía. En realidad la tabla ya estaba creada desde el
--   Sprint 1B/Batch 3 (supabase/migrations/20260505000002_finanzas_catalogos.sql)
--   con 17 cuentas sembradas. Acá EXTENDEMOS, no recreamos.
--
-- Contexto:
--   El bufete migra de QuickBooks al CRM para cierre mensual contable. La
--   tabla existente tiene una estructura adecuada (code/name/account_type
--   con valores en inglés asset/liability/equity/income/expense, mas
--   is_trust_pass_through que es específico de bufete). Esta migración:
--
--   1. Agrega 3 columnas nuevas que los reportes del Sprint 2F necesitan:
--      - account_name_qb TEXT NULL  → nomenclatura dual (D3) para migración
--                                      paralela con QB
--      - is_system BOOLEAN DEFAULT false → bloquea DELETE de cuentas críticas
--      - description TEXT NULL      → notas operativas (uso contable, etc.)
--
--   2. Siembra 17 cuentas adicionales necesarias para reportar todos los
--      gastos del P&L 2025 real (la lista actual cubre solo los gastos
--      principales, faltan rubros como reparaciones, mensajería, etc.).
--      Total tras esta migración: 17 + 17 = 34 cuentas.
--
--   3. Marca is_system=true en las 5 cuentas críticas que los reportes
--      del Sprint 2F referencian por código (no se pueden eliminar):
--      - 1201 Cuentas por cobrar — Honorarios   (Aging depende)
--      - 1202 Cuentas por cobrar — Reembolsos   (Aging depende)
--      - 2301 ITBMS por pagar                   (VAT Summary depende)
--      - 4101 Honorarios profesionales          (facturas HON van acá)
--      - 4102 Igualas mensuales                 (ingreso recurrente igual)
--
--   4. Agrega mapeo a QB en cuentas con equivalente directo
--      (account_name_qb) para que el contador identifique el bridge durante
--      la migración paralela.
--
-- Notas de diseño:
--   - El CHECK de account_type acepta solo (asset, liability, equity, income,
--     expense). NO incluye 'other_income'. La cuenta 6101 "Ingresos por
--     intereses" se siembra con account_type='income' y se aclara en
--     description que es ingreso no operativo. Si en el futuro extendemos el
--     CHECK para soportar 'other_income', se hará en migración separada.
--   - 2201 (Cuentas por pagar a clientes) ya está sembrada con
--     is_trust_pass_through=true y representa la obligación con el cliente.
--     1103 (GASTOS CLIENTES banco trust) representa el banco físico donde
--     está el dinero — es activo, con is_trust_pass_through=true.
--     El par 1103/2201 modela correctamente el trust fund.
--
-- Reversibilidad:
--   ROLLBACK comentado al final. Drop de las 3 columnas nuevas + DELETE de
--   las 17 cuentas nuevas. Las cuentas existentes (las 17 originales) NO
--   se tocan y NO necesitan rollback (los UPDATE de is_system y
--   account_name_qb desaparecen al dropear esas columnas).
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (dashboard del cliente).
-- =============================================================================

-- =============================================================================
-- PRE-CHECK (informativo + aborta si la tabla NO existe)
-- =============================================================================
DO $$
DECLARE
  v_table_exists INT;
  v_current_count INT;
  v_already_extended INT;
BEGIN
  SELECT COUNT(*) INTO v_table_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='chart_of_accounts';

  IF v_table_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: tabla chart_of_accounts NO existe. Esta migración EXTIENDE una tabla existente; si querés crearla desde cero usá otra migración.';
  END IF;

  SELECT COUNT(*) INTO v_current_count
    FROM chart_of_accounts
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';

  SELECT COUNT(*) INTO v_already_extended
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='chart_of_accounts'
      AND column_name='account_name_qb';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Tabla chart_of_accounts existe: 1';
  RAISE NOTICE 'Cuentas actuales para tenant Integra: % (esperado 17 antes de esta migración)', v_current_count;
  RAISE NOTICE 'Columna account_name_qb ya presente (re-aplicación segura): %', v_already_extended;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- PASO A — Agregar columnas nuevas (idempotente con IF NOT EXISTS)
-- -----------------------------------------------------------------------------
ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS account_name_qb TEXT NULL,
  ADD COLUMN IF NOT EXISTS is_system       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS description     TEXT NULL;

-- -----------------------------------------------------------------------------
-- PASO B — INSERT de 17 cuentas adicionales (ON CONFLICT DO NOTHING)
--          Idempotente: si la migración corre dos veces, las cuentas ya
--          insertadas no se duplican.
-- -----------------------------------------------------------------------------

-- Activos adicionales (2)
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, is_trust_pass_through, account_name_qb, description) VALUES
  ('a0000000-0000-0000-0000-000000000001', '1103', 'GASTOS CLIENTES (banco trust)', 'asset', true,
   'GASTOS CLIENTES',
   'Cuenta de banco para fondos en custodia de clientes. En QB está como activo erróneamente — reclasificar a pasivo en sprint futuro. Hoy mirrors QB para que la migración paralela coincida línea por línea. Su contraparte de obligación al cliente es 2201.'),
  ('a0000000-0000-0000-0000-000000000001', '1301', 'Gastos pagados por anticipado', 'asset', false, NULL, NULL)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Pasivos adicionales (1)
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, is_trust_pass_through, account_name_qb, description) VALUES
  ('a0000000-0000-0000-0000-000000000001', '2102', 'ITBMS provisional (en tránsito)', 'liability', false,
   'VAT Suspense',
   'Cuenta puente para ITBMS pendiente de causar. Si el VAT Summary la requiere para alguna lógica de cuenta puente en Parte 3, evaluar marcarla is_system en migración posterior.')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Gastos adicionales (13)
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, is_trust_pass_through, account_name_qb, description) VALUES
  ('a0000000-0000-0000-0000-000000000001', '5203', 'Reparaciones y mantenimiento',                'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5204', 'Gastos de oficina',                           'expense', false, NULL, '10.6% del gasto 2025 (B/.3,927).'),
  ('a0000000-0000-0000-0000-000000000001', '5205', 'Mensajería y notificaciones judiciales',      'expense', false, 'Gasto de envío y entrega', '10% del gasto 2025 (B/.3,697).'),
  ('a0000000-0000-0000-0000-000000000001', '5402', 'Gastos de viaje',                             'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5601', 'Gastos bancarios',                            'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5602', 'Tasas y comisiones',                          'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5701', 'Suministros',                                 'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5702', 'Comidas y representación',                    'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5703', 'Publicidad y promociones',                    'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5704', 'Alquiler de equipo',                          'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5705', 'Seguros',                                     'expense', false, NULL, NULL),
  ('a0000000-0000-0000-0000-000000000001', '5801', 'Honorarios profesionales subcontratados',    'expense', false, NULL, '35.6% del gasto 2025 (B/.13,199) — honorarios profesionales y tasas judiciales pagados a terceros.'),
  ('a0000000-0000-0000-0000-000000000001', '5901', 'Otros gastos G&A',                            'expense', false, NULL, NULL)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Ingresos adicionales (1)
-- NOTA: el CHECK de account_type no admite 'other_income'. Se siembra como
-- 'income' y se aclara en description que es ingreso no operativo. Si en
-- sprint futuro se amplía el CHECK, esta cuenta puede recategorizarse.
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, is_trust_pass_through, account_name_qb, description) VALUES
  ('a0000000-0000-0000-0000-000000000001', '6101', 'Ingresos por intereses', 'income', false, NULL,
   'Ingreso no operativo. El CHECK actual de account_type no soporta ''other_income''; se categoriza como ''income'' con esta nota. Si en sprint futuro se extiende el CHECK, recategorizar.')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- PASO C — Marcar is_system=true en cuentas críticas para los reportes
-- -----------------------------------------------------------------------------
UPDATE chart_of_accounts
SET is_system = true
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND code IN ('1201', '1202', '2301', '4101', '4102');

-- -----------------------------------------------------------------------------
-- PASO D — Mapeo a QB (account_name_qb) en cuentas existentes con
--          equivalente directo. Solo se actualizan filas para el tenant
--          Integra y SOLO si el campo está vacío (evita sobreescribir
--          mapeos custom que el contador pudiera haber registrado).
-- -----------------------------------------------------------------------------
UPDATE chart_of_accounts SET account_name_qb = 'Servicios'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='4101' AND account_name_qb IS NULL;

UPDATE chart_of_accounts SET account_name_qb = 'VAT Control'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='2301' AND account_name_qb IS NULL;

UPDATE chart_of_accounts SET account_name_qb = 'Cuentas por cobrar (C/C)'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='1201' AND account_name_qb IS NULL;

UPDATE chart_of_accounts SET account_name_qb = 'Pagos de alquiler o arrendamiento'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='5201' AND account_name_qb IS NULL;

UPDATE chart_of_accounts SET account_name_qb = 'Utilidades'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='5202' AND account_name_qb IS NULL;

UPDATE chart_of_accounts SET account_name_qb = 'Combustible'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='5401' AND account_name_qb IS NULL;

UPDATE chart_of_accounts SET account_name_qb = 'Honorarios profesionales y tasas judiciales'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='5501' AND account_name_qb IS NULL;

UPDATE chart_of_accounts SET account_name_qb = 'Gastos de nóminas'
  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='5101' AND account_name_qb IS NULL;

-- -----------------------------------------------------------------------------
-- PASO E — COMMENT ON COLUMN para las 3 columnas nuevas
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN chart_of_accounts.account_name_qb IS
  'Nombre original en QuickBooks (D3 nomenclatura dual). Permite al contador identificar el mapeo durante la migración paralela. NULL si no aplica o si el nombre es idéntico al local.';

COMMENT ON COLUMN chart_of_accounts.is_system IS
  'true = cuenta crítica que los reportes del Sprint 2F referencian por código. Bloqueada para DELETE a nivel app layer. Hoy: 1201, 1202, 2301, 4101, 4102.';

COMMENT ON COLUMN chart_of_accounts.description IS
  'Notas operativas sobre la cuenta (uso contable, decisiones de mapeo, recordatorios). Visible al contador en la UI de gestión del plan de cuentas.';

COMMIT;

-- =============================================================================
-- POST-CHECK (verificación visible al ejecutar)
-- =============================================================================
DO $$
DECLARE
  v_total INT;
  v_system_count INT;
  v_qb_mapped INT;
  v_new_cols INT;
BEGIN
  SELECT COUNT(*) INTO v_total
    FROM chart_of_accounts
    WHERE tenant_id='a0000000-0000-0000-0000-000000000001';

  SELECT COUNT(*) INTO v_system_count
    FROM chart_of_accounts
    WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND is_system = true;

  SELECT COUNT(*) INTO v_qb_mapped
    FROM chart_of_accounts
    WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND account_name_qb IS NOT NULL;

  SELECT COUNT(*) INTO v_new_cols
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='chart_of_accounts'
      AND column_name IN ('account_name_qb', 'is_system', 'description');

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'Total cuentas tenant Integra: % (esperado 34)', v_total;
  RAISE NOTICE 'Cuentas is_system=true: % (esperado 5)', v_system_count;
  RAISE NOTICE 'Cuentas con account_name_qb mapeado: % (esperado 11: 8 existentes + 3 nuevas)', v_qb_mapped;
  RAISE NOTICE 'Columnas nuevas presentes: % (esperado 3)', v_new_cols;
END $$;

-- 1) Total y distribución por tipo
SELECT account_type, COUNT(*) AS cuentas
FROM   chart_of_accounts
WHERE  tenant_id='a0000000-0000-0000-0000-000000000001'
GROUP  BY account_type
ORDER  BY account_type;

-- 2) Cuentas críticas marcadas is_system=true (debe ser 5)
SELECT code, name, account_type, account_name_qb
FROM   chart_of_accounts
WHERE  tenant_id='a0000000-0000-0000-0000-000000000001' AND is_system = true
ORDER  BY code;

-- 3) Cuentas con mapeo a QB (debe ser 11)
SELECT code, name AS nombre_local, account_name_qb AS nombre_qb
FROM   chart_of_accounts
WHERE  tenant_id='a0000000-0000-0000-0000-000000000001' AND account_name_qb IS NOT NULL
ORDER  BY code;

-- 4) Cuentas nuevas sembradas en esta migración (las 17 que faltaban)
SELECT code, name, account_type, is_trust_pass_through
FROM   chart_of_accounts
WHERE  tenant_id='a0000000-0000-0000-0000-000000000001'
  AND  code IN ('1103','1301','2102','5203','5204','5205','5402','5601','5602','5701','5702','5703','5704','5705','5801','5901','6101')
ORDER  BY code;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: si alguna de las 17 cuentas nuevas ya está referenciada por
-- otra tabla (services_catalog.revenue_account vía FK compuesto, futuros
-- journal_entries, etc.), el DELETE falla. En ese caso, primero limpiar las
-- referencias o ajustar el FK ON UPDATE/DELETE.
--
-- El DROP COLUMN de las 3 columnas nuevas borra los UPDATE de is_system y
-- account_name_qb automáticamente — no hace falta deshacerlos por separado.
-- =============================================================================
-- BEGIN;
--
-- DELETE FROM chart_of_accounts
-- WHERE tenant_id='a0000000-0000-0000-0000-000000000001'
--   AND code IN ('1103','1301','2102','5203','5204','5205','5402','5601','5602','5701','5702','5703','5704','5705','5801','5901','6101');
--
-- ALTER TABLE chart_of_accounts DROP COLUMN IF EXISTS description;
-- ALTER TABLE chart_of_accounts DROP COLUMN IF EXISTS is_system;
-- ALTER TABLE chart_of_accounts DROP COLUMN IF EXISTS account_name_qb;
--
-- COMMIT;
-- =============================================================================

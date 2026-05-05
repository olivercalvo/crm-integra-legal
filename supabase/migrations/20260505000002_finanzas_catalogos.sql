-- =============================================================================
-- FEATURE: Finanzas — catálogos base (cuentas, impuestos, servicios, secuencias)
-- Fecha: 2026-05-05
-- Sprint: Fase 1B — Módulo Finanzas (Batch 2 de 6)
--
-- Contexto:
--   Crea las 4 tablas de catálogo que son prerequisito para todas las pantallas
--   de Finanzas (cotizaciones, facturas, pagos, fideicomiso). Carga seeds para
--   el tenant Integra Legal con el plan de cuentas acordado con el contador
--   externo, los códigos de impuesto panameños vigentes, los SKUs de servicio
--   del bufete y las secuencias actuales de QuickBooks.
--
-- Convenciones:
--   - "Enums" como TEXT + CHECK constraint (patrón del repo, batch 1).
--   - Valores de dominio en español; account_type en inglés (estándar contable).
--   - RLS: solo tenant_isolation, igual que las 14 tablas Legal. Autorización
--     por rol se hace en middleware Next.js + API routes (decisión de
--     consistencia tomada antes de este batch).
--
-- Tablas creadas (en orden de dependencia para FKs):
--   1. chart_of_accounts      (sin deps)
--   2. tax_codes              (sin deps)
--   3. services_catalog       (FK compuesto a chart_of_accounts y a tax_codes)
--   4. numbering_sequences    (sin deps)
--
-- Función creada:
--   get_next_sequence_number(p_tenant_id UUID, p_sequence_type TEXT) RETURNS INT
--     SECURITY DEFINER. Lockea la fila, incrementa y devuelve el nuevo valor.
--     IMPORTANTE PARA CALLERS: la función debe ejecutarse DENTRO de la misma
--     transacción que el INSERT del documento. Si se llama por separado (vía
--     RPC, autocommit), el número se incrementa pero queda colgado si después
--     falla la creación del documento. La forma correcta es envolver
--     get_next_sequence_number + INSERT en una función o transacción única
--     desde la API. En Batch 3 (documentos) se construirán esas funciones.
--
-- FK ENTRE CATÁLOGOS — decisión de diseño:
--   services_catalog.revenue_account  → TEXT FK COMPUESTO a chart_of_accounts(tenant_id, code)
--   services_catalog.default_tax_code → TEXT FK COMPUESTO a tax_codes(tenant_id, code)
--
--   Razón: los códigos contables y fiscales son estables, legibles y migran
--   limpio entre ambientes. Los UUIDs no. El FK compuesto incluye tenant_id
--   para garantizar que el código referenciado pertenece al MISMO tenant
--   (defensa multi-tenant a nivel DB).
--
--   En Fase 3, invoice_lines.tax_code_id será UUID FK a tax_codes(id) — porque
--   ahí sí UUID es práctico (registro inmutable, no migra entre ambientes).
--   La inconsistencia es deliberada y refleja la diferencia semántica entre
--   "configuración" (catálogo, mutable, legible) y "transacción" (registro
--   inmutable, performante).
--
-- Seeds aplicados (33 filas, todas para tenant a0000000-...-000000000001):
--   - 17 cuentas contables
--   -  3 códigos de impuesto (ITBMS_7, ITBMS_0, EXENTO)
--   -  9 SKUs de servicio (7 honorarios + 2 reembolso)
--   -  4 secuencias con last_number actuales de QuickBooks (1268, 453, 37, 6)
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (proyecto del cliente
--   Integra Legal). Convención del proyecto desde 2026-04-05.
--
-- Reversibilidad:
--   Rollback al final del archivo. Drop en orden inverso (FK-aware):
--   función → numbering_sequences → services_catalog → tax_codes → chart_of_accounts.
--   Nada de Legal se toca, así que es seguro revertir.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CHART OF ACCOUNTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  account_type          TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  is_trust_pass_through BOOLEAN NOT NULL DEFAULT false,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chart_of_accounts_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tenant ON chart_of_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type   ON chart_of_accounts(tenant_id, account_type);

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chart_of_accounts_tenant_isolation ON chart_of_accounts;
CREATE POLICY chart_of_accounts_tenant_isolation ON chart_of_accounts
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_chart_of_accounts_updated_at ON chart_of_accounts;
CREATE TRIGGER trg_chart_of_accounts_updated_at
  BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed: 17 cuentas. Solo 2201 tiene is_trust_pass_through = true.
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, is_trust_pass_through) VALUES
  ('a0000000-0000-0000-0000-000000000001', '1101', 'Banco operativo',                  'asset',     false),
  ('a0000000-0000-0000-0000-000000000001', '1102', 'Caja chica',                       'asset',     false),
  ('a0000000-0000-0000-0000-000000000001', '1201', 'Cuentas por cobrar — Honorarios',  'asset',     false),
  ('a0000000-0000-0000-0000-000000000001', '1202', 'Cuentas por cobrar — Reembolsos',  'asset',     false),
  ('a0000000-0000-0000-0000-000000000001', '2101', 'Cuentas por pagar a proveedores',  'liability', false),
  ('a0000000-0000-0000-0000-000000000001', '2201', 'Cuentas por pagar a clientes',     'liability', true),
  ('a0000000-0000-0000-0000-000000000001', '2301', 'ITBMS por pagar',                  'liability', false),
  ('a0000000-0000-0000-0000-000000000001', '3101', 'Capital',                          'equity',    false),
  ('a0000000-0000-0000-0000-000000000001', '3201', 'Utilidades retenidas',             'equity',    false),
  ('a0000000-0000-0000-0000-000000000001', '4101', 'Honorarios profesionales',         'income',    false),
  ('a0000000-0000-0000-0000-000000000001', '4102', 'Igualas mensuales',                'income',    false),
  ('a0000000-0000-0000-0000-000000000001', '5101', 'Sueldos y salarios',               'expense',   false),
  ('a0000000-0000-0000-0000-000000000001', '5201', 'Alquiler de oficina',              'expense',   false),
  ('a0000000-0000-0000-0000-000000000001', '5202', 'Servicios públicos',               'expense',   false),
  ('a0000000-0000-0000-0000-000000000001', '5301', 'Gastos de representación',         'expense',   false),
  ('a0000000-0000-0000-0000-000000000001', '5401', 'Combustible y transporte',         'expense',   false),
  ('a0000000-0000-0000-0000-000000000001', '5501', 'Tasas notariales y registrales',   'expense',   false)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- =============================================================================
-- 2. TAX CODES
-- =============================================================================
CREATE TABLE IF NOT EXISTS tax_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  rate        NUMERIC(6,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_codes_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tax_codes_tenant ON tax_codes(tenant_id);

ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_codes_tenant_isolation ON tax_codes;
CREATE POLICY tax_codes_tenant_isolation ON tax_codes
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_tax_codes_updated_at ON tax_codes;
CREATE TRIGGER trg_tax_codes_updated_at
  BEFORE UPDATE ON tax_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed: 3 códigos vigentes en Panamá (mayo 2026).
INSERT INTO tax_codes (tenant_id, code, name, rate) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'ITBMS_7', 'ITBMS 7%', 0.0700),
  ('a0000000-0000-0000-0000-000000000001', 'ITBMS_0', 'ITBMS 0%', 0.0000),
  ('a0000000-0000-0000-0000-000000000001', 'EXENTO',  'Exento',   0.0000)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- =============================================================================
-- 3. SERVICES CATALOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS services_catalog (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  service_type      TEXT NOT NULL CHECK (service_type IN ('honorarios', 'reembolso', 'subcontratado', 'otro')),
  revenue_account   TEXT NOT NULL,
  default_tax_code  TEXT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT services_catalog_tenant_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT services_catalog_revenue_account_fk
    FOREIGN KEY (tenant_id, revenue_account) REFERENCES chart_of_accounts(tenant_id, code)
    ON UPDATE CASCADE,
  CONSTRAINT services_catalog_default_tax_code_fk
    FOREIGN KEY (tenant_id, default_tax_code) REFERENCES tax_codes(tenant_id, code)
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_services_catalog_tenant       ON services_catalog(tenant_id);
CREATE INDEX IF NOT EXISTS idx_services_catalog_revenue_acct ON services_catalog(tenant_id, revenue_account);
CREATE INDEX IF NOT EXISTS idx_services_catalog_tax_code     ON services_catalog(tenant_id, default_tax_code);

ALTER TABLE services_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS services_catalog_tenant_isolation ON services_catalog;
CREATE POLICY services_catalog_tenant_isolation ON services_catalog
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_services_catalog_updated_at ON services_catalog;
CREATE TRIGGER trg_services_catalog_updated_at
  BEFORE UPDATE ON services_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed: 9 SKUs (7 honorarios → 4101 + ITBMS_7, 2 reembolso → 2201 + EXENTO).
-- NOTA: REIM-* apuntan a 2201 (pasivo) en revenue_account. Refleja que las
-- facturas R cruzan el pasivo, no generan ingreso. Esta semántica se valida
-- en Fase 3 al construir invoice creation logic.
INSERT INTO services_catalog (tenant_id, code, name, service_type, revenue_account, default_tax_code) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'HON-CIV',   'Honorarios civiles',                  'honorarios', '4101', 'ITBMS_7'),
  ('a0000000-0000-0000-0000-000000000001', 'HON-COR',   'Honorarios corporativos',             'honorarios', '4101', 'ITBMS_7'),
  ('a0000000-0000-0000-0000-000000000001', 'HON-LAB',   'Honorarios laborales',                'honorarios', '4101', 'ITBMS_7'),
  ('a0000000-0000-0000-0000-000000000001', 'HON-MIG',   'Honorarios migración',                'honorarios', '4101', 'ITBMS_7'),
  ('a0000000-0000-0000-0000-000000000001', 'HON-PEN',   'Honorarios penales',                  'honorarios', '4101', 'ITBMS_7'),
  ('a0000000-0000-0000-0000-000000000001', 'HON-FAM',   'Honorarios familia',                  'honorarios', '4101', 'ITBMS_7'),
  ('a0000000-0000-0000-0000-000000000001', 'HON-OTROS', 'Honorarios — otros',                  'honorarios', '4101', 'ITBMS_7'),
  ('a0000000-0000-0000-0000-000000000001', 'REIM-GOB',  'Reembolso de gastos gubernamentales', 'reembolso',  '2201', 'EXENTO'),
  ('a0000000-0000-0000-0000-000000000001', 'REIM-OTH',  'Reembolso de otros gastos',           'reembolso',  '2201', 'EXENTO')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- =============================================================================
-- 4. NUMBERING SEQUENCES
-- =============================================================================
CREATE TABLE IF NOT EXISTS numbering_sequences (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_type  TEXT NOT NULL CHECK (sequence_type IN ('quote', 'invoice_hon', 'invoice_reim', 'credit_note')),
  last_number    INT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT numbering_sequences_tenant_type_unique UNIQUE (tenant_id, sequence_type)
);

CREATE INDEX IF NOT EXISTS idx_numbering_sequences_tenant ON numbering_sequences(tenant_id);

ALTER TABLE numbering_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS numbering_sequences_tenant_isolation ON numbering_sequences;
CREATE POLICY numbering_sequences_tenant_isolation ON numbering_sequences
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_numbering_sequences_updated_at ON numbering_sequences;
CREATE TRIGGER trg_numbering_sequences_updated_at
  BEFORE UPDATE ON numbering_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed: last_number = último número usado en QuickBooks (mayo 2026).
-- Próxima a usar = last_number + 1, calculada por get_next_sequence_number().
INSERT INTO numbering_sequences (tenant_id, sequence_type, last_number) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'quote',        1268),
  ('a0000000-0000-0000-0000-000000000001', 'invoice_hon',   453),
  ('a0000000-0000-0000-0000-000000000001', 'invoice_reim',   37),
  ('a0000000-0000-0000-0000-000000000001', 'credit_note',     6)
ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

-- =============================================================================
-- 5. FUNCTION: get_next_sequence_number
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: corre con privilegios del owner (postgres) y bypassa RLS.
-- Esto permite que el UPDATE pase independiente del role del caller (admin
-- client o authenticated user).
--
-- TENANT ISOLATION: responsabilidad del caller. La función no valida JWT.
-- Patrón consistente con el repo (admin client + tenant_id manual). Si el
-- caller pasa un p_tenant_id incorrecto, consume secuencia ajena — pero ese
-- mismo bug rompería todo el módulo Legal también, no solo Finanzas.
--
-- Lock: SELECT ... FOR UPDATE bloquea la fila durante la transacción del
-- caller, garantizando atomicidad ante concurrencia. Dos requests
-- concurrentes para la misma secuencia se serializan, no obtienen el mismo
-- número.
--
-- IMPORTANTE para callers:
--   La función incrementa el contador. Si se llama por separado del INSERT
--   del documento (autocommit), el número queda "consumido" aunque el
--   documento nunca se cree. Para evitar gaps, envolver
--   get_next_sequence_number + INSERT en UNA misma transacción / función.
--   En Batch 3 (documentos) se construirán funciones SECURITY DEFINER tipo
--   create_invoice_with_lines que hacen ambas cosas atómicamente.
-- =============================================================================
CREATE OR REPLACE FUNCTION get_next_sequence_number(
  p_tenant_id     UUID,
  p_sequence_type TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next INT;
BEGIN
  -- TENANT ISOLATION: responsabilidad del caller. Esta función confía en
  -- el p_tenant_id recibido. Patrón consistente con el repo: admin client
  -- agrega .eq('tenant_id', X) manualmente en cada query, la DB no valida
  -- JWT. Si en el futuro se decide migrar a RLS-enforced multi-tenancy
  -- (arreglando las funciones helper JWT), refactorizar este guard
  -- globalmente, no parche local.

  SELECT last_number + 1 INTO v_next
  FROM   numbering_sequences
  WHERE  tenant_id     = p_tenant_id
    AND  sequence_type = p_sequence_type
  FOR UPDATE;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Secuencia % no existe para tenant %. Verificar seed de numbering_sequences.',
      p_sequence_type, p_tenant_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE numbering_sequences
  SET    last_number = v_next,
         updated_at  = NOW()
  WHERE  tenant_id     = p_tenant_id
    AND  sequence_type = p_sequence_type;

  RETURN v_next;
END;
$$;

-- Permitir invocación desde sesiones authenticated (no anon).
REVOKE ALL ON FUNCTION get_next_sequence_number(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_next_sequence_number(UUID, TEXT) TO authenticated;

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Las 4 tablas deben existir y tener RLS habilitado:
-- SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
-- FROM   pg_class c
-- JOIN   pg_namespace n ON n.oid = c.relnamespace
-- WHERE  n.nspname = 'public'
--   AND  c.relname IN ('chart_of_accounts', 'tax_codes', 'services_catalog', 'numbering_sequences')
-- ORDER BY c.relname;
-- Esperado: 4 filas, rls_enabled=true en todas.

-- 2. Conteo de seeds (debería retornar 17, 3, 9, 4):
-- SELECT 'chart_of_accounts'    AS tbl, COUNT(*) FROM chart_of_accounts
--   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
-- UNION ALL
-- SELECT 'tax_codes',            COUNT(*) FROM tax_codes
--   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
-- UNION ALL
-- SELECT 'services_catalog',     COUNT(*) FROM services_catalog
--   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
-- UNION ALL
-- SELECT 'numbering_sequences',  COUNT(*) FROM numbering_sequences
--   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';

-- 3. Confirmar que solo 2201 tiene is_trust_pass_through = true:
-- SELECT code, name, is_trust_pass_through
-- FROM   chart_of_accounts
-- WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND  is_trust_pass_through = true;
-- Esperado: 1 fila, code = '2201'.

-- 4. Confirmar FK compuestos en services_catalog:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM   pg_constraint
-- WHERE  conrelid = 'public.services_catalog'::regclass
--   AND  contype  = 'f'
-- ORDER BY conname;
-- Esperado: 2 filas, ambas con (tenant_id, ...) en la definición.

-- 5. Confirmar que la función existe y es SECURITY DEFINER:
-- SELECT proname, prosecdef AS is_security_definer, pg_get_function_arguments(oid) AS args
-- FROM   pg_proc
-- WHERE  proname = 'get_next_sequence_number';
-- Esperado: 1 fila, is_security_definer=true, args="p_tenant_id uuid, p_sequence_type text".

-- 6. Smoke test de la función (ejecutar desde un caller con permiso EXECUTE,
--    típicamente authenticated o admin client. Como este SQL Editor corre como
--    postgres con BYPASSRLS, podés ejecutarlo directo):
-- SELECT get_next_sequence_number(
--   'a0000000-0000-0000-0000-000000000001'::uuid,
--   'quote'
-- );
-- Esperado: 1269 la primera vez. Verificá luego:
-- SELECT * FROM numbering_sequences WHERE sequence_type = 'quote';
-- last_number debería ser 1269 (o n+1 si ya se invocó antes).

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: el rollback elimina las 4 tablas y la función, descartando todos
-- los seeds. Como ningún módulo Legal depende de ellas, no rompe nada existente.
-- Si en Fase 3 ya se han creado quotes/invoices que referencian estos catálogos,
-- el DROP TABLE va a fallar por dependencias — eso es protección, no bug.
-- =============================================================================
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS get_next_sequence_number(UUID, TEXT);
--
-- DROP TABLE IF EXISTS numbering_sequences;
-- DROP TABLE IF EXISTS services_catalog;   -- depende de chart_of_accounts y tax_codes
-- DROP TABLE IF EXISTS tax_codes;
-- DROP TABLE IF EXISTS chart_of_accounts;
--
-- COMMIT;

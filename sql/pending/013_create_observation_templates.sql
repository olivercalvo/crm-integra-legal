-- =============================================================================
-- FEATURE: Sprint QUOTES-POLISH — observation_templates (catálogo de plantillas)
-- Fecha:   2026-05-16
-- Sprint:  QUOTES-POLISH (encima de develop 5f9cb52)
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   El campo quotes.observations (Sprint QUOTES-POLISH, sql/pending/012) es
--   texto libre cliente-visible. Para acelerar la captura por parte de las
--   abogadas, queremos un catálogo administrable de plantillas reutilizables
--   ("Pago 50/50", "Cuota única", "Fee mensual", etc) que se inserten al
--   textarea con un click desde un combobox en el form.
--
--   Patrón: idéntico a quote_terms_template (Sprint 2E.3) pero con N filas
--   por tenant en lugar de 1. RLS = tenant_isolation only; el gate
--   admin-only para CRUD se hace en la capa API (Sprint ADMIN-CATALOGS
--   futuro implementará la UI; este sprint solo expone GET).
--
-- Cambios:
--   1. CREATE TABLE observation_templates con:
--      - tenant_id REFERENCES tenants ON DELETE CASCADE.
--      - name TEXT NOT NULL CHECK longitud 1..120.
--      - content TEXT NOT NULL CHECK longitud 1..2000 (mismo límite que
--        quotes.observations).
--      - is_active BOOLEAN DEFAULT true.
--      - sort_order INT NULL (NULLS LAST en query).
--      - timestamps + trigger updated_at reusando función global.
--      - UNIQUE (tenant_id, name) — protege seeds duplicados y errores de UI.
--   2. ÍNDICE parcial sobre is_active=true para queries de UI.
--   3. RLS tenant_isolation.
--   4. 6 INSERT seed (las 6 plantillas iniciales acordadas con Milena/
--      Daveiva, ver D5 del sprint).
--
-- Reversibilidad:
--   ROLLBACK al final, comentado. DROP TABLE es destructivo (pierde
--   plantillas custom que las abogadas hayan agregado vía SQL futuro), así
--   que solo aplica antes de uso real.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (dashboard del cliente).
-- =============================================================================

-- =============================================================================
-- PRE-CHECK
-- =============================================================================
DO $$
DECLARE
  v_table_exists INT;
BEGIN
  SELECT COUNT(*) INTO v_table_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='observation_templates';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Tabla observation_templates existe: % (esperado 0)', v_table_exists;
END $$;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CREATE TABLE observation_templates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS observation_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL DEFAULT public.get_tenant_id()
                    REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  content      TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,

  CONSTRAINT observation_templates_name_length_check
    CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT observation_templates_content_length_check
    CHECK (char_length(content) BETWEEN 1 AND 2000),
  CONSTRAINT observation_templates_tenant_name_unique
    UNIQUE (tenant_id, name)
);

-- -----------------------------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_observation_templates_tenant
  ON observation_templates(tenant_id);

-- Índice parcial para el listado por defecto de la UI (solo activas).
CREATE INDEX IF NOT EXISTS idx_observation_templates_active
  ON observation_templates(tenant_id, sort_order NULLS LAST, name)
  WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- 3. Trigger updated_at (reusa función global)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_observation_templates_updated_at ON observation_templates;
CREATE TRIGGER trg_observation_templates_updated_at
  BEFORE UPDATE ON observation_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS — tenant_isolation only
-- -----------------------------------------------------------------------------
ALTER TABLE observation_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS observation_templates_tenant_isolation ON observation_templates;
CREATE POLICY observation_templates_tenant_isolation ON observation_templates
  FOR ALL USING (tenant_id = public.get_tenant_id());

-- -----------------------------------------------------------------------------
-- 5. COMMENTS
-- -----------------------------------------------------------------------------
COMMENT ON TABLE observation_templates IS
  'Catálogo administrable de plantillas reutilizables para el campo quotes.observations (Sprint QUOTES-POLISH). Patrón similar a quote_terms_template pero con N filas por tenant en lugar de 1. CRUD admin-only en el API (gate por rol, no por RLS); el listado público GET acepta admin+abogada+contador.';

COMMENT ON COLUMN observation_templates.name IS
  'Nombre visible en el dropdown del form (ej. "Pago 50/50"). UNIQUE por tenant para evitar duplicados.';

COMMENT ON COLUMN observation_templates.content IS
  'Texto que se inserta al textarea de observations cuando la abogada selecciona la plantilla. Limitado a 2000 chars, mismo límite que quotes.observations.';

COMMENT ON COLUMN observation_templates.is_active IS
  'Si la plantilla aparece en el dropdown. Soft-delete: se desactiva en lugar de eliminar para no romper plantillas históricamente referenciadas en cotizaciones existentes (aunque hoy guardamos snapshot del content, no FK).';

COMMENT ON COLUMN observation_templates.sort_order IS
  'Orden de presentación. NULLS LAST en la query. Múltiplos de 10 para permitir inserciones manuales sin renumerar.';

-- -----------------------------------------------------------------------------
-- 6. Seed inicial (6 plantillas acordadas con Milena/Daveiva)
-- -----------------------------------------------------------------------------
INSERT INTO observation_templates (tenant_id, name, content, sort_order) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Pago 50/50',
   'Los honorarios se pagan 50% al firmar el contrato y 50% al entregar el resultado final.',
   10),
  ('a0000000-0000-0000-0000-000000000001', 'Cuota única',
   'Los honorarios se pagan en una sola cuota al iniciar el servicio.',
   20),
  ('a0000000-0000-0000-0000-000000000001', 'Fee mensual',
   'Los honorarios se pagan mediante fee mensual pagadero los primeros 5 días de cada mes.',
   30),
  ('a0000000-0000-0000-0000-000000000001', 'Por etapas',
   'Los honorarios se cobran por etapa según el cronograma adjunto.',
   40),
  ('a0000000-0000-0000-0000-000000000001', 'Reembolso a costo',
   'Los reembolsos se facturan al costo real previa presentación de comprobantes.',
   50),
  ('a0000000-0000-0000-0000-000000000001', 'Vigencia 30 días',
   'La presente cotización tiene vigencia de 30 días calendario a partir de su emisión.',
   60)
ON CONFLICT (tenant_id, name) DO NOTHING;

COMMIT;

-- =============================================================================
-- POST-CHECK
-- =============================================================================
DO $$
DECLARE
  v_seed_count   INT;
  v_rls_enabled  BOOLEAN;
  v_policy_count INT;
BEGIN
  SELECT COUNT(*) INTO v_seed_count
    FROM observation_templates
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID;

  SELECT c.relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='observation_templates';

  SELECT COUNT(*) INTO v_policy_count
    FROM pg_policy
    WHERE polrelid = 'public.observation_templates'::regclass;

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'Seeds insertados: % (esperado 6)', v_seed_count;
  RAISE NOTICE 'RLS habilitado: % (esperado true)', v_rls_enabled;
  RAISE NOTICE 'Policies creadas: % (esperado 1)', v_policy_count;
END $$;

-- Listado final
SELECT name, char_length(content) AS content_len, is_active, sort_order
FROM   observation_templates
WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID
ORDER  BY sort_order NULLS LAST, name;

-- =============================================================================
-- ROLLBACK (descomentar para revertir)
-- =============================================================================
-- BEGIN;
--
-- DROP POLICY  IF EXISTS observation_templates_tenant_isolation ON observation_templates;
-- DROP TRIGGER IF EXISTS trg_observation_templates_updated_at ON observation_templates;
-- DROP TABLE   IF EXISTS observation_templates CASCADE;
--
-- COMMIT;
-- =============================================================================

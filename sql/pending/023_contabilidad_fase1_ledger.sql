-- ============================================================================
-- MÓDULO CONTABLE — FASE 1: schema del ledger (DE 34/1998)
-- ----------------------------------------------------------------------------
-- Reescrito 04/08/2026 para CONSTRUIR SOBRE el chart_of_accounts que YA existe
-- en producción (creado en 20260505000002_finanzas_catalogos.sql, account_type
-- en inglés asset/liability/equity/income/expense, con is_system/active, +34
-- cuentas). Esta migración NO recrea ni siembra el plan de cuentas: solo agrega
-- el motor de asientos y lo referencia por FK. El plan de cuentas final del
-- contador (Josuar) se carga aparte, vía la UI de Plan de Cuentas ya existente
-- o una migración de datos, DESPUÉS de la reunión — el ledger es chart-agnostic.
--
-- Núcleo de contabilidad de partida doble, inmutable y avalable por CPA.
-- Base legal (DE 34/1998, Gaceta 23.520):
--   Art. 2a/9/10  → registros indispensables Diario y Mayor.
--   Art. 5.1-5.7  → cronología, español, balboas, monto, naturaleza, reversión.
--   Art. 6a-c     → irreversible/inalterable, conservación, recuperación.
--   Art. 13a      → al día = registrado dentro de 60 días.
--   Art. 22       → prohibido alterar, dejar espacios en blanco, borrar.
--
-- Decisiones aprobadas por Oliver:
--   (1) Inmutabilidad a nivel BD (triggers rechazan UPDATE/DELETE incluso al
--       service-role de la app; la corrección es SIEMPRE un asiento de reversión).
--   (2) Hash-chain SHA-256; se computa en la app, se verifica en la BD (Fase 2).
--   (3) Correlativo SIN huecos (Art. 22.2) — distinto del folio fiscal FE.
--
-- ⚠️ CAMBIO DE SCHEMA EN PRODUCCIÓN — pausa obligatoria. Revisar y aplicar
--    sentencia por sentencia. Son tablas NUEVAS y VACÍAS (aditivo, no toca data
--    existente ni el chart_of_accounts). Tenant Integra:
--    a0000000-0000-0000-0000-000000000001
--
-- ALCANCE FASE 1: tablas + constraints + índices + triggers de inmutabilidad +
--    RLS. La lógica de posteo (RPC: correlativo sin huecos + hash-chain +
--    validación Σdébitos=Σcréditos + período abierto) y la función verificadora
--    de la cadena van en la FASE 2 (migración aparte), una vez el contador
--    confirme el plan de cuentas y los tratamientos.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() SHA-256 para la Fase 2

-- ----------------------------------------------------------------------------
-- 1) PERÍODOS CONTABLES (cierre mensual)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year       int NOT NULL,
  month      int NOT NULL CHECK (month BETWEEN 1 AND 12),
  status     text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','cerrado')),
  closed_at  timestamptz,
  closed_by  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, year, month)
);

-- ----------------------------------------------------------------------------
-- 2) SECUENCIA DEL CORRELATIVO — SIN huecos, atómica por tenant (la usa Fase 2)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_sequences (
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sequence_type text NOT NULL DEFAULT 'journal_entry',
  last_number   bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence_type)
);

-- ----------------------------------------------------------------------------
-- 3) ASIENTOS (journal entries) — append-only, encadenados por hash
--    Doble fecha: transaction_date (operación) + record_date (registro).
--    "Reversado" es DERIVADO: existe otro asiento con reverses_entry_id = id.
--    El original NUNCA se modifica.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_number      bigint NOT NULL,                       -- correlativo SIN huecos
  period_id         uuid NOT NULL REFERENCES public.accounting_periods(id),
  transaction_date  date NOT NULL,                         -- Art. 5.1 (operación)
  record_date       date NOT NULL DEFAULT current_date,    -- doble fecha (Art. 13a)
  description       text NOT NULL,                         -- naturaleza (Art. 5.5)
  source_type       text NOT NULL
    CHECK (source_type IN ('factura','gasto','pago','nota_credito','manual','reversion')),
  source_id         uuid,
  source_cufe       text,                                  -- referencia al CUFE de la FE
  reverses_entry_id uuid REFERENCES public.journal_entries(id),
  reversal_reason   text,                                  -- motivo obligatorio (Art. 5.7)
  content_hash      text NOT NULL,                         -- SHA-256 del contenido
  prev_hash         text NOT NULL,                         -- hash del asiento anterior
  hash              text NOT NULL,                         -- SHA-256(prev_hash || content_hash)
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  UNIQUE (tenant_id, entry_number),
  -- Una reversión exige apuntar al original y un motivo (>=3 chars).
  CONSTRAINT je_reversion_requires_ref CHECK (
    source_type <> 'reversion'
    OR (reverses_entry_id IS NOT NULL AND reversal_reason IS NOT NULL AND length(reversal_reason) >= 3)
  )
);

-- ----------------------------------------------------------------------------
-- 4) PARTIDAS DEL ASIENTO (líneas débito/crédito)
--    account_id -> chart_of_accounts EXISTENTE (no se recrea la tabla).
--    Regla partida doble (Σdébitos = Σcréditos) se valida en el RPC de posteo
--    (Fase 2), porque abarca varias filas.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id         uuid NOT NULL REFERENCES public.journal_entries(id),
  line_order       int NOT NULL,
  account_id       uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  debit            numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit           numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  line_description text,
  CONSTRAINT jel_debit_xor_credit CHECK (NOT (debit > 0 AND credit > 0)),  -- débito O crédito
  CONSTRAINT jel_not_zero        CHECK (debit > 0 OR credit > 0)           -- sin líneas en cero
);

-- ----------------------------------------------------------------------------
-- 5) LEGAJOS ANUALES SELLADOS (Art. 14: conservación 5 años, borrado rechazado)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_legajos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year         int NOT NULL,
  sealed_at    timestamptz NOT NULL DEFAULT now(),
  sealed_by    uuid,
  content_hash text NOT NULL,          -- hash agregado de todos los asientos del año
  entry_count  bigint NOT NULL,
  status       text NOT NULL DEFAULT 'sellado' CHECK (status IN ('sellado')),
  UNIQUE (tenant_id, year)
);

-- ----------------------------------------------------------------------------
-- ÍNDICES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_periods_tenant     ON public.accounting_periods (tenant_id, year, month);
CREATE INDEX IF NOT EXISTS idx_je_tenant_number   ON public.journal_entries (tenant_id, entry_number);
CREATE INDEX IF NOT EXISTS idx_je_tenant_period   ON public.journal_entries (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS idx_je_tenant_source   ON public.journal_entries (tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_je_tenant_txdate   ON public.journal_entries (tenant_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_jel_entry          ON public.journal_entry_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_tenant_account ON public.journal_entry_lines (tenant_id, account_id);

-- ----------------------------------------------------------------------------
-- INMUTABILIDAD (Art. 6a, 22): rechazar UPDATE y DELETE sobre asientos, líneas
-- y legajos. Aplica a TODOS los roles (incluido el service-role de la app): los
-- asientos son append-only; la corrección es un asiento nuevo de reversión.
-- (Períodos y secuencia SÍ mutan: cerrar período, incrementar correlativo.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_accounting_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Registro contable inmutable (DE 34/1998 Art. 6a/22): no se permite % sobre %. La corrección se hace por asiento de reversión.',
    TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_je_no_update  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_accounting_mutation();
CREATE TRIGGER trg_je_no_delete  BEFORE DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_accounting_mutation();
CREATE TRIGGER trg_jel_no_update BEFORE UPDATE ON public.journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION public.reject_accounting_mutation();
CREATE TRIGGER trg_jel_no_delete BEFORE DELETE ON public.journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION public.reject_accounting_mutation();
CREATE TRIGGER trg_leg_no_update BEFORE UPDATE ON public.accounting_legajos
  FOR EACH ROW EXECUTE FUNCTION public.reject_accounting_mutation();
CREATE TRIGGER trg_leg_no_delete BEFORE DELETE ON public.accounting_legajos
  FOR EACH ROW EXECUTE FUNCTION public.reject_accounting_mutation();

-- ----------------------------------------------------------------------------
-- RLS por tenant (defensa en profundidad; la app usa service-role que la
-- bypassa). Se lee el tenant del claim JWT app_metadata.tenant_id inline
-- (auth.tenant_id() NO existe en esta base — ver hallazgo de seguridad).
-- SOLO las 5 tablas nuevas; el chart_of_accounts ya tiene su propia config.
-- ----------------------------------------------------------------------------
ALTER TABLE public.accounting_periods   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_legajos   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounting_periods','accounting_sequences',
    'journal_entries','journal_entry_lines','accounting_legajos'
  ] LOOP
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL TO authenticated
        USING (tenant_id::text = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id'))
        WITH CHECK (tenant_id::text = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id'));
    $f$, t);
  END LOOP;
END $$;

-- ============================================================================
-- VERIFICACIÓN (correr después)
-- ============================================================================
-- a) Tablas nuevas creadas (esperado: 5)
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('accounting_periods','accounting_sequences',
                     'journal_entries','journal_entry_lines','accounting_legajos')
ORDER BY table_name;

-- b) Triggers de inmutabilidad (esperado: 6)
SELECT event_object_table, trigger_name, event_manipulation
FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_%no_%' ORDER BY event_object_table;

-- c) Políticas RLS de las tablas nuevas (esperado: 5 'tenant_isolation')
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('accounting_periods','accounting_sequences',
                    'journal_entries','journal_entry_lines','accounting_legajos')
ORDER BY tablename;

-- d) El FK del ledger apunta al chart_of_accounts existente (esperado: 1 fila)
SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type='FOREIGN KEY'
  AND tc.table_name='journal_entry_lines'
  AND kcu.column_name='account_id';

-- e) PRUEBA de inmutabilidad (correr en la Fase 2, tras insertar un asiento):
--    UPDATE public.journal_entries SET description='x' WHERE ...;  -- debe RECHAZAR
--    DELETE FROM public.journal_entries WHERE ...;                 -- debe RECHAZAR
-- ============================================================================

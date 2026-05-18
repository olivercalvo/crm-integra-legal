-- =============================================================================
-- SPRINT 2E.4 — Portal público funcional (FES + audit log)
-- Fecha:  2026-05-17
-- Sprint: 2E.4 — Cotizaciones — portal público + cascada de aceptación
--
-- Contexto:
--   El portal /cotizacion/[token] pasa de placeholder a funcional. El cliente
--   puede aceptar o rechazar la cotización con un audit log completo:
--     - quote_acceptances: full_name, position, id_document, IP, UA,
--       consent text version y texto firmado completo (D10).
--     - quote_rejections: motivo + IP + UA.
--
--   Las columnas legacy en quotes (approved_at, approved_by_ip,
--   approved_by_user_agent, rejected_at, rejected_by_ip,
--   rejected_by_user_agent, rejection_reason) se mantienen y la app las
--   popula en paralelo (D3) para queries rápidas sin joins.
--
--   El PDF firmado se guarda como UN archivo físico en Storage con DOS
--   filas en `documents` (D4): una con entity_type='client' y otra con
--   entity_type='case' (si la cotización tenía caso asociado). Para eso se
--   extiende el CHECK `documents_source_check` con el valor
--   'auto_signed_quote_pdf'.
--
-- Cambios:
--   1. CREATE TABLE quote_acceptances
--   2. CREATE TABLE quote_rejections
--   3. ALTER documents_source_check: agregar 'auto_signed_quote_pdf'
--   4. RLS tenant_isolation en ambas tablas
--   5. Índices por quote_id + tenant
--
-- Aplicación:
--   Manual en Supabase SQL Editor (convención sql/pending/).
--   Idempotente: CREATE TABLE IF NOT EXISTS + ALTER ... DROP IF EXISTS + ADD.
--
-- Reversibilidad:
--   Bloque ROLLBACK al final, comentado. ATENCIÓN: el rollback DROPea las
--   tablas — si ya hay aceptaciones/rechazos registrados, se PIERDEN.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CREATE TABLE quote_acceptances
-- -----------------------------------------------------------------------------
-- Una fila por aceptación. Una cotización solo puede tener UNA aceptación
-- (UNIQUE en quote_id). Si el cliente quiere "des-aceptar", lo único que se
-- puede es crear una nueva cotización (la aceptación es terminal).
-- =============================================================================
CREATE TABLE IF NOT EXISTS quote_acceptances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id              UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  accepted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Datos del firmante (FES).
  full_name             TEXT NOT NULL,
  position              TEXT NOT NULL,
  id_document           TEXT NULL,

  -- Audit log técnico.
  ip_address            TEXT NULL,
  user_agent            TEXT NULL,
  origin_url            TEXT NULL,
  geolocation           JSONB NULL,            -- reservado para futuro (D5)

  -- Texto del consent + versión para tracking de cambios.
  consent_text_version  TEXT NOT NULL,
  signature_text        TEXT NOT NULL,         -- copia exacta del texto que vio el cliente

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT quote_acceptances_full_name_length
    CHECK (length(btrim(full_name)) BETWEEN 3 AND 120),
  CONSTRAINT quote_acceptances_position_length
    CHECK (length(btrim(position)) BETWEEN 2 AND 100),
  CONSTRAINT quote_acceptances_id_document_length
    CHECK (id_document IS NULL OR length(btrim(id_document)) BETWEEN 3 AND 30),
  CONSTRAINT quote_acceptances_signature_text_length
    CHECK (length(signature_text) BETWEEN 10 AND 5000),
  CONSTRAINT quote_acceptances_unique_per_quote
    UNIQUE (quote_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_acceptances_tenant
  ON quote_acceptances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quote_acceptances_quote
  ON quote_acceptances(tenant_id, quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_acceptances_accepted_at
  ON quote_acceptances(tenant_id, accepted_at DESC);

ALTER TABLE quote_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_acceptances_tenant_isolation ON quote_acceptances;
CREATE POLICY quote_acceptances_tenant_isolation ON quote_acceptances
  FOR ALL USING (tenant_id = public.get_tenant_id());

COMMENT ON TABLE quote_acceptances IS
  'Audit log de aceptaciones del cliente desde el portal público (Sprint 2E.4, FES Ley 51/2008 Panamá). Una fila por cotización aceptada. signature_text guarda el texto completo que el cliente vio y aceptó.';
COMMENT ON COLUMN quote_acceptances.signature_text IS
  'Texto completo del consent FES tal como apareció en pantalla. NO se modifica si cambia la plantilla — preserva la evidencia legal exacta de lo que el cliente aceptó.';
COMMENT ON COLUMN quote_acceptances.consent_text_version IS
  'Versión semántica del template del consent. Permite saber qué redacción se mostró al cliente sin re-leer signature_text completo.';
COMMENT ON COLUMN quote_acceptances.geolocation IS
  'Reservado para futuro (D5: hoy NO se popula). Si llega data, formato esperado: {"lat":num,"lng":num,"accuracy":num,"source":"browser"|"ip"}.';

-- =============================================================================
-- 2. CREATE TABLE quote_rejections
-- -----------------------------------------------------------------------------
-- Una fila por rechazo. Una cotización solo puede tener UN rechazo
-- (UNIQUE en quote_id). El cliente que rechaza pero después cambia de
-- opinión necesita una NUEVA cotización del bufete.
-- =============================================================================
CREATE TABLE IF NOT EXISTS quote_rejections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id      UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  rejected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  reason        TEXT NOT NULL,
  ip_address    TEXT NULL,
  user_agent    TEXT NULL,
  origin_url    TEXT NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT quote_rejections_reason_length
    CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  CONSTRAINT quote_rejections_unique_per_quote
    UNIQUE (quote_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_rejections_tenant
  ON quote_rejections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quote_rejections_quote
  ON quote_rejections(tenant_id, quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_rejections_rejected_at
  ON quote_rejections(tenant_id, rejected_at DESC);

ALTER TABLE quote_rejections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_rejections_tenant_isolation ON quote_rejections;
CREATE POLICY quote_rejections_tenant_isolation ON quote_rejections
  FOR ALL USING (tenant_id = public.get_tenant_id());

COMMENT ON TABLE quote_rejections IS
  'Audit log de rechazos del cliente desde el portal público (Sprint 2E.4). Una fila por cotización rechazada. reason es obligatorio para tener trazabilidad de por qué se rechazó.';

-- =============================================================================
-- 3. ALTER documents_source_check — agregar 'auto_signed_quote_pdf'
-- -----------------------------------------------------------------------------
-- El PDF firmado se sube a Storage y se registra como UN archivo con DOS
-- filas en documents (entity_type='client' y entity_type='case' si tiene
-- case_id). Source nuevo para distinguirlo del auto_quote_pdf normal y
-- evitar que se borre por el bloqueo de "no se elimina manualmente".
-- =============================================================================
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_source_check
  CHECK (source IN (
    'manual',
    'auto_quote_pdf',
    'auto_invoice_pdf',
    'auto_signed_quote_pdf'
  ));

COMMENT ON COLUMN documents.source IS
  'Origen del adjunto. ''manual'' = subido por usuario. ''auto_quote_pdf'' = PDF de cotización (Sprint 2E.3). ''auto_invoice_pdf'' = preparado para 2F (factura). ''auto_signed_quote_pdf'' = PDF de cotización con evidencia de aceptación electrónica adjuntada (Sprint 2E.4, FES Ley 51/2008 Panamá). Las filas con source != ''manual'' NO se eliminan via /api/documents/[id]/delete.';

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Tablas existen + RLS habilitado:
-- SELECT c.relname, c.relrowsecurity
-- FROM   pg_class c
-- JOIN   pg_namespace n ON n.oid = c.relnamespace
-- WHERE  n.nspname = 'public'
--   AND  c.relname IN ('quote_acceptances','quote_rejections')
-- ORDER  BY c.relname;
-- Esperado: 2 filas, rls_enabled=true en ambas.

-- 2. CHECK constraints nombrados:
-- SELECT conname
-- FROM   pg_constraint
-- WHERE  conrelid IN ('public.quote_acceptances'::regclass,
--                     'public.quote_rejections'::regclass)
-- ORDER  BY conname;

-- 3. CHECK de documents actualizado:
-- SELECT pg_get_constraintdef(oid)
-- FROM   pg_constraint
-- WHERE  conrelid = 'public.documents'::regclass
--   AND  conname  = 'documents_source_check';
-- Esperado: incluye 'auto_signed_quote_pdf'.

-- 4. Smoke INSERT (descomentar y ajustar UUIDs para probar localmente):
-- INSERT INTO quote_acceptances (
--   tenant_id, quote_id, full_name, position, id_document,
--   ip_address, user_agent, origin_url,
--   consent_text_version, signature_text
-- ) VALUES (
--   'a0000000-0000-0000-0000-000000000001',
--   (SELECT id FROM quotes ORDER BY created_at DESC LIMIT 1),
--   'Juan Pérez', 'Gerente General', 'PE-123-456',
--   '203.0.113.42', 'Mozilla/5.0 ...',
--   'https://crm-integra-legal.vercel.app/cotizacion/abc',
--   'v1-2026-05', 'Yo, Juan Pérez ... acepto la cotización COT-001275 ...'
-- );

-- =============================================================================
-- ROLLBACK (no recomendado — pierde aceptaciones/rechazos registrados)
-- =============================================================================
-- BEGIN;
--
-- ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_check;
-- ALTER TABLE documents
--   ADD CONSTRAINT documents_source_check
--   CHECK (source IN ('manual','auto_quote_pdf','auto_invoice_pdf'));
--
-- DROP TABLE IF EXISTS quote_rejections;
-- DROP TABLE IF EXISTS quote_acceptances;
--
-- COMMIT;
-- =============================================================================

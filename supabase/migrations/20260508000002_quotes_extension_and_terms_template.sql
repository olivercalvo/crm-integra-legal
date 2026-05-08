-- =============================================================================
-- ⚠️ YA APLICADO EN PRODUCCION: 2026-05-08
-- Este archivo es retro-documentación del cambio aplicado manualmente en
-- Supabase SQL Editor durante el Sprint 2E.1 Fase A (Cotizaciones).
--
-- NO REAPLICAR. Si necesitas reproducir el schema en una BD nueva, ejecutá
-- secuencialmente todas las migrations del directorio. Los bloques DO $$ y
-- los IF NOT EXISTS hacen que la re-aplicación sea idempotente, pero el
-- flujo canónico es ejecutar todo desde cero.
-- =============================================================================
-- FEATURE: quotes (cotizaciones) — extensión schema + template T&C
-- Sprint:  2E.1 (Cotizaciones) — Decisiones D1-D9 + D13
--
-- Contexto:
--   La tabla quotes ya existía desde el Batch 3a (20260505000003) con 16
--   columnas básicas (header + totales). Este sprint la extiende para
--   soportar el flujo completo de aprobación por cliente vía portal público
--   (D1), conversión a factura (D2), T&C snapshot (D4), numeración
--   centralizada (D7), permisos (D8) y rechazo opcional (D5).
--
--   También se crea una tabla nueva `quote_terms_template` para guardar la
--   plantilla editable de Términos y Condiciones (D4, D9: solo admin edita).
--
-- Cambios aplicados:
--   1. quotes: ADD 19 columnas nuevas
--   2. quotes: actualizar CHECK status (agregar 'convertida' y 'cancelada_pre_envio')
--   3. quotes: agregar CHECK quotes_subtotal_kind_non_negative
--   4. quote_lines: ADD invoice_kind TEXT NOT NULL CHECK ∈ ('HON','REI')
--   5. quote_lines: dropear las columnas GENERATED de subtotal/tax_amount/
--      line_total para que el cálculo sea responsabilidad de un trigger
--      (T8b-quote, aplicado fuera de esta migration) → permite split por
--      invoice_kind (subtotal_hon/subtotal_rei en cabecera).
--   6. quote_terms_template: CREATE TABLE + seed con plantilla T&C panameña
--   7. numbering_sequences: confirmar (no crear) que existe sequence_type='quote'
--
-- Triggers asociados (NO incluidos en esta migration — viven en BD por
-- aplicación manual durante el sprint, ver `pg_trigger` en Supabase):
--   - T2-quote: validador de transiciones de status
--   - T4-quote: immutability post-envío de campos críticos
--   - T6-quote: prevención de delete en estados no permitidos
--   - T8b-quote: recálculo de totales (subtotal_total, tax_total, grand_total,
--     subtotal_hon, subtotal_rei) al INSERT/UPDATE/DELETE en quote_lines
--
-- Reversibilidad:
--   ADD COLUMN no es destructivo. El DROP del CHECK status anterior y
--   re-creación con valores adicionales es seguro (no rechaza filas
--   existentes). El DROP de las GENERATED columns en quote_lines pierde
--   datos calculados, pero el trigger T8b-quote los recomputa al primer
--   UPDATE.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. quotes — agregar 19 columnas nuevas
-- =============================================================================

-- T&C snapshot al crear la cotización (D4: plantilla pre-cargada).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT NULL;

-- Subtotales por invoice_kind (D2: líneas mixtas HON+REI).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS subtotal_hon NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS subtotal_rei NUMERIC NOT NULL DEFAULT 0;

-- Portal público (D1, D6).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS public_token   TEXT       NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_at        TIMESTAMPTZ NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_to_email  TEXT       NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_by        UUID       NULL;

-- Aprobación por cliente desde el portal (telemetría IP/UA para auditoría legal).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at            TIMESTAMPTZ NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_by_ip         TEXT       NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_by_user_agent TEXT       NULL;

-- Rechazo por cliente (D5: razón opcional).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rejected_at            TIMESTAMPTZ NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rejected_by_ip         TEXT       NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rejected_by_user_agent TEXT       NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rejection_reason       TEXT       NULL;

-- Cancelación pre-envío (admin descarta cotización en borrador).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS cancelled_at         TIMESTAMPTZ NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS cancellation_reason  TEXT       NULL;

-- Conversión a factura (D2: cada invoice_kind genera 1 factura).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_at         TIMESTAMPTZ NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_invoice_ids UUID[]    NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_by         UUID       NULL;

-- =============================================================================
-- 2. quotes — actualizar CHECK status (agregar 'convertida' + 'cancelada_pre_envio')
-- =============================================================================
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN (
    'borrador',
    'enviada',
    'aceptada',
    'rechazada',
    'expirada',
    'convertida',
    'cancelada_pre_envio'
  ));

-- =============================================================================
-- 3. quotes — CHECK subtotales por kind no negativos
-- =============================================================================
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_subtotal_kind_non_negative;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_subtotal_kind_non_negative
  CHECK (subtotal_hon >= 0 AND subtotal_rei >= 0);

-- =============================================================================
-- 4. quote_lines — ADD invoice_kind
-- =============================================================================
ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS invoice_kind TEXT NULL;

-- Backfill defensivo (si hubiera filas legacy sin invoice_kind, asignar 'HON').
UPDATE quote_lines SET invoice_kind = 'HON' WHERE invoice_kind IS NULL;

-- Hacer NOT NULL después del backfill.
ALTER TABLE quote_lines ALTER COLUMN invoice_kind SET NOT NULL;

ALTER TABLE quote_lines DROP CONSTRAINT IF EXISTS quote_lines_invoice_kind_valid;
ALTER TABLE quote_lines
  ADD CONSTRAINT quote_lines_invoice_kind_valid
  CHECK (invoice_kind IN ('HON','REI'));

-- =============================================================================
-- 5. quote_lines — dropear GENERATED columns para permitir cálculo via trigger
-- -----------------------------------------------------------------------------
-- En Batch 3a se crearon como GENERATED ALWAYS AS (...) STORED. Para soportar
-- el split por invoice_kind en cabecera (subtotal_hon/subtotal_rei) y permitir
-- recálculo desde un trigger T8b-quote que también actualice los totales del
-- header, las dropeamos y las re-creamos como NUMERIC NULL regulares.
-- El trigger T8b-quote (aplicado fuera de esta migration) las mantiene.
-- =============================================================================
DO $$
DECLARE
  is_generated TEXT;
BEGIN
  -- subtotal
  SELECT is_generated INTO is_generated
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='quote_lines' AND column_name='subtotal';
  IF is_generated = 'ALWAYS' THEN
    ALTER TABLE quote_lines DROP COLUMN subtotal;
    ALTER TABLE quote_lines ADD  COLUMN subtotal NUMERIC NULL;
  END IF;

  -- tax_amount
  SELECT is_generated INTO is_generated
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='quote_lines' AND column_name='tax_amount';
  IF is_generated = 'ALWAYS' THEN
    ALTER TABLE quote_lines DROP COLUMN tax_amount;
    ALTER TABLE quote_lines ADD  COLUMN tax_amount NUMERIC NULL;
  END IF;

  -- line_total
  SELECT is_generated INTO is_generated
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='quote_lines' AND column_name='line_total';
  IF is_generated = 'ALWAYS' THEN
    ALTER TABLE quote_lines DROP COLUMN line_total;
    ALTER TABLE quote_lines ADD  COLUMN line_total NUMERIC NULL;
  END IF;
END $$;

-- =============================================================================
-- 6. quote_terms_template — CREATE TABLE + seed plantilla T&C panameña
-- -----------------------------------------------------------------------------
-- Una fila por tenant (UNIQUE en tenant_id, sin DEFAULT get_tenant_id() para
-- que el INSERT siempre sea explícito). D4: snapshot al crear cotización.
-- D9: solo admin puede editar (gate en API, no en RLS).
-- =============================================================================
CREATE TABLE IF NOT EXISTS quote_terms_template (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  updated_by  UUID NULL REFERENCES public.users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE quote_terms_template ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_terms_template_tenant_isolation ON quote_terms_template;
CREATE POLICY quote_terms_template_tenant_isolation ON quote_terms_template
  FOR ALL USING (tenant_id = public.get_tenant_id());

-- Seed: plantilla T&C panameña por defecto para el tenant Integra Legal.
-- Se inserta solo si todavía no existe (idempotencia).
INSERT INTO quote_terms_template (tenant_id, content)
SELECT 'a0000000-0000-0000-0000-000000000001'::UUID,
$tc$
TÉRMINOS Y CONDICIONES

1. ALCANCE DEL SERVICIO
   Los servicios profesionales descritos en esta cotización serán prestados
   por Integra Legal en estricto cumplimiento de las normas éticas y
   profesionales aplicables al ejercicio de la abogacía en la República de
   Panamá.

2. HONORARIOS
   Los honorarios profesionales detallados en esta cotización están
   expresados en dólares de los Estados Unidos de América (USD), incluyen
   el Impuesto sobre la Transferencia de Bienes Corporales Muebles y la
   Prestación de Servicios (ITBMS) cuando aplica, y NO incluyen reembolsos
   de gastos administrativos, judiciales, registrales, notariales ni
   tributarios, los cuales serán facturados por separado.

3. FORMA DE PAGO
   Salvo acuerdo escrito en contrario, los honorarios se facturarán al
   inicio de la prestación del servicio. Los reembolsos de gastos se
   facturarán a medida que se incurran y deberán ser cancelados dentro de
   los términos acordados al emitir cada factura.

4. VALIDEZ DE LA OFERTA
   Esta cotización es válida hasta la fecha indicada en el campo "Válida
   hasta". Pasada esa fecha, los términos podrán ser revisados sin previo
   aviso.

5. CONFIDENCIALIDAD
   Toda información intercambiada entre el Cliente e Integra Legal en el
   marco de esta cotización y de los servicios contratados está protegida
   por el secreto profesional regulado por el Código de Ética y Decoro
   Profesional del Abogado y por las leyes de la República de Panamá.

6. ACEPTACIÓN
   La aceptación expresa de esta cotización por parte del Cliente —ya sea
   electrónicamente a través del portal o por confirmación escrita—
   constituye un acuerdo vinculante para la prestación de los servicios
   descritos, sujeto a estos Términos y Condiciones.

7. JURISDICCIÓN
   Cualquier controversia derivada de la prestación de los servicios será
   sometida a la jurisdicción de los tribunales de la República de Panamá,
   con renuncia expresa a cualquier otro fuero que pudiera corresponder.
$tc$
WHERE NOT EXISTS (
  SELECT 1 FROM quote_terms_template
  WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID
);

-- =============================================================================
-- 7. numbering_sequences — confirmar sequence_type='quote'
-- -----------------------------------------------------------------------------
-- Esta secuencia ya debería existir desde el Batch 3 (numbering_sequences se
-- creó en 20260505000004 con seed para invoice_hon, invoice_reim, quote y
-- credit_note). Este bloque es defensivo: si por algún motivo no existe la
-- fila, la inserta con last_number=0.
-- =============================================================================
INSERT INTO numbering_sequences (tenant_id, sequence_type, last_number)
SELECT 'a0000000-0000-0000-0000-000000000001'::UUID, 'quote', 0
WHERE NOT EXISTS (
  SELECT 1 FROM numbering_sequences
  WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::UUID
    AND sequence_type = 'quote'
);

-- =============================================================================
-- 8. Comments para documentación in-DB
-- =============================================================================
COMMENT ON COLUMN quotes.terms_and_conditions IS
  'Snapshot de los Términos y Condiciones al crear la cotización (D4). Si NULL, la UI debe mostrar el contenido de quote_terms_template del tenant. Una vez enviada (status=enviada), no se debe modificar (T4-quote enforza).';

COMMENT ON COLUMN quotes.public_token IS
  'Token aleatorio (UUID v4) para el portal público de aprobación. NULL antes del envío. Se genera al ejecutar sendQuote() y se incluye en el link al cliente.';

COMMENT ON COLUMN quotes.converted_invoice_ids IS
  'Array UUID[] con los IDs de las facturas generadas al convertir la cotización (D2). Una factura por invoice_kind presente en las líneas (HON y/o REI), por lo que el array tiene 1 o 2 elementos. NULL hasta que status=convertida.';

COMMENT ON COLUMN quote_lines.invoice_kind IS
  'Tipo de factura que generará esta línea al convertir la cotización (D2): HON (honorarios) o REI (reembolso). Permite mezclar ambos en una misma cotización; al convertir, las líneas se agrupan por invoice_kind y cada grupo genera una factura separada.';

COMMENT ON TABLE quote_terms_template IS
  'Plantilla editable de Términos y Condiciones por tenant (D4). Una fila por tenant (UNIQUE constraint). Solo admin puede editarla (gate en API, ver D9). Se snapshot-ea al crear cada cotización en quotes.terms_and_conditions para preservar el contenido vigente al momento del envío.';

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. quotes: 35 columnas total
-- SELECT COUNT(*) FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='quotes';
-- Esperado: 35.

-- 2. quote_lines: 18 columnas total
-- SELECT COUNT(*) FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='quote_lines';
-- Esperado: 18.

-- 3. CHECK status actualizado
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid='public.quotes'::regclass AND conname='quotes_status_check';

-- 4. quote_terms_template existe y tiene la fila seed
-- SELECT tenant_id, length(content) AS content_len, updated_at
-- FROM quote_terms_template;

-- 5. numbering_sequences tiene la fila quote
-- SELECT tenant_id, sequence_type, last_number FROM numbering_sequences
-- WHERE sequence_type='quote';

-- =============================================================================
-- ROLLBACK (no recomendado — pierde T&C template y conversiones registradas)
-- =============================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS quote_terms_template;
--   ALTER TABLE quote_lines DROP CONSTRAINT IF EXISTS quote_lines_invoice_kind_valid;
--   ALTER TABLE quote_lines DROP COLUMN IF EXISTS invoice_kind;
--   ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_subtotal_kind_non_negative;
--   ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
--   ALTER TABLE quotes ADD  CONSTRAINT quotes_status_check
--     CHECK (status IN ('borrador','enviada','aceptada','rechazada','expirada'));
--   ALTER TABLE quotes DROP COLUMN IF EXISTS converted_by;
--   ALTER TABLE quotes DROP COLUMN IF EXISTS converted_invoice_ids;
--   ALTER TABLE quotes DROP COLUMN IF EXISTS converted_at;
--   -- ... etc para las 19 columnas
-- COMMIT;

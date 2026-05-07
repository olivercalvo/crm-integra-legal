-- =============================================================================
-- FEATURE: Finanzas — anulación de facturas con razón persistida
-- Fecha: 2026-05-07
-- Sprint: Fase 2B-MVP — Extensión Sprint Camino 1 (Anular factura desde UI)
--
-- Contexto:
--   El MVP actual deja a las abogadas sin manera de "deshacer" una factura
--   emitida — el único camino era pedirle al admin que tocase el SQL en
--   Supabase. Producción no expone SQL, así que se necesita una vía de UI.
--
--   T2 (status transition validator, Batch 3e) ya permite las transiciones:
--     emitida              → anulada
--     parcialmente_pagada  → anulada
--   T4 (immutability) permite cambios de status post-emisión por diseño.
--
--   Esta migración SOLO agrega las 2 columnas necesarias para que la
--   anulación quede auditable. La razón es texto libre porque la nomenclatura
--   oficial DGI todavía no se concretó (la mapearemos a códigos cuando llegue
--   integración Camino 2 — eFactura tiene un endpoint de anulación con
--   razón estructurada que poblará retroactivamente este mismo campo).
--
--   NO toca T2 ni T4. Las nuevas columnas no están en la whitelist de T4
--   (solo restringe invoice_number, *_total, dates, client_id, etc.) → son
--   modificables tras emisión sin necesidad de modificar el trigger.
--
-- Tablas afectadas:
--   - public.invoices (ALTER, agrega 2 columnas, ningún CHECK adicional)
--
-- Columnas agregadas:
--   cancellation_reason  TEXT          — razón libre que captura la abogada
--                                          al anular. Validación de longitud
--                                          (>=3) en la app, no en DB, para
--                                          permitir anulaciones masivas
--                                          retroactivas con strings cortos
--                                          si DGI los devuelve así.
--   cancelled_at         TIMESTAMPTZ   — timestamp del momento exacto de
--                                          anulación. Lo escribe la app
--                                          (NOW()) — no usamos default porque
--                                          una factura no anulada debe tener
--                                          NULL acá, no la fecha de creación.
--
-- Convención del repo: NO se usan enums, NO se modifican triggers existentes,
-- ADD COLUMN idempotente.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (proyecto del cliente
--   Integra Legal).
--
-- Reversibilidad:
--   ADD COLUMN no es destructivo. El rollback (al final del archivo) hace
--   DROP COLUMN IF EXISTS de las 2 columnas. Pierde solo razón + timestamp
--   de anulación, no el status='anulada' (que vive en la columna status).
--   Las facturas que estuvieran anuladas siguen anuladas tras rollback,
--   solo se pierde la trazabilidad del por qué.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Agregar columnas (idempotente: ADD COLUMN IF NOT EXISTS)
-- -----------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancellation_reason TEXT        NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ NULL;

-- -----------------------------------------------------------------------------
-- 2. COMMENT ON COLUMN — documentación para el siguiente DBA / developer
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN invoices.cancellation_reason IS
  'Razón libre que captura la abogada al anular la factura desde la UI. '
  'Validación de longitud (>=3 caracteres trim) se hace en la app, no en DB. '
  'Se llena junto con UPDATE status=''anulada''. Cuando llegue la integración '
  'con eFactura DGI (Camino 2), este campo se mapeará a los códigos oficiales '
  'de motivo de anulación que requiere el endpoint de anulación electrónica.';

COMMENT ON COLUMN invoices.cancelled_at IS
  'Timestamp UTC del momento exacto en que se anuló la factura desde la UI. '
  'NULL para facturas no anuladas. Lo escribe la app via NOW() en el mismo '
  'UPDATE que cambia status a ''anulada''. Distinto de updated_at: cancelled_at '
  'es inmutable post-anulación (nada lo modifica), updated_at se actualiza '
  'con cualquier UPDATE posterior (ej. registro tardío de datos DGI).';

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Listar las 2 columnas nuevas (deben aparecer todas, is_nullable=YES):
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'invoices'
  AND  column_name IN ('cancellation_reason', 'cancelled_at')
ORDER BY column_name;
-- Esperado: 2 filas, is_nullable='YES', column_default NULL.

-- 2. Confirmar que los COMMENTS quedaron registrados:
SELECT a.attname AS column_name,
       pg_catalog.col_description(a.attrelid, a.attnum) AS comment
FROM   pg_catalog.pg_attribute a
WHERE  a.attrelid = 'public.invoices'::regclass
  AND  a.attname IN ('cancellation_reason', 'cancelled_at')
ORDER BY a.attname;
-- Esperado: 2 filas con su comment correspondiente (no NULL).

-- 3. Smoke check de no-regresión: T2 y T4 siguen activos sobre invoices:
SELECT tgname, tgenabled
FROM   pg_trigger
WHERE  tgrelid = 'public.invoices'::regclass
  AND  tgname IN ('trg_invoice_status_transition', 'trg_invoice_immutability')
ORDER BY tgname;
-- Esperado: 2 filas, tgenabled='O' en ambas.

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: el rollback descarta razón + timestamp de las facturas anuladas.
-- El status='anulada' permanece (vive en otra columna). Antes del rollback
-- considerá exportar:
--   SELECT id, invoice_number, status, cancellation_reason, cancelled_at
--   FROM   invoices
--   WHERE  cancellation_reason IS NOT NULL
--      OR  cancelled_at        IS NOT NULL;
-- =============================================================================
-- BEGIN;
--
-- ALTER TABLE invoices DROP COLUMN IF EXISTS cancelled_at;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS cancellation_reason;
--
-- COMMIT;

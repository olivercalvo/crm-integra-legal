-- =============================================================================
-- ⚠️ YA APLICADO EN PRODUCCION: 2026-05-08
-- Este archivo es retro-documentación del cambio aplicado manualmente en
-- Supabase SQL Editor durante el Sprint 2E.1 Fase A (Cotizaciones).
--
-- NO REAPLICAR. Si necesitas reproducir el schema en una BD nueva, ejecutá
-- secuencialmente todas las migrations del directorio. Los bloques DO $$
-- defensivos hacen que la re-aplicación sea idempotente, pero el flujo
-- canónico es ejecutar todo desde cero.
-- =============================================================================
-- FEATURE: clients — soporte de prospects vía flag client_status
-- Sprint:  2E.1 (Cotizaciones) — Decisiones D10-D13
--
-- Contexto:
--   El módulo Cotizaciones (D10) permite crear cotizaciones para clientes
--   nuevos sin obligar a capturar todos los datos fiscales todavía. Esto
--   implica un estado intermedio "prospect" en la tabla clients (D11).
--
--   Decisiones D10-D13:
--     D10: Cliente nuevo en cotización → permitido como prospect.
--     D11: Schema → misma tabla `clients` con flag `client_status`.
--     D12: Promoción prospect → active es manual desde el módulo Clientes.
--     D13: Datos mínimos del prospect: nombre + email + teléfono + tipo
--          (persona_natural | persona_juridica).
--
-- Tablas afectadas:
--   - public.clients (ADD client_status, ADD client_type, hotfix de `active`)
--
-- Columnas agregadas:
--   client_status  TEXT NOT NULL DEFAULT 'active'
--                  CHECK ∈ ('prospect','active','inactive')
--   client_type    TEXT NULL
--                  CHECK NULL OR ∈ ('persona_natural','persona_juridica')
--
-- ⚠️ HOTFIX aplicado durante este sprint:
--   Se intentó dropear la columna `active BOOLEAN` legacy. El código del
--   módulo Clientes (15 referencias detectadas en el audit de Fase B)
--   consultaba WHERE active=true / leía .active en TS, lo que rompió la app.
--   Se re-creó `active` como columna GENERATED ALWAYS AS (client_status =
--   'active') STORED para retrocompatibilidad. El refactor del código
--   (clients.active → client_status) se hizo en Fase B del mismo sprint;
--   el DROP definitivo de `active` se aplicará en una migration separada
--   (Fase F) al final del sprint, después del merge a main verificado.
--
-- Backfill aplicado en prod:
--   - 31 clientes inferidos como persona_natural
--   - 28 clientes inferidos como persona_juridica
--   -  4 clientes con client_type=NULL (datos insuficientes para inferir)
--   - 63 clientes total, todos con client_status='active'
--
-- Reversibilidad:
--   ADD COLUMN no es destructivo. La columna generada `active` se puede
--   reemplazar por una BOOLEAN regular si se requiere. El DROP de las
--   columnas nuevas pierde el dato capturado en client_type (no recuperable
--   automáticamente).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Agregar columnas (idempotente)
-- -----------------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type   TEXT NULL;

-- -----------------------------------------------------------------------------
-- 2. CHECK constraints nombrados (idempotente: DROP IF EXISTS + ADD)
--    Patrón estándar del repo (ver 20260505000001_finanzas_extend_clients).
-- -----------------------------------------------------------------------------
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_valid;
ALTER TABLE clients
  ADD CONSTRAINT clients_status_valid
  CHECK (client_status IN ('prospect','active','inactive'));

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_type_valid;
ALTER TABLE clients
  ADD CONSTRAINT clients_type_valid
  CHECK (client_type IS NULL OR client_type IN ('persona_natural','persona_juridica'));

-- -----------------------------------------------------------------------------
-- 3. Defensivo: asegurar que no hay clientes sin client_status (DEFAULT cubre,
--    pero por si la columna se agregó en estado inconsistente).
-- -----------------------------------------------------------------------------
UPDATE clients SET client_status = 'active' WHERE client_status IS NULL;

-- -----------------------------------------------------------------------------
-- 4. Index para queries por estado (los listados filtran por client_status)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients (tenant_id, client_status);

-- -----------------------------------------------------------------------------
-- 5. HOTFIX: re-crear `active` como columna generada
-- -----------------------------------------------------------------------------
-- Si la columna existe como BOOLEAN regular (estado pre-hotfix), dropearla.
-- Si ya está GENERATED, este branch no se ejecuta.
DO $$
DECLARE
  is_generated TEXT;
BEGIN
  SELECT c.is_generated
  INTO   is_generated
  FROM   information_schema.columns c
  WHERE  c.table_schema = 'public'
    AND  c.table_name   = 'clients'
    AND  c.column_name  = 'active';

  IF is_generated IS NULL THEN
    -- No existe la columna: estado intermedio, crearla generada.
    ALTER TABLE clients
      ADD COLUMN active BOOLEAN GENERATED ALWAYS AS (client_status = 'active') STORED;
  ELSIF is_generated = 'NEVER' THEN
    -- Existe como BOOLEAN regular (estado pre-hotfix). Drop + re-add generated.
    ALTER TABLE clients DROP COLUMN active;
    ALTER TABLE clients
      ADD COLUMN active BOOLEAN GENERATED ALWAYS AS (client_status = 'active') STORED;
  END IF;
  -- Si is_generated = 'ALWAYS', ya está OK, no hacer nada.
END $$;

-- -----------------------------------------------------------------------------
-- 6. Comments para documentación in-DB
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN clients.client_status IS
  'Estado del registro: prospect (datos mínimos, no facturable), active (datos completos para facturación), inactive (archivado/soft-deleted). Default ''active'' para retrocompatibilidad con clientes legacy.';

COMMENT ON COLUMN clients.client_type IS
  'Tipo de persona fiscal: persona_natural (usa cédula/pasaporte) o persona_juridica (usa RUC corporativo). NULL en registros legacy donde no se distinguió.';

COMMENT ON COLUMN clients.active IS
  'DEPRECATED — columna GENERATED ALWAYS AS (client_status = ''active'') STORED para retrocompatibilidad. Se eliminará en una migration separada al final del Sprint 2E.1 (Fase F) una vez que TODAS las referencias en código hayan sido refactorizadas a client_status. NO escribir nuevo código que dependa de este campo.';

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Listar las 3 columnas (client_status, client_type, active):
-- SELECT column_name, data_type, is_nullable, column_default, is_generated
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public' AND table_name = 'clients'
--   AND  column_name IN ('client_status','client_type','active')
-- ORDER BY column_name;
-- Esperado:
--   active        | boolean | NO  |        | ALWAYS
--   client_status | text    | NO  | active | NEVER
--   client_type   | text    | YES |        | NEVER

-- 2. Distribución de client_status (debe coincidir con el conteo total):
-- SELECT client_status, COUNT(*) FROM clients GROUP BY client_status;

-- 3. Verificar que `active` refleja correctamente client_status:
-- SELECT client_status, active, COUNT(*) FROM clients GROUP BY client_status, active;
-- Esperado: solo (active, true) y (prospect|inactive, false), nunca (active, false).

-- =============================================================================
-- ROLLBACK (no recomendado — pierde client_type capturado manualmente)
-- =============================================================================
-- BEGIN;
--   ALTER TABLE clients DROP COLUMN IF EXISTS active;
--   ALTER TABLE clients ADD  COLUMN active BOOLEAN NOT NULL DEFAULT true;
--   ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_type_valid;
--   ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_valid;
--   DROP INDEX IF EXISTS clients_status_idx;
--   ALTER TABLE clients DROP COLUMN IF EXISTS client_type;
--   ALTER TABLE clients DROP COLUMN IF EXISTS client_status;
-- COMMIT;

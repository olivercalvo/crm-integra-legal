-- =============================================================================
-- FIX: Actualizar colores de clasificaciones al Excel oficial del despacho
-- Fecha: 2026-04-09
-- Tenant: a0000000-0000-0000-0000-000000000001
-- Descripcion: Actualiza SOLO la columna color en cat_classifications.
--              NO toca ninguna otra tabla ni columna.
-- Colores oficiales del Excel de Integra Legal:
--   CORPORATIVO     CORP  #1F4E79
--   MIGRACIÓN       MIG   #2E7D32
--   LABORAL         LAB   #E65100
--   PENAL           PEN   #B71C1C
--   CIVIL           CIV   #6A1B9A
--   ADMINISTRATIVO  ADM   #455A64
--   REGULATORIO     REG   #F57F17
-- =============================================================================

-- =============================================================================
-- PASO 1: VERIFICACIÓN — Ver colores actuales vs nuevos
-- =============================================================================

SELECT
  name,
  prefix,
  color AS color_actual,
  CASE prefix
    WHEN 'CORP' THEN '#1F4E79'
    WHEN 'MIG'  THEN '#2E7D32'
    WHEN 'LAB'  THEN '#E65100'
    WHEN 'PEN'  THEN '#B71C1C'
    WHEN 'CIV'  THEN '#6A1B9A'
    WHEN 'ADM'  THEN '#455A64'
    WHEN 'REG'  THEN '#F57F17'
    ELSE color
  END AS color_nuevo,
  CASE WHEN color = CASE prefix
    WHEN 'CORP' THEN '#1F4E79'
    WHEN 'MIG'  THEN '#2E7D32'
    WHEN 'LAB'  THEN '#E65100'
    WHEN 'PEN'  THEN '#B71C1C'
    WHEN 'CIV'  THEN '#6A1B9A'
    WHEN 'ADM'  THEN '#455A64'
    WHEN 'REG'  THEN '#F57F17'
    ELSE color
  END THEN 'SIN CAMBIO' ELSE 'CAMBIA' END AS estado
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND active = true
ORDER BY name;

-- =============================================================================
-- PASO 2: ACTUALIZACIÓN — Ejecutar SOLO después de verificar el paso 1
-- =============================================================================

BEGIN;

UPDATE cat_classifications SET color = '#1F4E79' WHERE prefix = 'CORP' AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE cat_classifications SET color = '#2E7D32' WHERE prefix = 'MIG'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE cat_classifications SET color = '#E65100' WHERE prefix = 'LAB'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE cat_classifications SET color = '#B71C1C' WHERE prefix = 'PEN'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE cat_classifications SET color = '#6A1B9A' WHERE prefix = 'CIV'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE cat_classifications SET color = '#455A64' WHERE prefix = 'ADM'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE cat_classifications SET color = '#F57F17' WHERE prefix = 'REG'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';

COMMIT;

-- =============================================================================
-- ROLLBACK — Restaurar colores anteriores (de la migración original)
-- =============================================================================
-- BEGIN;
-- UPDATE cat_classifications SET color = '#2563EB' WHERE prefix = 'CORP' AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- UPDATE cat_classifications SET color = '#EA580C' WHERE prefix = 'MIG'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- UPDATE cat_classifications SET color = '#9333EA' WHERE prefix = 'LAB'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- UPDATE cat_classifications SET color = '#DC2626' WHERE prefix = 'PEN'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- UPDATE cat_classifications SET color = '#0D9488' WHERE prefix = 'CIV'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- UPDATE cat_classifications SET color = '#6B7280' WHERE prefix = 'ADM'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- UPDATE cat_classifications SET color = '#16A34A' WHERE prefix = 'REG'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- COMMIT;

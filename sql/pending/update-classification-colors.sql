-- =============================================================================
-- FIX: Actualizar colores de clasificaciones al Excel oficial del despacho
-- Fecha: 2026-04-08
-- Tenant: a0000000-0000-0000-0000-000000000001
-- Descripcion: Los colores actuales no coinciden con los definidos por el
--              despacho. Se actualizan SOLO los campos de color.
-- =============================================================================

-- =============================================================================
-- PASO 1: VERIFICACION — Ejecutar PRIMERO para ver colores actuales vs nuevos
-- =============================================================================

SELECT
  name,
  prefix,
  color AS color_actual,
  CASE
    WHEN UPPER(name) LIKE '%CORPORATIVO%'    THEN '#1F4E79'
    WHEN UPPER(name) LIKE '%MIGRA%'          THEN '#2E7D32'
    WHEN UPPER(name) LIKE '%LABORAL%'        THEN '#E65100'
    WHEN UPPER(name) LIKE '%PENAL%'          THEN '#B71C1C'
    WHEN UPPER(name) LIKE '%CIVIL%'          THEN '#6A1B9A'
    WHEN UPPER(name) LIKE '%ADMINISTRATIVO%' THEN '#455A64'
    WHEN UPPER(name) LIKE '%REGULATORIO%'    THEN '#F57F17'
    ELSE color
  END AS color_nuevo,
  CASE
    WHEN color = CASE
      WHEN UPPER(name) LIKE '%CORPORATIVO%'    THEN '#1F4E79'
      WHEN UPPER(name) LIKE '%MIGRA%'          THEN '#2E7D32'
      WHEN UPPER(name) LIKE '%LABORAL%'        THEN '#E65100'
      WHEN UPPER(name) LIKE '%PENAL%'          THEN '#B71C1C'
      WHEN UPPER(name) LIKE '%CIVIL%'          THEN '#6A1B9A'
      WHEN UPPER(name) LIKE '%ADMINISTRATIVO%' THEN '#455A64'
      WHEN UPPER(name) LIKE '%REGULATORIO%'    THEN '#F57F17'
      ELSE color
    END THEN 'SIN CAMBIO'
    ELSE 'CAMBIA'
  END AS estado
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND active = true
ORDER BY name;

-- =============================================================================
-- PASO 2: ACTUALIZACION — Ejecutar SOLO despues de verificar el paso 1
-- =============================================================================

BEGIN;

UPDATE cat_classifications
SET color = '#1F4E79'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND UPPER(name) LIKE '%CORPORATIVO%';

UPDATE cat_classifications
SET color = '#2E7D32'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND UPPER(name) LIKE '%MIGRA%';

UPDATE cat_classifications
SET color = '#E65100'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND UPPER(name) LIKE '%LABORAL%';

UPDATE cat_classifications
SET color = '#B71C1C'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND UPPER(name) LIKE '%PENAL%';

UPDATE cat_classifications
SET color = '#6A1B9A'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND UPPER(name) LIKE '%CIVIL%';

UPDATE cat_classifications
SET color = '#455A64'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND UPPER(name) LIKE '%ADMINISTRATIVO%';

UPDATE cat_classifications
SET color = '#F57F17'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND UPPER(name) LIKE '%REGULATORIO%';

COMMIT;

-- =============================================================================
-- ROLLBACK (comentado) — Restaurar colores anteriores si hay problemas
-- =============================================================================
-- BEGIN;
-- UPDATE cat_classifications SET color = '#2563EB' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND UPPER(name) LIKE '%CORPORATIVO%';
-- UPDATE cat_classifications SET color = '#EA580C' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND UPPER(name) LIKE '%MIGRA%';
-- UPDATE cat_classifications SET color = '#9333EA' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND UPPER(name) LIKE '%LABORAL%';
-- UPDATE cat_classifications SET color = '#DC2626' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND UPPER(name) LIKE '%PENAL%';
-- UPDATE cat_classifications SET color = '#0D9488' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND UPPER(name) LIKE '%CIVIL%';
-- UPDATE cat_classifications SET color = '#6B7280' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND UPPER(name) LIKE '%ADMINISTRATIVO%';
-- UPDATE cat_classifications SET color = '#16A34A' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND UPPER(name) LIKE '%REGULATORIO%';
-- COMMIT;

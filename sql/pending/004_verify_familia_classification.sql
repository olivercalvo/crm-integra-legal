-- =============================================================================
-- VERIFICACIÓN: ¿existe ya la clasificación FAMILIA?
-- Fecha: 2026-04-28
-- Tenant: a0000000-0000-0000-0000-000000000001 (Integra Legal)
-- Tabla: cat_classifications
-- Uso: ejecutar ANTES de 005_add_familia_classification.sql.
-- =============================================================================

-- 1. ¿FAMILIA / FAM ya existe en este tenant?
SELECT id, name, prefix, color, active, created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND (prefix = 'FAM' OR name ILIKE '%familia%');

-- Resultado esperado ANTES del INSERT: 0 filas.

-- 2. Listado completo del catálogo del tenant (contexto).
SELECT name, prefix, color, active, created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
ORDER BY name;

-- Resultado esperado: 8 filas
-- (CORPORATIVO/CORP, MIGRACIÓN/MIG, LABORAL/LAB, PENAL/PEN,
--  CIVIL/CIV, ADMINISTRATIVO/ADM, REGULATORIO/REG, EXTRAJUDICIAL/EXT).

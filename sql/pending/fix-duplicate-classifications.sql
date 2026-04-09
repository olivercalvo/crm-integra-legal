-- =============================================================================
-- FIX: Eliminar clasificaciones duplicadas en cat_classifications
-- Fecha: 2026-04-09
-- Tenant: a0000000-0000-0000-0000-000000000001
-- Descripcion: El dropdown muestra duplicados/triplicados. Este script:
--   1. Identifica TODOS los duplicados (por prefix), sin importar capitalización
--   2. Mantiene SOLO el registro más antiguo por prefix
--   3. Reasigna casos que referencian duplicados al registro canónico
--   4. Normaliza nombres a MAYÚSCULAS
-- SOLO toca tabla cat_classifications — NUNCA clients, cases (excepto reasignar FK)
-- =============================================================================

-- =============================================================================
-- PASO 1: VERIFICACIÓN — Ejecutar PRIMERO para revisar el estado actual
-- =============================================================================

-- 1a. Ver TODAS las clasificaciones del tenant (detectar duplicados)
SELECT id, name, prefix, color, active, created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
ORDER BY prefix, created_at;

-- 1b. Identificar el registro CANÓNICO por cada prefix (el más antiguo)
SELECT DISTINCT ON (UPPER(prefix))
  id AS canonical_id,
  name AS canonical_name,
  prefix,
  created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
ORDER BY UPPER(prefix), created_at ASC;

-- 1c. Identificar los DUPLICADOS a eliminar (todos excepto el más antiguo por prefix)
SELECT id AS duplicate_id, name, prefix, created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND id NOT IN (
    SELECT DISTINCT ON (UPPER(prefix)) id
    FROM cat_classifications
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
    ORDER BY UPPER(prefix), created_at ASC
  )
ORDER BY prefix, created_at;

-- 1d. Casos que referencian duplicados (serán reasignados)
SELECT c.id AS case_id, c.case_code, c.classification_id,
       cl.name AS current_classification
FROM cases c
JOIN cat_classifications cl ON c.classification_id = cl.id
WHERE c.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND c.classification_id NOT IN (
    SELECT DISTINCT ON (UPPER(prefix)) id
    FROM cat_classifications
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
    ORDER BY UPPER(prefix), created_at ASC
  )
ORDER BY cl.prefix;

-- =============================================================================
-- PASO 2: OLIVER REVISA los resultados anteriores antes de continuar
-- =============================================================================

-- =============================================================================
-- PASO 3: CORRECCIÓN — Ejecutar SOLO después de verificar pasos 1 y 2
-- Descomentar el bloque BEGIN...COMMIT para ejecutar
-- =============================================================================

-- BEGIN;
--
--   -- 3a. Reasignar casos que apuntan a duplicados → al registro canónico
--   UPDATE cases
--   SET classification_id = canonical.id,
--       updated_at = NOW()
--   FROM cat_classifications dup
--   JOIN (
--     SELECT DISTINCT ON (UPPER(prefix)) id, UPPER(prefix) AS norm_prefix
--     FROM cat_classifications
--     WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--     ORDER BY UPPER(prefix), created_at ASC
--   ) canonical ON UPPER(dup.prefix) = canonical.norm_prefix
--   WHERE cases.classification_id = dup.id
--     AND dup.tenant_id = 'a0000000-0000-0000-0000-000000000001'
--     AND dup.id <> canonical.id
--     AND cases.tenant_id = 'a0000000-0000-0000-0000-000000000001';
--
--   -- 3b. Eliminar duplicados (mantener solo el más antiguo por prefix)
--   DELETE FROM cat_classifications
--   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--     AND id NOT IN (
--       SELECT DISTINCT ON (UPPER(prefix)) id
--       FROM cat_classifications
--       WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--       ORDER BY UPPER(prefix), created_at ASC
--     );
--
--   -- 3c. Normalizar nombres a MAYÚSCULAS
--   UPDATE cat_classifications SET name = 'CORPORATIVO'    WHERE prefix = 'CORP' AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
--   UPDATE cat_classifications SET name = 'MIGRACIÓN'      WHERE prefix = 'MIG'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
--   UPDATE cat_classifications SET name = 'LABORAL'        WHERE prefix = 'LAB'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
--   UPDATE cat_classifications SET name = 'PENAL'          WHERE prefix = 'PEN'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
--   UPDATE cat_classifications SET name = 'CIVIL'          WHERE prefix = 'CIV'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
--   UPDATE cat_classifications SET name = 'ADMINISTRATIVO' WHERE prefix = 'ADM'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
--   UPDATE cat_classifications SET name = 'REGULATORIO'    WHERE prefix = 'REG'  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';
--
-- COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-FIX — Ejecutar después del COMMIT para confirmar
-- =============================================================================

-- Debe mostrar exactamente 7 registros, uno por prefix
-- SELECT id, name, prefix, color, created_at
-- FROM cat_classifications
-- WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND active = true
-- ORDER BY name;

-- =============================================================================
-- ROLLBACK (manual) — Documentar IDs originales del PASO 1a antes de ejecutar
-- =============================================================================
-- Si se necesita revertir, usar los resultados del paso 1a para recrear
-- los registros eliminados con INSERT INTO cat_classifications (...).

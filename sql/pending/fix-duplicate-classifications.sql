-- =============================================================================
-- FIX: Eliminar clasificaciones duplicadas en cat_classifications
-- Fecha: 2026-04-08
-- Tenant: a0000000-0000-0000-0000-000000000001
-- Descripcion: El dropdown muestra duplicados (MAYUSCULAS y mixed case).
--              Mantener SOLO los registros en MAYUSCULAS. Reasignar casos
--              que referencien los duplicados al registro correcto.
-- =============================================================================

-- =============================================================================
-- PASO 1: VERIFICACION — Ejecutar PRIMERO para revisar que se va a cambiar
-- =============================================================================

-- 1a. Ver TODAS las clasificaciones del tenant (detectar duplicados)
SELECT id, name, prefix, color, active, created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
ORDER BY prefix, name;

-- 1b. Detectar duplicados: clasificaciones con el mismo prefix pero distinto case
SELECT
  a.id AS duplicate_id,
  a.name AS duplicate_name,
  a.prefix,
  b.id AS canonical_id,
  b.name AS canonical_name
FROM cat_classifications a
JOIN cat_classifications b
  ON a.tenant_id = b.tenant_id
  AND a.prefix = b.prefix
  AND a.id <> b.id
  AND b.name = UPPER(b.name)   -- el canonico esta en MAYUSCULAS
  AND a.name <> UPPER(a.name)  -- el duplicado NO esta en MAYUSCULAS
WHERE a.tenant_id = 'a0000000-0000-0000-0000-000000000001';

-- 1c. Casos que referencian clasificaciones duplicadas (las que se van a eliminar)
SELECT
  c.id AS case_id,
  c.case_code,
  c.description,
  c.classification_id,
  dup.name AS current_classification_name,
  canon.id AS new_classification_id,
  canon.name AS new_classification_name
FROM cases c
JOIN cat_classifications dup ON c.classification_id = dup.id
JOIN cat_classifications canon
  ON dup.tenant_id = canon.tenant_id
  AND dup.prefix = canon.prefix
  AND canon.name = UPPER(canon.name)
  AND dup.name <> UPPER(dup.name)
  AND canon.id <> dup.id
WHERE c.tenant_id = 'a0000000-0000-0000-0000-000000000001';

-- =============================================================================
-- PASO 2: CORRECCION — Ejecutar SOLO despues de verificar el paso 1
-- =============================================================================

BEGIN;

-- 2a. Reasignar casos que apuntan a clasificaciones duplicadas → al registro canonico (MAYUSCULAS)
UPDATE cases
SET classification_id = canon.id,
    updated_at = NOW()
FROM cat_classifications dup
JOIN cat_classifications canon
  ON dup.tenant_id = canon.tenant_id
  AND dup.prefix = canon.prefix
  AND canon.name = UPPER(canon.name)
  AND dup.name <> UPPER(dup.name)
  AND canon.id <> dup.id
WHERE cases.classification_id = dup.id
  AND cases.tenant_id = 'a0000000-0000-0000-0000-000000000001';

-- 2b. Eliminar las clasificaciones duplicadas (las que NO estan en MAYUSCULAS)
DELETE FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND name <> UPPER(name)
  AND prefix IN (
    SELECT prefix FROM cat_classifications
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
    GROUP BY prefix
    HAVING COUNT(*) > 1
  );

COMMIT;

-- =============================================================================
-- ROLLBACK (comentado) — En caso de problemas, ejecutar esto para revertir
-- =============================================================================
-- NOTA: Si ya se hizo COMMIT, este rollback no aplica automaticamente.
-- Habria que recrear los registros eliminados manualmente.
-- Los IDs originales se pueden obtener del SELECT de verificacion (paso 1a).
--
-- Para revertir los casos reasignados:
-- UPDATE cases SET classification_id = '<duplicate_id_original>' WHERE id IN ('<case_ids_afectados>');
--
-- Para recrear clasificaciones eliminadas:
-- INSERT INTO cat_classifications (id, tenant_id, name, prefix, color, active, created_at)
-- VALUES ('<id_original>', 'a0000000-0000-0000-0000-000000000001', '<nombre_original>', '<prefix>', '<color>', true, '<created_at>');

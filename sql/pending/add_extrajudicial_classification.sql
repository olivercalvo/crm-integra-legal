-- =============================================================================
-- FEATURE: Agregar nueva clasificación EXTRAJUDICIAL al catálogo
-- Fecha: 2026-04-20
-- Tenant: a0000000-0000-0000-0000-000000000001 (Integra Legal)
-- Descripción:
--   Inserta una nueva fila en cat_classifications con:
--     name='EXTRAJUDICIAL', prefix='EXT', color='#00695C', active=true.
--   Habilita el dropdown del formulario de casos a usarla y permite que
--   el endpoint /api/cases?classification_id=<id> sugiera correlativos
--   EXT-001, EXT-002, ... automáticamente (la lógica es por prefijo).
-- NOTA:
--   La tabla cat_classifications NO tiene UNIQUE(tenant_id, prefix), pero
--   el INSERT está condicionado con NOT EXISTS para evitar duplicados si
--   el script se corre dos veces.
-- =============================================================================

-- =============================================================================
-- PASO 1 — VERIFICACIÓN: ver clasificaciones actuales del tenant
-- =============================================================================

SELECT
  name,
  prefix,
  color,
  active,
  created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
ORDER BY name;

-- Resultado esperado ANTES de ejecutar PASO 2: 7 filas
-- (CORPORATIVO/CORP, MIGRACIÓN/MIG, LABORAL/LAB, PENAL/PEN,
--  CIVIL/CIV, ADMINISTRATIVO/ADM, REGULATORIO/REG).

-- =============================================================================
-- PASO 2 — INSERT (ejecutar SOLO después de verificar el paso 1)
-- =============================================================================

BEGIN;

INSERT INTO cat_classifications (tenant_id, name, prefix, description, color, active)
SELECT
  'a0000000-0000-0000-0000-000000000001',
  'EXTRAJUDICIAL',
  'EXT',
  'Procesos extrajudiciales',
  '#00695C',
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM cat_classifications
  WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
    AND prefix = 'EXT'
);

COMMIT;

-- =============================================================================
-- PASO 3 — VERIFICACIÓN POST-INSERT
-- =============================================================================

SELECT
  name,
  prefix,
  color,
  active
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND prefix = 'EXT';

-- Resultado esperado: 1 fila con name='EXTRAJUDICIAL', prefix='EXT',
-- color='#00695C', active=true.

-- =============================================================================
-- ROLLBACK — Eliminar la clasificación EXTRAJUDICIAL recién creada.
-- Sólo debe ejecutarse si NO se ha asignado a ningún caso todavía.
-- (cases.classification_id es ON DELETE NO ACTION; un DELETE fallaría si
-- hay casos referenciándola.)
-- =============================================================================
-- BEGIN;
-- DELETE FROM cat_classifications
-- WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND prefix = 'EXT'
--   AND NOT EXISTS (
--     SELECT 1 FROM cases
--     WHERE classification_id = cat_classifications.id
--   );
-- COMMIT;

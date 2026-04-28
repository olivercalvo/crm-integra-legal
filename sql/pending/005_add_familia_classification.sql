-- =============================================================================
-- FEATURE: Agregar nueva clasificación FAMILIA al catálogo
-- Fecha: 2026-04-28
-- Tenant: a0000000-0000-0000-0000-000000000001 (Integra Legal)
-- Datos:
--   name='FAMILIA', prefix='FAM', color='#00838F' (turquesa oscuro), active=true
--   description='Procesos de derecho de familia'
-- Notas:
--   - Idempotente: usa NOT EXISTS para no duplicar si se corre dos veces.
--   - El INSERT en audit_log replica el patrón de
--     src/app/api/admin/catalogs/route.ts (entity = nombre de tabla,
--     new_value = JSON con el payload).
--   - user_id se resuelve por subquery al primer admin activo del tenant;
--     si no hay admin, queda NULL (la columna user_id es nullable).
--   - Texto del badge: blanco. La función getClassificationTextColor de
--     src/lib/utils/classification-colors.ts ya devuelve "#FFFFFF" para
--     cualquier color que no sea el amarillo de REGULATORIO.
-- =============================================================================

-- =============================================================================
-- PASO 1 — INSERT (transaccional)
-- =============================================================================

BEGIN;

-- 1.a — Insertar la clasificación si no existe.
INSERT INTO cat_classifications (tenant_id, name, prefix, description, color, active)
SELECT
  'a0000000-0000-0000-0000-000000000001',
  'FAMILIA',
  'FAM',
  'Procesos de derecho de familia',
  '#00838F',
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM cat_classifications
  WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
    AND prefix = 'FAM'
);

-- 1.b — Registrar la creación en audit_log (idempotente: solo si aún no existe
-- una entrada 'create' para esta clasificación).
INSERT INTO audit_log (tenant_id, user_id, entity, entity_id, action, field, old_value, new_value)
SELECT
  'a0000000-0000-0000-0000-000000000001',
  (SELECT id FROM users
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
      AND role = 'admin' AND active = true
    ORDER BY created_at LIMIT 1),
  'cat_classifications',
  cc.id,
  'create',
  NULL,
  NULL,
  '{"name":"FAMILIA","prefix":"FAM","description":"Procesos de derecho de familia","color":"#00838F","active":true}'
FROM cat_classifications cc
WHERE cc.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND cc.prefix = 'FAM'
  AND NOT EXISTS (
    SELECT 1 FROM audit_log al
    WHERE al.entity = 'cat_classifications'
      AND al.entity_id = cc.id
      AND al.action = 'create'
  );

COMMIT;

-- =============================================================================
-- PASO 2 — VERIFICACIÓN POST-INSERT
-- =============================================================================

SELECT id, name, prefix, color, active, created_at
FROM cat_classifications
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND prefix = 'FAM';

-- Resultado esperado: 1 fila con
--   name='FAMILIA', prefix='FAM', color='#00838F', active=true.

-- =============================================================================
-- ROLLBACK — Eliminar la clasificación FAMILIA recién creada.
-- Sólo si NO se ha asignado a ningún caso. cases.classification_id es
-- ON DELETE NO ACTION; un DELETE fallaría si hay casos referenciándola.
-- =============================================================================
-- BEGIN;
-- DELETE FROM audit_log
-- WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND entity = 'cat_classifications'
--   AND entity_id IN (
--     SELECT id FROM cat_classifications
--     WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--       AND prefix = 'FAM'
--   );
-- DELETE FROM cat_classifications
-- WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND prefix = 'FAM'
--   AND NOT EXISTS (
--     SELECT 1 FROM cases WHERE classification_id = cat_classifications.id
--   );
-- COMMIT;

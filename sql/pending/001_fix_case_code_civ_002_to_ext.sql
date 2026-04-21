-- =============================================================================
-- FIX: Corregir código del caso actualmente en CIV-002 (ya reclasificado
--      a EXTRAJUDICIAL) para que refleje el prefijo de su nueva clasificación.
-- Fecha: 2026-04-21
-- Tenant: a0000000-0000-0000-0000-000000000001 (Integra Legal)
-- Caso afectado:
--   Cliente: PRODUCTOS ALIMENTICIOS PASCUAL, S.A.
--   Descripción: RECUPERACION CARTERA MOROSA
--   Código actual: CIV-002
--   Clasificación actual: EXTRAJUDICIAL (ya cambiada, prefix=EXT)
--   Código correcto: EXT-NNN (el siguiente correlativo libre del prefijo EXT
--                             al momento de ejecutar este script).
--
-- NOTA MUY IMPORTANTE:
--   Este script se ejecuta SÓLO después de que la nueva lógica de recálculo
--   de código esté ya en producción. Oliver lo ejecuta manualmente en el
--   SQL Editor de Supabase tras validar en localhost.
--
-- Este script es SEGURO:
--   - Paso 1: verifica estado previo del caso y clasificación.
--   - Paso 2: calcula el siguiente correlativo EXT libre.
--   - Paso 3: UPDATE con doble verificación (id + tenant_id + case_code='CIV-002').
--   - Paso 4: verifica unicidad y estado post-update.
--   - Paso 5: registra el cambio en audit_log como corrección manual.
--   - Rollback comentado al final.
-- =============================================================================

-- =============================================================================
-- PASO 1 — VERIFICACIÓN PREVIA (SOLO LECTURA)
-- =============================================================================

-- 1.a — Estado actual del caso CIV-002 y su clasificación.
--       Debe devolver exactamente 1 fila con classification_name='EXTRAJUDICIAL'.
--       Si devuelve 0 filas o classification_name <> 'EXTRAJUDICIAL', ABORTAR.
SELECT
  c.id                AS case_id,
  c.case_code         AS current_code,
  c.description,
  cl.name             AS client_name,
  cat.name            AS classification_name,
  cat.prefix          AS classification_prefix,
  c.classification_id,
  c.updated_at
FROM cases c
JOIN clients cl                   ON cl.id = c.client_id AND cl.tenant_id = c.tenant_id
LEFT JOIN cat_classifications cat ON cat.id = c.classification_id
WHERE c.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND c.case_code = 'CIV-002';

-- 1.b — Último número EXT existente (para validar el cálculo del Paso 2).
--       Si no hay casos EXT, el MAX devuelve NULL (tratado como 0 → siguiente = EXT-001).
--       Si ya existe EXT-001, devolverá 1 → siguiente = EXT-002, y así sucesivamente.
SELECT
  MAX(CAST(SUBSTRING(case_code FROM '^EXT-(\d+)$') AS INTEGER)) AS max_ext_number
FROM cases
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND case_code ~ '^EXT-\d+$';

-- 1.c — Listado completo de códigos EXT existentes (solo visibilidad).
SELECT case_code
FROM cases
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND case_code ~ '^EXT-\d+$'
ORDER BY case_code;

-- =============================================================================
-- PASO 2 — CÁLCULO DEL NUEVO CÓDIGO
-- =============================================================================
-- Fórmula: siguiente = COALESCE(MAX(num), 0) + 1, padded a 3 dígitos.
-- Este SELECT muestra el código que se aplicará en el Paso 3.
-- Verificar que coincida con lo esperado (probablemente EXT-002) antes de seguir.

SELECT
  'EXT-' || LPAD(
    (COALESCE(
       MAX(CAST(SUBSTRING(case_code FROM '^EXT-(\d+)$') AS INTEGER)),
       0
     ) + 1)::TEXT,
    3,
    '0'
  ) AS next_ext_code
FROM cases
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND case_code ~ '^EXT-\d+$';

-- =============================================================================
-- PASO 3 — UPDATE ATÓMICO CON DOBLE VERIFICACIÓN
-- =============================================================================
-- Transacción única. El WHERE exige case_code='CIV-002' como doble seguro
-- además del id/tenant_id — si otro proceso ya lo cambió, 0 filas afectadas
-- y el COMMIT no altera nada.
--
-- El nuevo código se calcula dentro del UPDATE para evitar race conditions
-- entre el Paso 2 y el Paso 3.

BEGIN;

UPDATE cases
SET
  case_code = 'EXT-' || LPAD(
    (COALESCE(
       (SELECT MAX(CAST(SUBSTRING(c2.case_code FROM '^EXT-(\d+)$') AS INTEGER))
        FROM cases c2
        WHERE c2.tenant_id = 'a0000000-0000-0000-0000-000000000001'
          AND c2.case_code ~ '^EXT-\d+$'),
       0
     ) + 1)::TEXT,
    3,
    '0'
  ),
  updated_at = NOW()
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND case_code = 'CIV-002'
  AND classification_id IN (
    SELECT id FROM cat_classifications
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
      AND prefix = 'EXT'
  );

-- VERIFICAR antes de COMMIT: esta consulta debe mostrar exactamente 1 fila
-- con el nuevo code EXT-NNN y la clasificación correcta.
SELECT id, case_code, classification_id, updated_at
FROM cases
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_id IN (
    SELECT id FROM clients
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
      AND name = 'PRODUCTOS ALIMENTICIOS PASCUAL, S.A.'
  )
  AND description = 'RECUPERACION CARTERA MOROSA';

COMMIT;

-- =============================================================================
-- PASO 4 — VERIFICACIÓN POST-UPDATE
-- =============================================================================

-- 4.a — El caso ya NO existe como CIV-002 en este tenant.
--       Resultado esperado: 0 filas.
SELECT id, case_code
FROM cases
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND case_code = 'CIV-002';

-- 4.b — El caso PASCUAL ahora tiene un código EXT-NNN y clasificación EXT.
--       Resultado esperado: 1 fila.
SELECT
  c.id,
  c.case_code,
  cat.name AS classification_name,
  cat.prefix,
  c.updated_at
FROM cases c
JOIN clients cl ON cl.id = c.client_id
LEFT JOIN cat_classifications cat ON cat.id = c.classification_id
WHERE c.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND cl.name = 'PRODUCTOS ALIMENTICIOS PASCUAL, S.A.'
  AND c.description = 'RECUPERACION CARTERA MOROSA';

-- 4.c — No existen duplicados de case_code dentro del tenant.
--       El UNIQUE INDEX idx_cases_code_tenant ya garantiza esto, pero
--       validamos explícitamente.
--       Resultado esperado: 0 filas.
SELECT case_code, COUNT(*) AS dup_count
FROM cases
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
GROUP BY case_code
HAVING COUNT(*) > 1;

-- =============================================================================
-- PASO 5 — AUDIT LOG: registrar el cambio como corrección manual
-- =============================================================================
-- Se registra como action='update' field='case_code', con detalle en new_value
-- explicando que fue una corrección manual post-feature.

BEGIN;

INSERT INTO audit_log (tenant_id, user_id, entity, entity_id, action, field, old_value, new_value)
SELECT
  c.tenant_id,
  NULL,  -- corrección manual vía SQL (sin usuario autenticado)
  'cases',
  c.id,
  'update',
  'case_code',
  'CIV-002',
  'Corrección manual: código actualizado de CIV-002 a ' || c.case_code
    || ' para reflejar el cambio de clasificación CIVIL → EXTRAJUDICIAL '
    || 'realizado el 2026-04-20. Aplicado tras el despliegue de la lógica '
    || 'de recálculo automático de correlativos.'
FROM cases c
JOIN clients cl ON cl.id = c.client_id
WHERE c.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND cl.name = 'PRODUCTOS ALIMENTICIOS PASCUAL, S.A.'
  AND c.description = 'RECUPERACION CARTERA MOROSA'
  AND c.case_code ~ '^EXT-\d+$';

COMMIT;

-- Verificar la entrada de auditoría recién creada:
SELECT created_at, entity, entity_id, action, field, old_value, new_value
FROM audit_log
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND entity = 'cases'
  AND field = 'case_code'
  AND old_value = 'CIV-002'
ORDER BY created_at DESC
LIMIT 3;

-- =============================================================================
-- ROLLBACK — SOLO ejecutar manualmente si algo se hizo mal.
-- Reemplaza 'EXT-NNN' por el código real asignado en el Paso 3.
-- =============================================================================
-- BEGIN;
-- UPDATE cases
-- SET case_code = 'CIV-002',
--     updated_at = NOW()
-- WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND case_code = 'EXT-NNN'  -- reemplazar por el código real asignado
--   AND client_id IN (
--     SELECT id FROM clients
--     WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
--       AND name = 'PRODUCTOS ALIMENTICIOS PASCUAL, S.A.'
--   );
-- COMMIT;

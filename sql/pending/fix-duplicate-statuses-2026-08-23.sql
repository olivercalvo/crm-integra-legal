-- =====================================================================
-- LIMPIEZA DE ESTADOS DUPLICADOS (cat_statuses)
-- Estado: YA APLICADO EN PRODUCCIÓN el 2026-08-23 por Oliver.
-- Este archivo queda como registro histórico. NO volver a correrlo.
-- =====================================================================
--
-- PROBLEMA
-- cat_statuses tenía 7 filas activas donde debía haber 2: "Cerrado" x3,
-- "En trámite" x3 y un "Activo" legacy ya inactivo. Los tres juegos se
-- crearon en tandas idénticas (2026-04-02, 2026-04-05 00:20 y
-- 2026-04-05 14:49), señal de un script de carga inicial corrido 3 veces.
--
-- IMPACTO REAL
-- El filtro de estados del listado mostraba tres opciones idénticas
-- "Cerrado". Al elegir la equivocada se veía 1 caso en lugar de 81, y las
-- licenciadas podían concluir que se les perdieron expedientes. Además un
-- caso había quedado archivado en un duplicado.
--
-- ANTES
--   Cerrado    1f10ed6e  activo  80 casos   <- canónico
--   Cerrado    7c47d7fa  activo   1 caso    <- caso atrapado
--   Cerrado    99f47af8  activo   0
--   En trámite 06ca5815  activo 126 casos   <- canónico
--   En trámite 0ecbc605  activo   0
--   En trámite 14abf34e  activo   0
--   Activo     8e552b88  inactivo 0         <- legacy, se dejó como estaba
--
-- DESPUÉS (verificado)
--   Cerrado    1f10ed6e  activo  81 casos
--   En trámite 06ca5815  activo 126 casos
--   los otros 5          inactivos, 0 casos
--   Total: 207 casos, ninguno sin estado.
--
-- VERIFICACIONES PREVIAS
--   · Ningún UUID de estado hardcodeado en src/ ni en sql/.
--   · La única tabla que referencia cat_statuses es cases (status_id).
--   · El estado por defecto al crear un caso (primer activo por created_at)
--     era y sigue siendo "En trámite" 06ca5815, así que no cambió.
--
-- REVERSIÓN
--   No se borró nada. Para revertir, poner active = true en las 4 filas
--   del PASO 3 y devolver el caso movido a 7c47d7fa.
--
-- PREVENCIÓN
--   Ya existía un caso igual con cat_classifications (ver
--   fix-duplicate-classifications.sql). Cualquier script de carga de
--   catálogos debe ser idempotente (ON CONFLICT DO NOTHING o chequeo por
--   nombre + tenant) para que correrlo dos veces no duplique.
-- =====================================================================


-- PASO 1 · Mover los casos de cualquier duplicado al estado canónico
UPDATE cases
SET status_id = '1f10ed6e-3cc1-4916-85d6-17e54191fdf3'   -- Cerrado (canónico)
WHERE status_id IN (
  '7c47d7fa-e2b5-4528-aed8-f8fb1d6ea74b',
  '99f47af8-9adf-43e4-b915-c7797d843584'
);

UPDATE cases
SET status_id = '06ca5815-1b38-4380-936c-ba0ac3f3af33'   -- En trámite (canónico)
WHERE status_id IN (
  '0ecbc605-43f8-4e6f-a009-4f14f79acb7f',
  '14abf34e-cf89-423d-801c-dee881a05354'
);


-- PASO 2 · Verificación previa al desactivado. Debe devolver 0.
SELECT count(*) AS casos_en_duplicados
FROM cases
WHERE status_id IN (
  '7c47d7fa-e2b5-4528-aed8-f8fb1d6ea74b',
  '99f47af8-9adf-43e4-b915-c7797d843584',
  '0ecbc605-43f8-4e6f-a009-4f14f79acb7f',
  '14abf34e-cf89-423d-801c-dee881a05354'
);


-- PASO 3 · Desactivar los duplicados (no se borran)
UPDATE cat_statuses
SET active = false
WHERE id IN (
  '7c47d7fa-e2b5-4528-aed8-f8fb1d6ea74b',
  '99f47af8-9adf-43e4-b915-c7797d843584',
  '0ecbc605-43f8-4e6f-a009-4f14f79acb7f',
  '14abf34e-cf89-423d-801c-dee881a05354'
);


-- PASO 4 · Verificación final
SELECT s.id, s.name, s.active, count(c.id) AS casos
FROM cat_statuses s
LEFT JOIN cases c ON c.status_id = s.id
GROUP BY s.id, s.name, s.active
ORDER BY s.active DESC, s.name;

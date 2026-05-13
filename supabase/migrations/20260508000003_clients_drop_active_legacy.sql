-- ═════════════════════════════════════════════════════════════════
-- ⚠️ YA APLICADO EN PRODUCCION: 2026-05-13
-- Drop final de la columna `active` legacy tras refactor verificado
-- en producción durante Sprint 2E.1.
--
-- Pre-condición que se cumplió: 14 referencias a clients.active en código
-- fueron refactorizadas en commit dd4cf0d (Fase B) y verificadas en preview
-- + producción antes de aplicar el DROP.
--
-- NO REAPLICAR.
-- ═════════════════════════════════════════════════════════════════
-- FEATURE: clients — drop columna `active` legacy
-- Sprint:  2E.1 (Cotizaciones) — Fase F (cierre)
--
-- Contexto:
--   En la Fase A del Sprint 2E.1 se introdujo `client_status` como reemplazo
--   semántico de la columna BOOLEAN `active`. Durante esa fase la columna
--   `active` se reconvirtió a GENERATED ALWAYS AS (client_status = 'active')
--   STORED como puente de retrocompatibilidad mientras el código del módulo
--   Clientes (14 referencias detectadas en el audit) seguía leyendo el campo.
--
--   En la Fase B (commit dd4cf0d) se refactorizaron las 14 referencias:
--     - Listados (WHERE active=true → WHERE client_status='active')
--     - Forms de alta/edición (mapeo a client_status)
--     - Soft-delete (active=false → client_status='inactive')
--     - Audit log y tipos TypeScript (ClientRow.active → ClientRow.client_status)
--
--   El despliegue a producción se verificó el 2026-05-13:
--     - Preview en Vercel: OK
--     - Prod (https://crm-integra-legal.vercel.app): OK
--     - Página /legal/clientes responde 200 y muestra "64 clientes activos"
--
--   Confirmado el comportamiento correcto, esta migration retira la columna
--   generada `active` definitivamente. No queda código que la lea.
--
-- Tablas afectadas:
--   - public.clients (DROP COLUMN active)
--
-- Reversibilidad:
--   Recuperable re-creando la columna como GENERATED ALWAYS AS
--   (client_status = 'active') STORED. Ver bloque ROLLBACK al final.
-- ═════════════════════════════════════════════════════════════════

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop defensivo: solo intenta dropear si la columna existe.
--    Idempotente — si ya se aplicó, el bloque no hace nada.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  col_exists       BOOLEAN;
  col_is_generated TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'clients'
      AND  column_name  = 'active'
  ) INTO col_exists;

  IF NOT col_exists THEN
    RAISE NOTICE 'clients.active ya fue eliminada — nada que hacer.';
    RETURN;
  END IF;

  -- Verificar estado esperado: GENERATED ALWAYS (post Fase A hotfix).
  -- Si por alguna razón está como BOOLEAN regular, igual se puede dropear,
  -- pero dejamos el aviso en el log para auditoría.
  SELECT is_generated
  INTO   col_is_generated
  FROM   information_schema.columns
  WHERE  table_schema = 'public'
    AND  table_name   = 'clients'
    AND  column_name  = 'active';

  IF col_is_generated <> 'ALWAYS' THEN
    RAISE NOTICE 'clients.active está como % (esperado: ALWAYS). Se dropea igual.', col_is_generated;
  END IF;

  ALTER TABLE clients DROP COLUMN active;
  RAISE NOTICE 'clients.active eliminada correctamente.';
END $$;

-- -----------------------------------------------------------------------------
-- 2. Defensivo: limpieza de constraints/índices que pudieran haber quedado
--    huérfanos referenciando la columna. No deberían existir (la columna
--    generada no admite constraints propios distintos de los heredados),
--    pero el patrón del repo es ser explícito.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'clients'
      AND indexname  = 'clients_active_idx'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.clients_active_idx';
    RAISE NOTICE 'Index clients_active_idx eliminado.';
  END IF;
END $$;

COMMIT;

-- ═════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-APLICACIÓN (ejecutado en prod 2026-05-13)
-- ═════════════════════════════════════════════════════════════════

-- 1. Confirmar que `active` ya no existe en clients:
-- SELECT column_name
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public' AND table_name = 'clients'
--   AND  column_name = 'active';
-- Esperado: 0 filas. ✅ Verificado en prod.

-- 2. Total de columnas en clients (debe ser 24 tras el drop):
-- SELECT COUNT(*) AS total_columnas_clients
-- FROM   information_schema.columns
-- WHERE  table_schema = 'public' AND table_name = 'clients';
-- Esperado: 24. ✅ Verificado en prod.

-- 3. Total de clientes (sanity check — no se perdió data):
-- SELECT COUNT(*) FROM clients;
-- Esperado: ≥ 63 (al momento del merge eran 63; en prod live = 64). ✅

-- 4. Distribución por client_status (todo el dato sigue íntegro):
-- SELECT client_status, COUNT(*) FROM clients GROUP BY client_status;

-- ═════════════════════════════════════════════════════════════════
-- ROLLBACK (no recomendado — solo si algún consumidor externo aún lee `active`)
-- ═════════════════════════════════════════════════════════════════
-- BEGIN;
--   ALTER TABLE clients
--     ADD COLUMN active BOOLEAN
--     GENERATED ALWAYS AS (client_status = 'active') STORED;
--   COMMENT ON COLUMN clients.active IS
--     'DEPRECATED — columna restaurada como puente. Eliminar nuevamente cuando el consumidor externo migre a client_status.';
-- COMMIT;

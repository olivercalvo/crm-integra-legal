-- =============================================================================
-- FEATURE: Agregar rol 'contador' al CHECK constraint de public.users.role
-- Fecha: 2026-05-04
-- Sprint: Fase 1A — UX Foundation (selector de módulo + reestructura /legal/*)
--
-- Contexto:
--   El sistema va a tener múltiples módulos. Hoy: Legal y Finanzas. Mañana:
--   Integra Administra. El rol 'contador' va a tener acceso solo a Finanzas.
--
-- Alcance de esta migración:
--   - Solo el CHECK constraint. NO crea usuarios contadores.
--   - La UI/API de creación de usuarios sigue restringida a los 3 roles
--     existentes (admin/abogada/asistente). El rol 'contador' se habilitará
--     en la API + UI durante Fase 1B (módulo Finanzas).
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (proyecto del cliente
--   Integra Legal). Convención del proyecto desde 2026-04-05: las
--   migraciones nuevas se ejecutan a mano, no vía `supabase db push`.
--
-- Reversibilidad:
--   ALTER TABLE de CHECK no es destructivo: no toca datos. El rollback
--   recompone el constraint original. Seguro.
-- =============================================================================

BEGIN;

-- 1. Verificar que no haya filas con role='contador' antes de drop
--    (no debería haberlas — el constraint actual no lo permite).
DO $$
DECLARE
  cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM users WHERE role = 'contador';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'Se encontraron % usuarios con role=contador antes de aplicar el ALTER. Revisar.', cnt;
  END IF;
END $$;

-- 2. Drop del constraint actual y re-creación con 'contador' incluido.
--    Postgres autonombra los CHECK inline como <table>_<column>_check.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'abogada', 'asistente', 'contador'));

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================
-- Listar el constraint para confirmar que ahora incluye 'contador':
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.users'::regclass
  AND contype = 'c'
  AND conname = 'users_role_check';
-- Resultado esperado:
--   conname            | definition
--   users_role_check   | CHECK ((role = ANY (ARRAY['admin'::text, 'abogada'::text,
--                      |                            'asistente'::text, 'contador'::text])))

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- =============================================================================
-- BEGIN;
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
-- ALTER TABLE users
--   ADD CONSTRAINT users_role_check
--   CHECK (role IN ('admin', 'abogada', 'asistente'));
-- COMMIT;

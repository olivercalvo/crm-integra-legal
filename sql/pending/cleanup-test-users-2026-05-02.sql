-- ============================================================================
-- Script: cleanup-test-users-2026-05-02.sql
-- Fecha:  2026-05-02
-- Autor:  Oliver Calvo (preparado por Claude tras el sprint de fix users.create)
-- Tenant: a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- PROPÓSITO
-- ---------
-- Eliminar 3 usuarios que ya no se usan:
--   1. test-abog-0502@integra-panama.com   (creado en Test 2 del fix de
--      flujo de creación de usuarios; commit 83ea758)
--   2. test-asis-0502@integra-panama.com   (creado en Test 3 del mismo fix)
--   3. asistente@integra-panama.com        (usuario antiguo inactivo, never
--      logged in, full_name="Asistente", active=false desde antes)
--
-- VERIFICACIÓN PREVIA AL CIERRE DE SCRIPT
-- ---------------------------------------
-- Los 3 usuarios fueron auditados con service-role el 2026-05-02 y se
-- confirmó: CERO referencias en cases, expenses, client_payments, tasks,
-- comments, documents, audit_log (excepto sus propias entradas), personal_todos,
-- clients, prospects, cat_team. Por lo tanto el DELETE no rompe ninguna FK.
--
-- ORDEN DE EJECUCIÓN (importante)
-- -------------------------------
-- 1. INSERT en audit_log (entrada por usuario, motivo "limpieza post-fix
--    users.create — Sprint usuarios").
-- 2. DELETE FROM public.users (FK lógica hacia auth.users — sin restricción
--    a nivel DB, pero conceptualmente primero).
-- 3. DELETE de auth.users:
--      Opción A (recomendada): Supabase Dashboard → Authentication → Users
--      → buscar email → ⋯ → Delete user. Esto limpia automáticamente
--      auth.identities, auth.sessions, auth.refresh_tokens, auth.mfa_factors.
--
--      Opción B (SQL directo, incluida abajo): DELETE FROM auth.users.
--      Funciona porque auth.identities y auth.sessions tienen ON DELETE CASCADE
--      hacia auth.users.id. Si Supabase agregó tablas auxiliares nuevas en
--      el futuro, la opción A es más segura.
--
-- IDs DEFINITIVOS (verificados contra Supabase prod 2026-05-02)
-- -------------------------------------------------------------
--   test-abog-0502@integra-panama.com → 46cf79e4-5d22-4d1d-8420-4a7502303175
--   test-asis-0502@integra-panama.com → 330013cc-7034-49f9-a57d-3cdbf55c1463
--   asistente@integra-panama.com      → 75ca637a-c8f3-4935-bcfe-683ad3fc44f8
--
-- IDs QUE NO SE TOCAN (por contraste, para evitar copy-paste accidente)
-- --------------------------------------------------------------------
--   oliver@clienteenelcentro.com  → d706f258-6709-4682-bc67-642c88ed1598 (admin)
--   chapman@integra-panama.com    → d5cf61cb-2f1f-4e1b-8fd1-1db82dd16867 (Daveiva)
--   batista@integra-panama.com    → aefb05ce-871a-4f6a-a952-2e385dc45176 (Milena)
--   harry@integra-panama.com      → 01e10f7f-b937-47a3-a4d3-5f4ead894fa8 (Harry)
--   legal@integra-panama.com      → 88a50b5b-5e06-4853-9c86-3a2d4b026c43 (Legal)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. VERIFICACIÓN PREVIA (correr antes del BEGIN, no modifica nada)
-- ----------------------------------------------------------------------------
-- Confirma que los 3 usuarios existen y muestra sus datos actuales.

SELECT id, email, full_name, role, active, tenant_id, created_at
FROM public.users
WHERE id IN (
  '46cf79e4-5d22-4d1d-8420-4a7502303175',
  '330013cc-7034-49f9-a57d-3cdbf55c1463',
  '75ca637a-c8f3-4935-bcfe-683ad3fc44f8'
);
-- Esperado: 3 filas. Si vuelve menos, parar y revisar antes de ejecutar el resto.


-- Confirma 0 referencias hacia los 3 ids en tablas con FK a users.
-- (El conteo total debe ser 0. Si no lo es, NO ejecutar los DELETEs:
--  reasignar primero los registros referenciados a otro usuario activo.)

WITH target_ids(id) AS (
  VALUES
    ('46cf79e4-5d22-4d1d-8420-4a7502303175'::uuid),
    ('330013cc-7034-49f9-a57d-3cdbf55c1463'::uuid),
    ('75ca637a-c8f3-4935-bcfe-683ad3fc44f8'::uuid)
)
SELECT 'cases.responsible_id'      AS ref, COUNT(*) AS n FROM cases          WHERE responsible_id      IN (SELECT id FROM target_ids)
UNION ALL SELECT 'cases.assistant_id',         COUNT(*) FROM cases           WHERE assistant_id        IN (SELECT id FROM target_ids)
UNION ALL SELECT 'expenses.registered_by',     COUNT(*) FROM expenses        WHERE registered_by       IN (SELECT id FROM target_ids)
UNION ALL SELECT 'client_payments.registered_by', COUNT(*) FROM client_payments WHERE registered_by    IN (SELECT id FROM target_ids)
UNION ALL SELECT 'tasks.created_by',           COUNT(*) FROM tasks           WHERE created_by          IN (SELECT id FROM target_ids)
UNION ALL SELECT 'tasks.assigned_to',          COUNT(*) FROM tasks           WHERE assigned_to         IN (SELECT id FROM target_ids)
UNION ALL SELECT 'comments.user_id',           COUNT(*) FROM comments        WHERE user_id             IN (SELECT id FROM target_ids)
UNION ALL SELECT 'documents.uploaded_by',      COUNT(*) FROM documents       WHERE uploaded_by         IN (SELECT id FROM target_ids)
UNION ALL SELECT 'personal_todos.user_id',     COUNT(*) FROM personal_todos  WHERE user_id             IN (SELECT id FROM target_ids)
UNION ALL SELECT 'personal_todos.assigned_to', COUNT(*) FROM personal_todos  WHERE assigned_to         IN (SELECT id FROM target_ids)
UNION ALL SELECT 'clients.responsible_lawyer_id', COUNT(*) FROM clients      WHERE responsible_lawyer_id IN (SELECT id FROM target_ids)
UNION ALL SELECT 'cat_team.user_id',           COUNT(*) FROM cat_team        WHERE user_id             IN (SELECT id FROM target_ids);
-- Esperado: todas las filas con n=0. (audit_log se omite a propósito; se
--           preserva por trazabilidad.)


-- ----------------------------------------------------------------------------
-- 1. INSERTAR ENTRADA DE AUDIT_LOG POR USUARIO (motivo de la limpieza)
-- ----------------------------------------------------------------------------
-- user_id de quien ejecuta = Oliver (admin). Se preserva el audit_log de los
-- 3 usuarios eliminados (no se borra), igual que las entradas que ellos
-- mismos hayan generado en su sesión, por trazabilidad.

BEGIN;

INSERT INTO audit_log (tenant_id, user_id, entity, entity_id, action, field, old_value, new_value)
VALUES
  ('a0000000-0000-0000-0000-000000000001',
   'd706f258-6709-4682-bc67-642c88ed1598',
   'users',
   '46cf79e4-5d22-4d1d-8420-4a7502303175',
   'delete',
   'hard_delete',
   '{"email":"test-abog-0502@integra-panama.com","full_name":"PRUEBA OLIVER","role":"asistente","active":true}',
   '{"reason":"limpieza post-fix users.create — Sprint usuarios","deleted_at":"2026-05-02"}'),

  ('a0000000-0000-0000-0000-000000000001',
   'd706f258-6709-4682-bc67-642c88ed1598',
   'users',
   '330013cc-7034-49f9-a57d-3cdbf55c1463',
   'delete',
   'hard_delete',
   '{"email":"test-asis-0502@integra-panama.com","full_name":"PRUEBA ASISTENTE","role":"asistente","active":true}',
   '{"reason":"limpieza post-fix users.create — Sprint usuarios","deleted_at":"2026-05-02"}'),

  ('a0000000-0000-0000-0000-000000000001',
   'd706f258-6709-4682-bc67-642c88ed1598',
   'users',
   '75ca637a-c8f3-4935-bcfe-683ad3fc44f8',
   'delete',
   'hard_delete',
   '{"email":"asistente@integra-panama.com","full_name":"Asistente","role":"abogada","active":false}',
   '{"reason":"limpieza post-fix users.create — Sprint usuarios","deleted_at":"2026-05-02"}');


-- ----------------------------------------------------------------------------
-- 2. DELETE EN public.users (3 filas)
-- ----------------------------------------------------------------------------
-- Acotado por id + tenant_id como guard rail extra contra error de copy-paste.

DELETE FROM public.users
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND id IN (
    '46cf79e4-5d22-4d1d-8420-4a7502303175',
    '330013cc-7034-49f9-a57d-3cdbf55c1463',
    '75ca637a-c8f3-4935-bcfe-683ad3fc44f8'
  );
-- Esperado: 3 filas eliminadas.


-- ----------------------------------------------------------------------------
-- 3. DELETE EN auth.users — Opción B (SQL directo)
-- ----------------------------------------------------------------------------
-- RECOMENDACIÓN: si tenés acceso al panel, preferí Authentication → Users
-- → ⋯ → Delete user (Opción A). Hace lo mismo y evita sorpresas si Supabase
-- agrega tablas auxiliares nuevas. Si vas por SQL, descomenta este bloque.

DELETE FROM auth.users
WHERE id IN (
  '46cf79e4-5d22-4d1d-8420-4a7502303175',
  '330013cc-7034-49f9-a57d-3cdbf55c1463',
  '75ca637a-c8f3-4935-bcfe-683ad3fc44f8'
);
-- Esperado: 3 filas eliminadas. auth.identities, auth.sessions y
-- auth.refresh_tokens cascadean automáticamente.


-- ----------------------------------------------------------------------------
-- 4. VERIFICACIÓN POST-DELETE (dentro de la misma transacción)
-- ----------------------------------------------------------------------------

SELECT COUNT(*) AS public_users_remaining
FROM public.users
WHERE id IN (
  '46cf79e4-5d22-4d1d-8420-4a7502303175',
  '330013cc-7034-49f9-a57d-3cdbf55c1463',
  '75ca637a-c8f3-4935-bcfe-683ad3fc44f8'
);
-- Esperado: 0

SELECT COUNT(*) AS auth_users_remaining
FROM auth.users
WHERE id IN (
  '46cf79e4-5d22-4d1d-8420-4a7502303175',
  '330013cc-7034-49f9-a57d-3cdbf55c1463',
  '75ca637a-c8f3-4935-bcfe-683ad3fc44f8'
);
-- Esperado: 0 (si ejecutaste la Opción B). Si vas por Opción A (Dashboard),
-- esto sigue dando 3 hasta que confirmes el delete en la UI.

SELECT COUNT(*) AS audit_entries_added
FROM audit_log
WHERE entity = 'users'
  AND entity_id IN (
    '46cf79e4-5d22-4d1d-8420-4a7502303175',
    '330013cc-7034-49f9-a57d-3cdbf55c1463',
    '75ca637a-c8f3-4935-bcfe-683ad3fc44f8'
  )
  AND action = 'delete'
  AND field = 'hard_delete';
-- Esperado: 3.


-- ----------------------------------------------------------------------------
-- 5. CONFIRMAR — sólo correr COMMIT si los 3 conteos arriba son los esperados.
--    Si algo está mal, ejecutar ROLLBACK en su lugar.
-- ----------------------------------------------------------------------------

-- COMMIT;
-- ROLLBACK;

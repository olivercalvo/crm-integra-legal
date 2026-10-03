-- ============================================================================
-- audit_log: política, permisos, triggers y filas · SOLO LECTURA
-- ============================================================================
-- Para correr en el SQL Editor de producción ANTES y DESPUÉS del hotfix 084
-- (docs/finanzas/hotfix-084-produccion.md). No modifica nada. Una sola consulta,
-- sin BEGIN ni ROLLBACK.
--
-- Qué debería salir:
--   ANTES   politica  audit_tenant_isolation  FOR ALL USING (…)
--           permiso   anon / authenticated    DELETE, INSERT, …, TRUNCATE, UPDATE
--           trigger   trg_audit_log_*         NO EXISTE
--   DESPUÉS politica  audit_log_select        FOR SELECT USING (…)  (misma expresión)
--           permiso   anon                    (no aparece: sin permisos)
--           permiso   authenticated           INSERT, REFERENCES, SELECT, TRIGGER
--           trigger   trg_audit_log_*         existe (activo)
--   En los dos: rls = true y la MISMA cantidad de filas.
-- ============================================================================
SELECT 'politica' AS tipo,
       polname::text AS nombre,
       CASE polcmd WHEN '*' THEN 'FOR ALL' WHEN 'r' THEN 'FOR SELECT' WHEN 'a' THEN 'FOR INSERT'
                   WHEN 'w' THEN 'FOR UPDATE' WHEN 'd' THEN 'FOR DELETE' END
         || ' USING ' || coalesce(pg_get_expr(polqual, polrelid), '(sin USING)') AS detalle
  FROM pg_policy
 WHERE polrelid = 'public.audit_log'::regclass
UNION ALL
SELECT 'permiso', grantee::text, string_agg(privilege_type, ', ' ORDER BY privilege_type)
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'audit_log'
   AND grantee IN ('anon', 'authenticated', 'service_role')
 GROUP BY grantee
UNION ALL
SELECT 'trigger', t.nombre,
       CASE WHEN g.oid IS NULL THEN 'NO EXISTE'
            WHEN g.tgenabled = 'D' THEN 'existe (DESACTIVADO)'
            ELSE 'existe (activo)' END
  FROM (VALUES ('trg_audit_log_solo_agregar'), ('trg_audit_log_sin_truncate')) AS t(nombre)
  LEFT JOIN pg_trigger g ON g.tgrelid = 'public.audit_log'::regclass AND g.tgname = t.nombre
UNION ALL
SELECT 'rls', 'audit_log', relrowsecurity::text FROM pg_class WHERE oid = 'public.audit_log'::regclass
UNION ALL
SELECT 'filas', 'audit_log', count(*)::text FROM public.audit_log
ORDER BY 1, 2;

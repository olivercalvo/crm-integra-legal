-- ============================================================================
-- ✅ APLICADO EN PRODUCCIÓN 2026-07-13. Verificado: 4 políticas tenant_scoped_*
--    activas; smoke test OK (subir/abrir/borrar documento como usuario real).
-- ----------------------------------------------------------------------------
-- SEGURIDAD: aislar el bucket 'documents' por tenant (RLS de Storage)
-- ----------------------------------------------------------------------------
-- Estado actual (verificado en prod 2026-07-13): 7 políticas sobre
-- storage.objects, TODAS abiertas — solo chequean bucket_id = 'documents' para
-- el rol authenticated. Sin scope por tenant → cualquier usuario logueado puede
-- leer/subir/actualizar/borrar cualquier archivo (hallazgo OWASP Crítico #1).
--
-- Convención de rutas confirmada (src/lib/storage/direct-upload.ts:56):
--   {tenant_id}/{prefijo}/{archivo}  → el primer folder ES el tenant_id.
--   106/106 archivos reales la cumplen. (1 placeholder legacy 'tenants/...' de
--   0 bytes queda fuera; inofensivo — ver nota al final.)
--
-- Este cambio: borra las 7 políticas abiertas y crea 4 limpias (una por
-- operación) que exigen que el primer folder = tenant_id del usuario.
--
-- NOTA: auth.tenant_id() NO existe en esta base (la migración
-- 20260403000001 nunca se aplicó a prod). Se lee el tenant_id directo del
-- claim JWT app_metadata.tenant_id, sin depender de esa función.
--
-- ⚠️ CAMBIO DE SEGURIDAD EN PRODUCCIÓN — pausa obligatoria. Falla CERRADO
--   (si algo estuviera mal, niega acceso, no lo abre). Rollback al final.
--   Ejecutar sentencia por sentencia. Correr el SMOKE TEST post-aplicación.
-- ============================================================================

-- 1) VERIFY ANTES — estado actual (deberían verse las 7 políticas abiertas)
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- 2) DROP — las 7 políticas abiertas actuales
DROP POLICY IF EXISTS "Allow authenticated deletes"            ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads"              ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"            ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read files"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload files"   ON storage.objects;

-- 3) CREATE — 4 políticas aisladas por tenant (rol authenticated)

-- SELECT (leer)
CREATE POLICY "tenant_scoped_read_documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')
  );

-- INSERT (subir)
CREATE POLICY "tenant_scoped_insert_documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')
  );

-- UPDATE (sobrescribir / mover)
CREATE POLICY "tenant_scoped_update_documents" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')
  );

-- DELETE (borrar)
CREATE POLICY "tenant_scoped_delete_documents" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')
  );

-- 4) VERIFY DESPUÉS — deben quedar EXACTAMENTE 4 políticas (las tenant_scoped_*)
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- ============================================================================
-- SMOKE TEST (obligatorio, desde la app con un usuario normal, NO admin):
--   a) Abrir un documento existente de un cliente  → debe seguir descargando.
--   b) Subir un documento nuevo a un cliente        → debe subir sin error.
--   Si ambos funcionan, el aislamiento quedó bien.
--
-- ROLLBACK (si algo se rompe — recrea el acceso abierto anterior):
--   CREATE POLICY "Authenticated users can read files"   ON storage.objects
--     FOR SELECT TO authenticated USING (bucket_id = 'documents');
--   CREATE POLICY "Authenticated users can upload files" ON storage.objects
--     FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
--   CREATE POLICY "Authenticated users can update files" ON storage.objects
--     FOR UPDATE TO authenticated USING (bucket_id = 'documents');
--   CREATE POLICY "Authenticated users can delete files" ON storage.objects
--     FOR DELETE TO authenticated USING (bucket_id = 'documents');
--   (y borrar las tenant_scoped_* si hiciera falta)
--
-- LIMPIEZA OPCIONAL (aparte, no urgente): borrar el placeholder legacy de 0 bytes
--   DELETE FROM storage.objects
--   WHERE bucket_id = 'documents'
--     AND name = 'tenants/a0000000-0000-0000-0000-000000000001/clientes/1477f2fd-01c5-4d5e-84a7-f50503b499f7/propuestas-aceptadas/.emptyFolderPlaceholder';
-- ============================================================================

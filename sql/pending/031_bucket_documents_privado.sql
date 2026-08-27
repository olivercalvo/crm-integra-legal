-- =============================================================================
-- FEATURE: el bucket `documents` existe y es PRIVADO
-- Sprint:  Seguridad — confidencialidad de expedientes
-- Fecha:   2026-08-27
--
-- ═════════════════════════════════════════════════════════════════════════════
-- POR QUÉ
-- ═════════════════════════════════════════════════════════════════════════════
-- En producción el bucket está marcado como PÚBLICO. Eso significa que cualquiera
-- con la URL exacta descarga un expediente sin autenticarse: para un bufete es
-- confidencialidad de cliente y Ley 81 de 2019.
--
-- El arreglo no requiere tocar código. Verificado antes de escribir esto:
--   · CERO usos de `getPublicUrl()` en todo el repo.
--   · CERO URLs de storage armadas a mano con `/object/public/`.
--   · Los 11 puntos que leen del bucket usan `createSignedUrl` con vencimiento.
--   · `scripts/backup-supabase.mjs` baja los archivos con la SERVICE KEY
--     (`Authorization: Bearer`), no como anónimo: el respaldo nocturno sigue
--     funcionando con el bucket privado.
--   · `src/lib/storage/direct-upload.ts` sube con el JWT del usuario. Las subidas
--     siempre fueron autenticadas.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- PRIVADO NO ES LO MISMO QUE AISLADO — quién lee qué lo deciden las políticas
-- ═════════════════════════════════════════════════════════════════════════════
-- Que el bucket sea privado solo quita la URL anónima. El aislamiento por tenant
-- lo dan las políticas de `storage.objects`, que ya existen y SÍ aíslan
-- (`sql/pending/storage_rls_tenant_scoped.sql`):
--
--     (storage.foldername(name))[1] = jwt -> app_metadata ->> 'tenant_id'
--
-- Las cuatro (SELECT/INSERT/UPDATE/DELETE) son solo para `authenticated` y
-- comparan el PRIMER NIVEL DE CARPETA contra el tenant del token. Calza con la
-- ruta que arma `direct-upload.ts`: `${tenantId}/${prefijo}/${archivo}`. Con RLS
-- activo y sin política para `anon`, el anónimo no ve nada.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠️ HALLAZGO: EN STAGING EL BUCKET NO EXISTÍA
-- ═════════════════════════════════════════════════════════════════════════════
-- `storage.buckets` y `storage.objects` estaban en CERO. Las políticas de
-- storage sí se habían aplicado en la Fase 0, pero el bucket nunca se creó, así
-- que ninguna subida podía funcionar y ese camino jamás se probó en staging.
--
-- `apply-staging-sql.mjs --reset` dropea el esquema `public`, no `storage`, así
-- que un bucket creado sobrevive a los resets. Pero un proyecto Supabase nuevo
-- nace sin él: por eso esto va como migración y no como un clic en el panel.
--
-- IDEMPOTENCIA: crea si falta, y si ya existe solo se asegura de que sea privado.
--
-- APLICACIÓN:
--   Staging: `node scripts/run-sql.mjs sql/pending/031_bucket_documents_privado.sql`
--   Producción: NO por acá. Es cambio de configuración en producción y va con la
--   pausa obligatoria del CLAUDE.md — lo hace Oliver desde el panel de Supabase.
--   Es reversible al instante volviendo a marcarlo público.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_existe  boolean;
  v_publico boolean;
BEGIN
  SELECT true, public INTO v_existe, v_publico
    FROM storage.buckets WHERE id = 'documents';

  IF v_existe IS NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('documents', 'documents', false);
    RAISE NOTICE 'Bucket "documents" CREADO como privado (no existía).';
  ELSIF v_publico THEN
    UPDATE storage.buckets SET public = false WHERE id = 'documents';
    RAISE NOTICE 'Bucket "documents" pasó de PÚBLICO a PRIVADO.';
  ELSE
    RAISE NOTICE 'Bucket "documents" ya era privado: no se toca.';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
DO $$
DECLARE
  v_publico  boolean;
  v_politicas int;
BEGIN
  SELECT public INTO v_publico FROM storage.buckets WHERE id = 'documents';

  SELECT COUNT(*) INTO v_politicas
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'tenant_scoped_%_documents';

  RAISE NOTICE '— POST-CHECK bucket documents —';
  RAISE NOTICE 'público ................... % (esperado f)', v_publico;
  RAISE NOTICE 'políticas por tenant ...... % (esperado 4)', v_politicas;

  IF v_publico IS NULL THEN
    RAISE EXCEPTION 'ABORT: el bucket documents no existe';
  END IF;
  IF v_publico THEN
    RAISE EXCEPTION 'ABORT: el bucket documents sigue siendo público';
  END IF;
  IF v_politicas <> 4 THEN
    RAISE EXCEPTION
      'ABORT: se esperaban 4 políticas tenant_scoped_*_documents y hay %. Sin ellas, privado no aísla por tenant.',
      v_politicas;
  END IF;
END $$;

SELECT id, name, public FROM storage.buckets ORDER BY id;

-- =============================================================================
-- ROLLBACK — instantáneo, por si algo se rompe
-- =============================================================================
-- UPDATE storage.buckets SET public = true WHERE id = 'documents';
-- =============================================================================

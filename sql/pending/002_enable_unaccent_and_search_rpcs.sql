-- =============================================================================
-- FEATURE: Búsqueda universal con tolerancia a acentos + RPCs por entidad
-- Fecha: 2026-04-21
-- Propósito:
--   1. Habilitar la extensión PostgreSQL `unaccent` para que las búsquedas
--      con ILIKE ignoren acentos: "migracion" matchea "MIGRACIÓN", etc.
--   2. Crear una función SQL IMMUTABLE envoltorio de unaccent() usable
--      en índices y .rpc() calls desde PostgREST.
--   3. Crear RPCs por entidad (cases, clients, prospects) que el frontend
--      llama vía supabase.rpc(...) para obtener IDs coincidentes con la
--      búsqueda universal (case_code, descripción, cliente, clasificación,
--      institución, abogada, asistente, etc.) en una sola query indexable.
--
-- IDEMPOTENTE: todas las sentencias usan IF NOT EXISTS / CREATE OR REPLACE.
-- Se puede ejecutar varias veces sin romper nada.
--
-- RLS: estas RPCs se invocan desde el frontend con el service-role key
-- (createAdminClient), que ya bypassea RLS. Las funciones filtran
-- explícitamente por p_tenant_id; el caller es responsable de pasar
-- el tenant correcto (igual que en el resto del CRM).
-- =============================================================================

-- =============================================================================
-- PASO 1 — Habilitar la extensión unaccent
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- =============================================================================
-- PASO 2 — Wrapper IMMUTABLE de unaccent()
--   `unaccent(text)` nativo es STABLE por defecto; envolverlo como
--   IMMUTABLE permite usarlo en índices funcionales si en el futuro
--   hace falta (pg_trgm), y es suficientemente seguro para nuestro
--   caso (diccionario fijo, sin reglas dinámicas).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.f_unaccent(t TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT unaccent('unaccent', COALESCE(t, ''));
$$;

COMMENT ON FUNCTION public.f_unaccent(TEXT) IS
  'Envoltorio IMMUTABLE de unaccent() para búsqueda universal del CRM.';

-- =============================================================================
-- PASO 3 — Helper interno: predicate case/accent-insensitive contains
-- =============================================================================

CREATE OR REPLACE FUNCTION public.f_search_contains(haystack TEXT, needle TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    CASE
      WHEN COALESCE(needle, '') = '' THEN TRUE
      ELSE public.f_unaccent(COALESCE(haystack, '')) ILIKE '%' || public.f_unaccent(needle) || '%'
    END;
$$;

COMMENT ON FUNCTION public.f_search_contains(TEXT, TEXT) IS
  'True si needle aparece en haystack ignorando case y acentos.';

-- =============================================================================
-- PASO 4 — RPC: search_cases_ids(tenant, query)
--   Devuelve los IDs de casos del tenant que coinciden con la búsqueda
--   en cualquiera de estos campos (o relaciones):
--     - cases: case_code, description, observations, physical_location,
--       entity, procedure_type, institution_procedure_number,
--       institution_case_number
--     - clients: name, client_number, ruc, email, phone
--     - cat_classifications: name, prefix
--     - cat_institutions: name
--     - cat_statuses: name
--     - users (responsible): full_name, email
--     - users (assistant): full_name, email
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_cases_ids(
  p_tenant_id UUID,
  p_query     TEXT
)
RETURNS TABLE(id UUID)
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
  SELECT DISTINCT c.id
  FROM cases c
  LEFT JOIN clients cl              ON cl.id  = c.client_id
  LEFT JOIN cat_classifications cla ON cla.id = c.classification_id
  LEFT JOIN cat_institutions ins    ON ins.id = c.institution_id
  LEFT JOIN cat_statuses st         ON st.id  = c.status_id
  LEFT JOIN users ur                ON ur.id  = c.responsible_id
  LEFT JOIN users ua                ON ua.id  = c.assistant_id
  WHERE c.tenant_id = p_tenant_id
    AND (
      public.f_search_contains(c.case_code, p_query)
      OR public.f_search_contains(c.description, p_query)
      OR public.f_search_contains(c.observations, p_query)
      OR public.f_search_contains(c.physical_location, p_query)
      OR public.f_search_contains(c.entity, p_query)
      OR public.f_search_contains(c.procedure_type, p_query)
      OR public.f_search_contains(c.institution_procedure_number, p_query)
      OR public.f_search_contains(c.institution_case_number, p_query)
      OR public.f_search_contains(cl.name, p_query)
      OR public.f_search_contains(cl.client_number, p_query)
      OR public.f_search_contains(cl.ruc, p_query)
      OR public.f_search_contains(cl.email, p_query)
      OR public.f_search_contains(cl.phone, p_query)
      OR public.f_search_contains(cla.name, p_query)
      OR public.f_search_contains(cla.prefix, p_query)
      OR public.f_search_contains(ins.name, p_query)
      OR public.f_search_contains(st.name, p_query)
      OR public.f_search_contains(ur.full_name, p_query)
      OR public.f_search_contains(ur.email, p_query)
      OR public.f_search_contains(ua.full_name, p_query)
      OR public.f_search_contains(ua.email, p_query)
    );
$$;

COMMENT ON FUNCTION public.search_cases_ids(UUID, TEXT) IS
  'Búsqueda universal de casos: case_code, descripción, cliente, clasificación, institución, abogada, asistente, etc.';

-- =============================================================================
-- PASO 5 — RPC: search_clients_ids(tenant, query)
--   Busca en campos del cliente + códigos y descripciones de sus casos.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_clients_ids(
  p_tenant_id UUID,
  p_query     TEXT
)
RETURNS TABLE(id UUID)
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
  SELECT DISTINCT cl.id
  FROM clients cl
  LEFT JOIN users ur ON ur.id = cl.responsible_lawyer_id
  WHERE cl.tenant_id = p_tenant_id
    AND (
      public.f_search_contains(cl.name, p_query)
      OR public.f_search_contains(cl.client_number, p_query)
      OR public.f_search_contains(cl.ruc, p_query)
      OR public.f_search_contains(cl.email, p_query)
      OR public.f_search_contains(cl.phone, p_query)
      OR public.f_search_contains(cl.type, p_query)
      OR public.f_search_contains(cl.address, p_query)
      OR public.f_search_contains(cl.contact, p_query)
      OR public.f_search_contains(cl.observations, p_query)
      OR public.f_search_contains(ur.full_name, p_query)
      OR EXISTS (
        SELECT 1
        FROM cases c
        WHERE c.client_id = cl.id
          AND c.tenant_id = p_tenant_id
          AND (
            public.f_search_contains(c.case_code, p_query)
            OR public.f_search_contains(c.description, p_query)
          )
      )
    );
$$;

COMMENT ON FUNCTION public.search_clients_ids(UUID, TEXT) IS
  'Búsqueda universal de clientes: nombre, RUC, número, email, teléfono, abogada responsable, tipo, dirección, notas, códigos/descripciones de casos asociados.';

-- =============================================================================
-- PASO 6 — RPC: search_prospects_ids(tenant, query)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_prospects_ids(
  p_tenant_id UUID,
  p_query     TEXT
)
RETURNS TABLE(id UUID)
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
  SELECT DISTINCT p.id
  FROM prospects p
  WHERE p.tenant_id = p_tenant_id
    AND (
      public.f_search_contains(p.name, p_query)
      OR public.f_search_contains(p.phone, p_query)
      OR public.f_search_contains(p.email, p_query)
      OR public.f_search_contains(p.service_interest, p_query)
      OR public.f_search_contains(p.notes, p_query)
      OR public.f_search_contains(p.status, p_query)
    );
$$;

COMMENT ON FUNCTION public.search_prospects_ids(UUID, TEXT) IS
  'Búsqueda universal de prospectos: nombre, contacto, interés, notas, etapa.';

-- =============================================================================
-- PASO 7 — Permisos: exponer RPCs al rol authenticated y service_role
--   El proyecto usa el SDK Supabase; el service-role ya tiene GRANT.
--   Autenticamos como `authenticated` o `service_role` dependiendo del
--   cliente. Damos EXECUTE a ambos para ser explícitos.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.f_unaccent(TEXT)              TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.f_search_contains(TEXT, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.search_cases_ids(UUID, TEXT)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_clients_ids(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_prospects_ids(UUID, TEXT) TO authenticated, service_role;

-- =============================================================================
-- PASO 8 — VERIFICACIÓN (solo lectura)
-- =============================================================================

-- Extensión habilitada:
SELECT extname, extversion FROM pg_extension WHERE extname = 'unaccent';

-- Smoke test del wrapper:
SELECT public.f_unaccent('MIGRACIÓN') AS expect_migracion,
       public.f_unaccent('Panamá')    AS expect_panama,
       public.f_unaccent(NULL)        AS expect_empty;

-- Smoke test de RPCs (requiere al menos 1 caso del tenant Integra Legal).
-- Para el tenant real: 'a0000000-0000-0000-0000-000000000001'.
SELECT COUNT(*) AS hit_extra
FROM public.search_cases_ids('a0000000-0000-0000-0000-000000000001', 'extra');

SELECT COUNT(*) AS hit_migracion_acento
FROM public.search_cases_ids('a0000000-0000-0000-0000-000000000001', 'migracion');

-- =============================================================================
-- ROLLBACK — Eliminar las funciones creadas. La extensión unaccent
-- NO se elimina (puede estar usada por otras features). Si se quiere
-- eliminar, descomentar la última línea.
-- =============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.search_prospects_ids(UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.search_clients_ids(UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.search_cases_ids(UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.f_search_contains(TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.f_unaccent(TEXT);
-- -- DROP EXTENSION IF EXISTS unaccent;
-- COMMIT;

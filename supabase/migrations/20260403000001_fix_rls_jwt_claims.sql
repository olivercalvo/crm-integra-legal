-- ============================================================
-- Fix RLS helper functions to read from app_metadata in JWT
--
-- The JWT claims structure in Supabase is:
--   { ..., app_metadata: { tenant_id: "...", user_role: "..." }, ... }
--
-- The original functions read from top-level claims which is incorrect.
-- This migration fixes them to read from app_metadata.
-- ============================================================

-- Fix auth.tenant_id() — read tenant_id from app_metadata
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id')::uuid,
    NULL
  );
$$ LANGUAGE sql STABLE;

-- Fix auth.user_role() — read user_role from app_metadata
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'user_role',
    ''
  );
$$ LANGUAGE sql STABLE;

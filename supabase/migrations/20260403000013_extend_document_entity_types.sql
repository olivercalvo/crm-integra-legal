-- ============================================================
-- Extend documents.entity_type to support tasks and comments
-- Fecha: 2026-04-03
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Drop old constraint and add new one with extended types
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_entity_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_entity_type_check
  CHECK (entity_type IN ('client', 'case', 'task', 'comment'));

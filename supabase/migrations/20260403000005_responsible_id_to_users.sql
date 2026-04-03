-- =============================================
-- Migration: Change responsible_id to reference users instead of cat_team
-- Date: 2026-04-03
-- Description: Unifies team assignment with user management.
--   Users with role abogada/asistente are used directly for assignments.
-- =============================================

-- Drop the existing foreign key constraint on responsible_id
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_responsible_id_fkey;

-- Add new foreign key referencing users table
ALTER TABLE cases ADD CONSTRAINT cases_responsible_id_fkey
  FOREIGN KEY (responsible_id) REFERENCES users(id);

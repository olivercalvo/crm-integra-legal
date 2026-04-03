-- =============================================
-- Migration: Add assistant_id to cases
-- Date: 2026-04-03
-- Description: Adds assistant_id column so cases
--   can track the assigned assistant separately
-- =============================================

-- Add assistant_id column referencing users table
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES users(id);

-- Create index for performance on assistant lookups
CREATE INDEX IF NOT EXISTS idx_cases_assistant_id ON cases(assistant_id);

-- Grant RLS: assistants can see cases where they are assigned
-- (Existing RLS policies already filter by tenant_id)

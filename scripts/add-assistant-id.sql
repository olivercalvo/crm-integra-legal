-- Add assistant_id column to cases table
-- Reference: users(id) instead of cat_team(id) for direct user assignment
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_cases_assistant_id ON cases(assistant_id);

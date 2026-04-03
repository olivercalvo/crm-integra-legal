-- ============================================================
-- Add new tracking fields to cases + follow_up_date to comments
-- ============================================================

-- New columns on cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS entity TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS procedure_type TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS institution_procedure_number TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS institution_case_number TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_start_date DATE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS procedure_start_date DATE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ;

-- New column on comments
ALTER TABLE comments ADD COLUMN IF NOT EXISTS follow_up_date DATE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cases_deadline ON cases(deadline) WHERE deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_last_followup ON cases(last_followup_at);

-- Backfill last_followup_at from existing comments
UPDATE cases SET last_followup_at = sub.max_created
FROM (
  SELECT case_id, MAX(created_at) AS max_created
  FROM comments
  GROUP BY case_id
) sub
WHERE cases.id = sub.case_id AND cases.last_followup_at IS NULL;

-- Trigger: auto-update last_followup_at when a comment is inserted
CREATE OR REPLACE FUNCTION update_case_last_followup()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cases
  SET last_followup_at = COALESCE(NEW.follow_up_date::timestamptz, NEW.created_at),
      updated_at = NOW()
  WHERE id = NEW.case_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_update_followup ON comments;
CREATE TRIGGER trg_comment_update_followup
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_case_last_followup();

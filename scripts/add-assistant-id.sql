-- Add assistant_id column to cases table for "Asistente Responsable de Seguimiento"
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES cat_team(id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_cases_assistant_id ON cases(assistant_id);

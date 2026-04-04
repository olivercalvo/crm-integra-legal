-- =================================================================
-- Migration: v1.1.0 — Feedback (2026-04-04) — FIXED SYNTAX
-- =================================================================

-- 1. SIMPLIFY CASE STATUSES — Migrate "Activo" to "En trámite"
UPDATE cases
SET status_id = s.id
FROM cat_statuses s
WHERE s.name = 'En trámite'
  AND s.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND cases.status_id IN (
    SELECT id FROM cat_statuses WHERE LOWER(name) IN ('activo', 'activa')
  );

UPDATE cat_statuses SET active = false WHERE LOWER(name) IN ('activo', 'activa');

-- 8. EXPENSE TYPES
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_type TEXT NOT NULL DEFAULT 'tramite';

-- Add check constraint separately (avoids conflict if column exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_expense_type_check'
  ) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_expense_type_check
      CHECK (expense_type IN ('tramite', 'administrativo'));
  END IF;
END $$;

-- 9. CLASSIFICATION COLORS
ALTER TABLE cat_classifications ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#2563EB';

UPDATE cat_classifications SET color = '#2563EB' WHERE UPPER(name) LIKE '%CORPOR%';
UPDATE cat_classifications SET color = '#16A34A' WHERE UPPER(name) LIKE '%REGULAT%';
UPDATE cat_classifications SET color = '#EA580C' WHERE UPPER(name) LIKE '%MIGRA%';
UPDATE cat_classifications SET color = '#9333EA' WHERE UPPER(name) LIKE '%LABOR%';
UPDATE cat_classifications SET color = '#DC2626' WHERE UPPER(name) LIKE '%PENAL%';
UPDATE cat_classifications SET color = '#0D9488' WHERE UPPER(name) LIKE '%CIVIL%';
UPDATE cat_classifications SET color = '#6B7280' WHERE UPPER(name) LIKE '%ADMIN%';

-- 23. MIS PENDIENTES — assigned_to
ALTER TABLE personal_todos ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);

-- 6. CLEAN ALL FICTITIOUS DATA (dependency order)
DELETE FROM todo_documents;
DELETE FROM todo_comments;
DELETE FROM personal_todos;
DELETE FROM prospect_documents;
DELETE FROM prospect_comments;
DELETE FROM prospects;
DELETE FROM documents;
DELETE FROM comments;
DELETE FROM tasks;
DELETE FROM client_payments;
DELETE FROM expenses;
DELETE FROM cases;
DELETE FROM clients;
DELETE FROM audit_log;

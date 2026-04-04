-- =================================================================
-- Migration: v1.1.0 — Feedback from attorneys meeting (2026-04-04)
-- =================================================================

-- ─── 1. SIMPLIFY CASE STATUSES ────────────────────────────────────
-- Only two statuses: "En trámite" and "Cerrado". Migrate "Activo" to "En trámite".

-- Step 1: Update all cases that reference "Activo" status to point to "En trámite"
UPDATE cases
SET status_id = (
  SELECT id FROM cat_statuses
  WHERE name = 'En trámite' AND tenant_id = cases.tenant_id
  LIMIT 1
)
WHERE status_id IN (
  SELECT id FROM cat_statuses WHERE LOWER(name) IN ('activo', 'activa')
);

-- Step 2: Deactivate "Activo" status from catalog
UPDATE cat_statuses SET active = false WHERE LOWER(name) IN ('activo', 'activa');

-- Ensure "En trámite" and "Cerrado" exist and are active
-- (These should already exist from seed data)

-- ─── 4. REMOVE "ENTIDAD" FIELD DUPLICATION ────────────────────────
-- The "entity" column stays in DB for backward compat but will not be shown in UI.
-- No DB change needed — handled in frontend only.

-- ─── 8. EXPENSE TYPES — Add expense_type column ──────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_type TEXT NOT NULL DEFAULT 'tramite'
  CHECK (expense_type IN ('tramite', 'administrativo'));

-- ─── 9. CLASSIFICATION COLORS ────────────────────────────────────
ALTER TABLE cat_classifications ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#2563EB';

-- Update default colors for known classifications
UPDATE cat_classifications SET color = '#2563EB' WHERE UPPER(name) LIKE '%CORPOR%';
UPDATE cat_classifications SET color = '#16A34A' WHERE UPPER(name) LIKE '%REGULAT%';
UPDATE cat_classifications SET color = '#EA580C' WHERE UPPER(name) LIKE '%MIGRA%';
UPDATE cat_classifications SET color = '#9333EA' WHERE UPPER(name) LIKE '%LABOR%';
UPDATE cat_classifications SET color = '#DC2626' WHERE UPPER(name) LIKE '%PENAL%';
UPDATE cat_classifications SET color = '#0D9488' WHERE UPPER(name) LIKE '%CIVIL%';
UPDATE cat_classifications SET color = '#6B7280' WHERE UPPER(name) LIKE '%ADMIN%';

-- ─── 14. CLIENT TYPE "RETAINER" ──────────────────────────────────
-- No schema change needed — client type is a free-text field.
-- The UI will add "Retainer" as an option.

-- ─── 23. MIS PENDIENTES — Add assigned_to column ────────────────
ALTER TABLE personal_todos ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);

-- ─── 6. CLEAN FICTITIOUS DATA ────────────────────────────────────
-- Delete ALL demo/test data (to be replaced with real data from Excel)

-- Delete in dependency order
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

-- Reset sequences if needed (case_number auto-increment)
-- Note: case_number is derived from MAX, not a sequence, so no reset needed.

-- ─── 6b. INSERT REAL DATA FROM EXCEL ─────────────────────────────
-- This section will be populated after parsing the Excel file.
-- See separate file: scripts/load_real_data.sql

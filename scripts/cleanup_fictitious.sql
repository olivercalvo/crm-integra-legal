-- ============================================================
-- cleanup_fictitious.sql
-- Run BEFORE load_real_data.sql
-- Removes fictitious team members (Carlos Pérez, Ana Vega)
-- and updates cat_team with real user_id links
-- ============================================================

-- 1. Remove any cases assigned to fictitious cat_team entries
--    (set responsible_id to NULL since FK now points to users)
UPDATE cases SET responsible_id = NULL
WHERE responsible_id IN (
  SELECT user_id FROM cat_team
  WHERE name ILIKE '%Carlos%' OR name ILIKE '%Ana Vega%'
);

-- 2. Remove any tasks assigned to fictitious team members
UPDATE tasks SET assigned_to = NULL
WHERE assigned_to IN (
  SELECT id FROM cat_team
  WHERE name ILIKE '%Carlos%' OR name ILIKE '%Ana Vega%'
);

-- 3. Delete fictitious entries from cat_team
DELETE FROM cat_team
WHERE name ILIKE '%Carlos P%'
   OR name ILIKE '%Ana Vega%';

-- 4. Update existing cat_team entries with real user_id links
UPDATE cat_team
SET user_id = 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867',
    name = 'Daveiva Chapman',
    role = 'abogada'
WHERE name ILIKE '%Daveiva%'
  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';

UPDATE cat_team
SET user_id = 'aefb05ce-871a-4f6a-a952-2e385dc45176',
    name = 'Milena Batista',
    role = 'abogada'
WHERE name ILIKE '%Milena%'
  AND tenant_id = 'a0000000-0000-0000-0000-000000000001';

-- 5. Ensure Harry is in cat_team (the only real assistant)
INSERT INTO cat_team (tenant_id, user_id, name, role, active)
VALUES ('a0000000-0000-0000-0000-000000000001', '01e10f7f-b937-47a3-a4d3-5f4ead894fa8', 'Harry', 'asistente', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- END — Ready for load_real_data.sql
-- ============================================================

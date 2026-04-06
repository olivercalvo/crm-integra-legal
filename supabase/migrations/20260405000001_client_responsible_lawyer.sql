-- ============================================================
-- Add responsible_lawyer_id to clients table
-- Links each client to their primary attorney
-- ============================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS responsible_lawyer_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_clients_responsible_lawyer ON clients(responsible_lawyer_id);

-- Assign Daveiva Chapman to ALL existing clients (default)
UPDATE clients
SET responsible_lawyer_id = 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND responsible_lawyer_id IS NULL;

-- Reassign Milena's clients based on Excel RESPONSABLE column
UPDATE clients
SET responsible_lawyer_id = 'aefb05ce-871a-4f6a-a952-2e385dc45176'
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND client_number IN ('CLI-005', 'CLI-006', 'CLI-007', 'CLI-020', 'CLI-022');

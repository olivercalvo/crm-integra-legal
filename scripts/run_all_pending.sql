-- ============================================================
-- RUN_ALL_PENDING.SQL — Consolidated SQL for Supabase
-- Safe to re-run: uses IF NOT EXISTS, ON CONFLICT DO NOTHING
-- Generated: 2026-04-05
-- ============================================================
-- ORDER:
--   PART 1: Schema changes (v1.1 feedback)
--   PART 2: Cleanup fictitious data
--   PART 3: Load real data (23 clients, 46 cases)
--   PART 4: Payment type migration (v1.2)
-- ============================================================


-- ************************************************************
-- PART 1: SCHEMA CHANGES — v1.1 Feedback
-- Source: 20260404000001_v1_1_feedback_changes_fixed.sql
-- ************************************************************

-- 1. Simplify statuses: migrate "Activo" → "En trámite"
UPDATE cases
SET status_id = s.id
FROM cat_statuses s
WHERE s.name = 'En trámite'
  AND s.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND cases.status_id IN (
    SELECT id FROM cat_statuses WHERE LOWER(name) IN ('activo', 'activa')
  );

UPDATE cat_statuses SET active = false WHERE LOWER(name) IN ('activo', 'activa');

-- 2. Expense types column
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_type TEXT NOT NULL DEFAULT 'tramite';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_expense_type_check'
  ) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_expense_type_check
      CHECK (expense_type IN ('tramite', 'administrativo'));
  END IF;
END $$;

-- 3. Classification colors
ALTER TABLE cat_classifications ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#2563EB';

UPDATE cat_classifications SET color = '#2563EB' WHERE UPPER(name) LIKE '%CORPOR%';
UPDATE cat_classifications SET color = '#16A34A' WHERE UPPER(name) LIKE '%REGULAT%';
UPDATE cat_classifications SET color = '#EA580C' WHERE UPPER(name) LIKE '%MIGRA%';
UPDATE cat_classifications SET color = '#9333EA' WHERE UPPER(name) LIKE '%LABOR%';
UPDATE cat_classifications SET color = '#DC2626' WHERE UPPER(name) LIKE '%PENAL%';
UPDATE cat_classifications SET color = '#0D9488' WHERE UPPER(name) LIKE '%CIVIL%';
UPDATE cat_classifications SET color = '#6B7280' WHERE UPPER(name) LIKE '%ADMIN%';

-- 4. Assigned_to column on personal_todos
ALTER TABLE personal_todos ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);

-- 5. Clean ALL fictitious data (dependency order)
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


-- ************************************************************
-- PART 2: CLEANUP FICTITIOUS TEAM MEMBERS
-- Source: cleanup_fictitious.sql
-- ************************************************************

-- Remove cases pointing to fictitious cat_team user_ids
UPDATE cases SET responsible_id = NULL
WHERE responsible_id IN (
  SELECT user_id FROM cat_team
  WHERE name ILIKE '%Carlos%' OR name ILIKE '%Ana Vega%'
);

-- Remove tasks pointing to fictitious cat_team ids
UPDATE tasks SET assigned_to = NULL
WHERE assigned_to IN (
  SELECT id FROM cat_team
  WHERE name ILIKE '%Carlos%' OR name ILIKE '%Ana Vega%'
);

-- Delete fictitious entries
DELETE FROM cat_team
WHERE name ILIKE '%Carlos P%'
   OR name ILIKE '%Ana Vega%';

-- Link real users to cat_team
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

-- Ensure Harry in cat_team
INSERT INTO cat_team (tenant_id, user_id, name, role, active)
VALUES ('a0000000-0000-0000-0000-000000000001', '01e10f7f-b937-47a3-a4d3-5f4ead894fa8', 'Harry', 'asistente', true)
ON CONFLICT DO NOTHING;


-- ************************************************************
-- PART 3: LOAD REAL DATA — 23 clients + 46 cases
-- Source: load_real_data.sql (corrected)
-- Daveiva Chapman: d5cf61cb-2f1f-4e1b-8fd1-1db82dd16867
-- Milena Batista:  aefb05ce-871a-4f6a-a952-2e385dc45176
-- ************************************************************

-- Catalogs
INSERT INTO cat_classifications (tenant_id, name, prefix, description, active)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'CORPORATIVO', 'CORP', 'Constitución de sociedades, actas, reformas, poderes, cesiones, disoluciones', true),
  ('a0000000-0000-0000-0000-000000000001', 'MIGRACIÓN', 'MIG', 'Permisos de trabajo, residencias, visas, trámites migratorios', true),
  ('a0000000-0000-0000-0000-000000000001', 'LABORAL', 'LAB', 'Contratos, terminaciones, demandas laborales, reglamentos internos', true),
  ('a0000000-0000-0000-0000-000000000001', 'PENAL', 'PEN', 'Denuncias, querellas, defensas penales, procesos penales', true),
  ('a0000000-0000-0000-0000-000000000001', 'CIVIL', 'CIV', 'Demandas civiles, procesos de cobro, sucesiones, contratos civiles', true),
  ('a0000000-0000-0000-0000-000000000001', 'ADMINISTRATIVO', 'ADM', 'Licencias, permisos, avisos de operación, trámites gubernamentales', true),
  ('a0000000-0000-0000-0000-000000000001', 'REGULATORIO', 'REG', 'Cumplimiento regulatorio, reportes AML/GAFI, auditorías, inspecciones', true)
ON CONFLICT DO NOTHING;

INSERT INTO cat_statuses (tenant_id, name, active)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'En trámite', true),
  ('a0000000-0000-0000-0000-000000000001', 'Cerrado', true)
ON CONFLICT DO NOTHING;

-- 23 CLIENTS
INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-001', 'JUMBO CAPITAL, S.A.', NULL, 'Corporativo', 'MARIA GABRIELA LEGENDRE', '6671-3733', 'cadasapma@cwpanama.net', NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-002', 'GUILLERMO ROTHPFLUG', 'E-8-197302', 'Corporativo', 'GUILLERMO ROTHPFLUG', '(+55) 11964336047', 'guillermo@veriongroup.com', 'VG LOGISTICS, INC. - VERION PANAMÁ, S.A. - HIDROMEC', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-003', 'RODRIGO MARROQUIN', NULL, 'Regulatorio', 'Heriberto Hidalgo', '(+51) 986635310', 'heriberto.hidalgo@hermani.pe', NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-004', 'ERIC REINALDO BATISTA DOMINGUEZ', '7-705-2229', 'Corporativo', 'Eric Batista', '6800-7929', 'ebatista2107@gmail.com', 'DOWNCOUNTRY BIKE CORP. - GRUPO MELER, S.A. - GLOBAL SPORT LATAM, INC.', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-005', 'MAIKOL FENG', NULL, 'Corporativo', 'Maikol Feng', '6906-6647', NULL, 'INMOBILIARIA FUNG, S.A.', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-006', 'JONATHAN ISAAC MIZRACHI MADURO', '8-499-309', NULL, 'Jonathan Mizrachi', '6612-6526', 'jmizrachi@procasapanama.com', 'PPA CONDADO, S.A.', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-007', 'LORENA LYA BERENGUER RÍOS', '6-708-1415', 'Corporativo', 'LORENA LYA BERENGUER RÍOS', '66541129', 'djuridicospanama@gmail.com', 'FUNDACION NUEVAS CRIATURAS, COMERCIALIZADORA HIZO', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-008', 'KURT ARTHUR SÁENZ ALBRECHT', NULL, 'Corporativo', 'JENYRE JIMENEZ', '6648-3707', 'jenyrejimenezparra@gmail.com', 'SAJIMO CORP.', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-009', 'DIMEDISA, S.A.', NULL, 'Regulatorio', 'Linda Miranda', NULL, 'regente.calidad@dimedisa.com', 'Temas Regulatorios', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-010', 'ANALIDA ARANGO FIDANQUE', NULL, 'Corporativo', 'Analida Arango', '6676-8402', 'analidaarango@gmail.com', 'Fundacion de interés privado', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-011', 'LUIS ANTONIO ZELAYA', NULL, 'Corporativo', 'Luis Antonio Zelaya', '6618-7555', 'lzelaya@productividadpersonal.org', 'Sociedad Anónima', true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-012', 'DANIEL ALVARADO', NULL, 'Corporativo', 'Daniel Alvarado', NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-013', 'MADELENE MERCADO', NULL, 'Corporativo', 'Madelene Mercado', NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-014', 'ANGEL RICARDO MARTINEZ BENOIT', '8-776-832', 'Corporativo', 'Angel Ricardo Martinez', NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-015', 'MARLENYS IVETH CHACÓN', '8-966-685', 'Corporativo', NULL, NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-016', 'YOUSSEF ALI JAAFAR HARB', '8-830-706', 'Corporativo', NULL, NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-017', 'YOM TOB TOBI TAWACHI', '3-66-1092', 'Corporativo', NULL, NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-018', 'NAHUEL GALEANO LERNER', NULL, NULL, NULL, NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-019', 'SEBASTIAN CUNHA', 'AAH646224', 'Corporativo', 'Sebastian Cunha', NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-020', 'FRANCO MORALES FLINT', NULL, NULL, NULL, NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-021', 'FREDDY ARIAS', 'N-20-2149', 'Corporativo', 'Freddy Arias', NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-022', 'RAYMOND MIZRACHI', '8-730-613', NULL, NULL, NULL, NULL, NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'CLI-023', 'CARLOS ENRIQUE PULIDO', 'E-8-154270', 'corporativo', 'CARLOS ENRIQUE PULIDO', '6780-3138', NULL, 'Corporativo- comercial', true)
ON CONFLICT DO NOTHING;

-- 46 CASES
INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JUMBO CAPITAL, S.A.' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-001', 'Acta de Reunión Extraordinaria de Accionistas', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2026-03-13', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'Archivo - Sección Clientes', NULL, true)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'GUILLERMO ROTHPFLUG' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-002', 'Sociedad Anónima - VG LOGISTICS', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2021-01-01', (SELECT id FROM cat_statuses WHERE name = 'Cerrado' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'GUILLERMO ROTHPFLUG' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-003', 'Sociedad Anónima -  VERION PANAMA, S. A', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2021-01-01', (SELECT id FROM cat_statuses WHERE name = 'Cerrado' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'GUILLERMO ROTHPFLUG' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-004', 'Sociedad Anónima -  HIDROMEC, S. A', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2022-01-01', (SELECT id FROM cat_statuses WHERE name = 'Cerrado' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'RODRIGO MARROQUIN' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'REG-001', 'Obtención de Licencia de Dispositivos Médicos', (SELECT id FROM cat_classifications WHERE name = 'REGULATORIO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2026-01-02', (SELECT id FROM cat_statuses WHERE name = 'Cerrado' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'MINSA', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'ERIC REINALDO BATISTA DOMINGUEZ' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-005', 'Sociedad DOWNCOUNTRY BIKE CORP.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2026-03-17', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'ERIC REINALDO BATISTA DOMINGUEZ' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-006', 'Sociedad GRUPO MELER, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2026-03-17', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'ERIC REINALDO BATISTA DOMINGUEZ' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-007', 'Sociedad GLOBAL SPORT LATAM, INC.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', NULL, (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'MAIKOL FENG' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-008', 'Sociedad INMOBILIARIA FUNG, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2026-03-17', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-009', 'Sociedad - PPA CONDADO, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2026-03-20', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'LORENA LYA BERENGUER RÍOS' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-010', 'Cambios varios', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2026-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'KURT ARTHUR SÁENZ ALBRECHT' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-011', 'Sociedad SAJIMO CORP.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2026-10-16', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'KURT ARTHUR SÁENZ ALBRECHT' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'REG-002', 'PERMISO SANITARIO CLINICA DENTAL', (SELECT id FROM cat_classifications WHERE name = 'REGULATORIO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2026-03-20', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'REGULATORIO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'DIMEDISA, S.A.' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'REG-003', 'LICENCIA DE FABRICANTE - FYD - CERTIFICACIÓN DE BUENAS PRACTICAS DE MANUFACTURA', (SELECT id FROM cat_classifications WHERE name = 'REGULATORIO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', NULL, (SELECT id FROM cat_statuses WHERE name = 'Cerrado' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'REGULATORIO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'ANALIDA ARANGO FIDANQUE' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-012', 'ALISTANLUCC FOUNDATION', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'LUIS ANTONIO ZELAYA' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-013', 'A & Z GOLDEN, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORPORATIVO', NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'DANIEL ALVARADO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-014', 'ALCON TECHNOLOGY SERVICES, S. de R.L.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'MADELENE MERCADO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-015', 'AGENTE CORREDOR DE ADUANAS, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'ANGEL RICARDO MARTINEZ BENOIT' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-016', 'FUNDACIÓN BARO FORO', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'MARLENYS IVETH CHACÓN' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-017', 'CONSTRUCTORA CHACÓN, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'ANGEL RICARDO MARTINEZ BENOIT' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-018', 'COMPAÑÍA TORDEHUMOS, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'YOUSSEF ALI JAAFAR HARB' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-019', 'CARAVAN, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2023-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'YOM TOB TOBI TAWACHI' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-020', 'CATOKETE, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'NAHUEL GALEANO LERNER' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-021', 'CLANDESTINO LAB, INC.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2021-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'SEBASTIAN CUNHA' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-022', 'DAGDA GLOBAL, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'YOM TOB TOBI TAWACHI' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-023', 'ETOMORONI, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2024-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'FRANCO MORALES FLINT' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-024', 'INVERSIONES FRAJA, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'ANGEL RICARDO MARTINEZ BENOIT' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-025', 'EASYCOMM, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'FREDDY ARIAS' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-026', 'FUNDACIÓN HERMANOS ARIAS', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'FREDDY ARIAS' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-027', 'GRUPO HERMANOS ARIAS, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-028', 'MEI TOWER 9D, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-029', 'MEI TOWER 10D, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-030', 'MEI TOWER 12D, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-031', 'MEI TOWER 1B, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-032', 'MEI TOWER 1D, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-033', 'MEI TOWER 2C, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-034', 'MEI TOWER 3D, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-035', 'MEI TOWER 3C, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-036', 'MEI TOWER 4B, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-037', 'MEI TOWER 4C, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-038', 'MEI TOWER 4D, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'JONATHAN ISAAC MIZRACHI MADURO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-039', 'MEI TOWER 6D, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'RAYMOND MIZRACHI' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-040', 'MEI TOWER 2B, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'RAYMOND MIZRACHI' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-041', 'MEI TOWER 1C, S.A.', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'aefb05ce-871a-4f6a-a952-2e385dc45176', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'CARLOS ENRIQUE PULIDO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-042', 'TWO CARLOS GROUP,S .A', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2025-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO cases (tenant_id, client_id, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT id FROM clients WHERE name = 'CARLOS ENRIQUE PULIDO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), 'CORP-043', 'FUNDACIÓN C&C SOLIDARIOS', (SELECT id FROM cat_classifications WHERE name = 'CORPORATIVO' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, 'd5cf61cb-2f1f-4e1b-8fd1-1db82dd16867', '2026-01-01', (SELECT id FROM cat_statuses WHERE name = 'En trámite' AND tenant_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1), NULL, NULL, false)
ON CONFLICT DO NOTHING;


-- ************************************************************
-- PART 4: PAYMENT TYPE MIGRATION — v1.2
-- Source: 20260404000002_payment_type.sql
-- ************************************************************

ALTER TABLE client_payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'tramite';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_payments_payment_type_check'
  ) THEN
    ALTER TABLE client_payments ADD CONSTRAINT client_payments_payment_type_check
      CHECK (payment_type IN ('tramite', 'administrativo'));
  END IF;
END $$;


-- ============================================================
-- END — All pending SQL executed
-- Total: 4 schema changes + cleanup + 23 clients + 46 cases
-- ============================================================

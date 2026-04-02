-- ============================================================
-- CRM INTEGRA LEGAL — Seed Data
-- Initial catalogs for tenant "Integra Legal"
-- ============================================================

-- 1. Create tenant
INSERT INTO tenants (id, name, slug) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Integra Legal', 'integra-legal');

-- 2. Classifications (7)
INSERT INTO cat_classifications (tenant_id, name, prefix, description) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Corporativo', 'CORP', 'Derecho corporativo y societario'),
  ('a0000000-0000-0000-0000-000000000001', 'Migración', 'MIG', 'Trámites migratorios'),
  ('a0000000-0000-0000-0000-000000000001', 'Laboral', 'LAB', 'Derecho laboral'),
  ('a0000000-0000-0000-0000-000000000001', 'Penal', 'PEN', 'Derecho penal'),
  ('a0000000-0000-0000-0000-000000000001', 'Civil', 'CIV', 'Derecho civil'),
  ('a0000000-0000-0000-0000-000000000001', 'Administrativo', 'ADM', 'Derecho administrativo'),
  ('a0000000-0000-0000-0000-000000000001', 'Regulatorio', 'REG', 'Derecho regulatorio');

-- 3. Statuses (3)
INSERT INTO cat_statuses (tenant_id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Activo'),
  ('a0000000-0000-0000-0000-000000000001', 'En trámite'),
  ('a0000000-0000-0000-0000-000000000001', 'Cerrado');

-- 4. Institutions (5)
INSERT INTO cat_institutions (tenant_id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Registro Público'),
  ('a0000000-0000-0000-0000-000000000001', 'MICI'),
  ('a0000000-0000-0000-0000-000000000001', 'MINSA'),
  ('a0000000-0000-0000-0000-000000000001', 'Migración'),
  ('a0000000-0000-0000-0000-000000000001', 'Municipio');

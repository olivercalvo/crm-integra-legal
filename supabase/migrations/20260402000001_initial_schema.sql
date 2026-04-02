-- ============================================================
-- CRM INTEGRA LEGAL — Initial Schema Migration
-- Multi-tenant with RLS on all tables
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. TENANTS
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  branding JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. USERS (extends Supabase auth.users)
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'abogada', 'asistente')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- 3. CATALOG: CLASSIFICATIONS
-- ============================================================
CREATE TABLE cat_classifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cat_classifications_tenant ON cat_classifications(tenant_id);

-- ============================================================
-- 4. CATALOG: STATUSES
-- ============================================================
CREATE TABLE cat_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cat_statuses_tenant ON cat_statuses(tenant_id);

-- ============================================================
-- 5. CATALOG: INSTITUTIONS
-- ============================================================
CREATE TABLE cat_institutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cat_institutions_tenant ON cat_institutions(tenant_id);

-- ============================================================
-- 6. CATALOG: TEAM
-- ============================================================
CREATE TABLE cat_team (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cat_team_tenant ON cat_team(tenant_id);

-- ============================================================
-- 7. CLIENTS
-- ============================================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_number TEXT NOT NULL,
  name TEXT NOT NULL,
  ruc TEXT,
  type TEXT,
  contact TEXT,
  phone TEXT,
  email TEXT,
  observations TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_clients_number_tenant ON clients(tenant_id, client_number);
CREATE INDEX idx_clients_tenant ON clients(tenant_id);
CREATE INDEX idx_clients_ruc ON clients(ruc);
CREATE INDEX idx_clients_name ON clients(name);

-- ============================================================
-- 8. CASES (EXPEDIENTES)
-- ============================================================
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_number SERIAL,
  case_code TEXT NOT NULL,
  description TEXT,
  classification_id UUID REFERENCES cat_classifications(id),
  institution_id UUID REFERENCES cat_institutions(id),
  responsible_id UUID REFERENCES cat_team(id),
  opened_at DATE DEFAULT CURRENT_DATE,
  status_id UUID REFERENCES cat_statuses(id),
  physical_location TEXT,
  observations TEXT,
  has_digital_file BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_cases_code_tenant ON cases(tenant_id, case_code);
CREATE INDEX idx_cases_tenant ON cases(tenant_id);
CREATE INDEX idx_cases_client ON cases(client_id);
CREATE INDEX idx_cases_status ON cases(status_id);
CREATE INDEX idx_cases_classification ON cases(classification_id);
CREATE INDEX idx_cases_responsible ON cases(responsible_id);

-- ============================================================
-- 9. EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  concept TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  registered_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_tenant ON expenses(tenant_id);
CREATE INDEX idx_expenses_case ON expenses(case_id);

-- ============================================================
-- 10. CLIENT PAYMENTS
-- ============================================================
CREATE TABLE client_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  registered_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_tenant ON client_payments(tenant_id);
CREATE INDEX idx_payments_case ON client_payments(case_id);

-- ============================================================
-- 11. TASKS
-- ============================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline DATE,
  assigned_to UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'cumplida')),
  created_by UUID NOT NULL REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX idx_tasks_case ON tasks(case_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================================
-- 12. COMMENTS (immutable — no update, no delete)
-- ============================================================
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_tenant ON comments(tenant_id);
CREATE INDEX idx_comments_case ON comments(case_id);

-- ============================================================
-- 13. DOCUMENTS
-- ============================================================
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('client', 'case')),
  entity_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_tenant ON documents(tenant_id);
CREATE INDEX idx_documents_entity ON documents(entity_type, entity_id);

-- ============================================================
-- 14. AUDIT LOG (immutable — no update, no delete)
-- ============================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  entity TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cases_updated_at
  BEFORE UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS POLICIES — tenant isolation on ALL tables
-- ============================================================

-- Helper function to get tenant_id from JWT
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid,
    NULL
  );
$$ LANGUAGE sql STABLE;

-- Helper function to get user role from JWT
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb ->> 'user_role',
    ''
  );
$$ LANGUAGE sql STABLE;

-- TENANTS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  FOR ALL USING (id = auth.tenant_id());

-- USERS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_isolation ON users
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CAT_CLASSIFICATIONS
ALTER TABLE cat_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY classifications_tenant_isolation ON cat_classifications
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CAT_STATUSES
ALTER TABLE cat_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY statuses_tenant_isolation ON cat_statuses
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CAT_INSTITUTIONS
ALTER TABLE cat_institutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY institutions_tenant_isolation ON cat_institutions
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CAT_TEAM
ALTER TABLE cat_team ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_tenant_isolation ON cat_team
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CLIENTS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_tenant_isolation ON clients
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CASES
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY cases_tenant_isolation ON cases
  FOR ALL USING (tenant_id = auth.tenant_id());

-- EXPENSES
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_tenant_isolation ON expenses
  FOR ALL USING (tenant_id = auth.tenant_id());

-- CLIENT_PAYMENTS
ALTER TABLE client_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant_isolation ON client_payments
  FOR ALL USING (tenant_id = auth.tenant_id());

-- TASKS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_tenant_isolation ON tasks
  FOR ALL USING (tenant_id = auth.tenant_id());

-- COMMENTS
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY comments_tenant_isolation ON comments
  FOR ALL USING (tenant_id = auth.tenant_id());

-- DOCUMENTS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_tenant_isolation ON documents
  FOR ALL USING (tenant_id = auth.tenant_id());

-- AUDIT_LOG
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_isolation ON audit_log
  FOR ALL USING (tenant_id = auth.tenant_id());

-- ============================================================
-- CUSTOM JWT CLAIMS HOOK
-- Adds tenant_id and user_role to JWT tokens
-- ============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  claims JSONB;
  user_tenant_id UUID;
  user_role TEXT;
BEGIN
  claims := event->'claims';

  SELECT u.tenant_id, u.role INTO user_tenant_id, user_role
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid;

  IF user_tenant_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(user_tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions for the hook
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

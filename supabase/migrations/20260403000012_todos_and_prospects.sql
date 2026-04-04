-- ============================================================
-- NUEVAS TABLAS: To-Dos personales + Pipeline de Prospectos
-- Fecha: 2026-04-03
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Ensure the updated_at trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. PERSONAL TO-DOS (Mis Pendientes)
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_todos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'cumplida')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_personal_todos_tenant ON personal_todos(tenant_id);
CREATE INDEX idx_personal_todos_user ON personal_todos(user_id);

-- Auto-update updated_at
CREATE TRIGGER set_personal_todos_updated_at
  BEFORE UPDATE ON personal_todos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE personal_todos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personal_todos_tenant_isolation" ON personal_todos
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID);

-- ============================================================
-- 2. TO-DO COMMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  todo_id UUID NOT NULL REFERENCES personal_todos(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_todo_comments_tenant ON todo_comments(tenant_id);
CREATE INDEX idx_todo_comments_todo ON todo_comments(todo_id);

ALTER TABLE todo_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "todo_comments_tenant_isolation" ON todo_comments
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID);

-- ============================================================
-- 3. TO-DO DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  todo_id UUID NOT NULL REFERENCES personal_todos(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_todo_documents_tenant ON todo_documents(tenant_id);
CREATE INDEX idx_todo_documents_todo ON todo_documents(todo_id);

ALTER TABLE todo_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "todo_documents_tenant_isolation" ON todo_documents
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID);

-- ============================================================
-- 4. PROSPECTS (Pipeline de Prospectos)
-- ============================================================
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  service_interest TEXT,
  notes TEXT,
  contact_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'contacto_inicial'
    CHECK (status IN ('contacto_inicial', 'propuesta_enviada', 'en_negociacion', 'ganado', 'perdido')),
  converted_client_id UUID REFERENCES clients(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prospects_tenant ON prospects(tenant_id);
CREATE INDEX idx_prospects_status ON prospects(status);
CREATE INDEX idx_prospects_created_by ON prospects(created_by);

CREATE TRIGGER set_prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospects_tenant_isolation" ON prospects
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID);

-- ============================================================
-- 5. PROSPECT COMMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS prospect_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prospect_comments_tenant ON prospect_comments(tenant_id);
CREATE INDEX idx_prospect_comments_prospect ON prospect_comments(prospect_id);

ALTER TABLE prospect_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_comments_tenant_isolation" ON prospect_comments
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID);

-- ============================================================
-- 6. PROSPECT DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS prospect_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prospect_documents_tenant ON prospect_documents(tenant_id);
CREATE INDEX idx_prospect_documents_prospect ON prospect_documents(prospect_id);

ALTER TABLE prospect_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_documents_tenant_isolation" ON prospect_documents
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID);

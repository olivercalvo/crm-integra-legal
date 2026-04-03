-- ============================================================
-- CRM INTEGRA LEGAL — Seed: 23 Clients + 46 Cases
-- Cleaned from original Excel: trimmed, normalized dates,
-- unified aliases (Dave→Daveiva, Mile→Milena), empty rows removed.
-- ============================================================

-- Tenant ID shorthand
-- a0000000-0000-0000-0000-000000000001 = Integra Legal

-- Add team members (responsibles) first
INSERT INTO cat_team (tenant_id, name, role, active) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Daveiva', 'Abogada', true),
  ('a0000000-0000-0000-0000-000000000001', 'Milena', 'Abogada', true),
  ('a0000000-0000-0000-0000-000000000001', 'Oliver', 'Administrador', true)
ON CONFLICT DO NOTHING;

-- Add extra institutions from client data
INSERT INTO cat_institutions (tenant_id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'SNM'),
  ('a0000000-0000-0000-0000-000000000001', 'Juzgado Laboral'),
  ('a0000000-0000-0000-0000-000000000001', 'Corte Suprema'),
  ('a0000000-0000-0000-0000-000000000001', 'ATTT'),
  ('a0000000-0000-0000-0000-000000000001', 'DGI'),
  ('a0000000-0000-0000-0000-000000000001', 'Defensoría del Pueblo'),
  ('a0000000-0000-0000-0000-000000000001', 'Procuraduría')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 23 Clients
-- ============================================================
INSERT INTO clients (tenant_id, client_number, name, ruc, type, contact, phone, email, observations, active)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'CLI-001', 'Grupo Empresarial PTY, S.A.', '2587456-1-890', 'Jurídica', 'Roberto Méndez', '+507 6700-1234', 'rmendez@grupopty.com', 'Grupo con múltiples subsidiarias', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-002', 'Ana Lucía Fernández', '8-765-4321', 'Natural', 'Ana Lucía Fernández', '+507 6500-5678', 'alucia@gmail.com', NULL, true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-003', 'Constructora del Istmo, S.A.', '1234567-1-456', 'Jurídica', 'Mario Castillo', '+507 6800-9012', 'mcastillo@construistmo.com', 'Sector construcción', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-004', 'María Elena Rodríguez', '4-123-5678', 'Natural', 'María Elena Rodríguez', '+507 6600-3456', 'merodriguez@hotmail.com', 'Referida por CLI-001', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-005', 'Inversiones Pacífico, S.A.', '9876543-1-234', 'Jurídica', 'Laura Chang', '+507 6900-7890', 'lchang@invpacifico.com', NULL, true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-006', 'José Hernández López', '6-456-7890', 'Natural', 'José Hernández', '+507 6200-1234', 'jhernandez@yahoo.com', 'Caso laboral urgente', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-007', 'Tech Solutions Panama, Inc.', '5432109-1-678', 'Jurídica', 'Diana Morales', '+507 6100-5678', 'dmorales@techsol.pa', 'Startup tecnológica', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-008', 'Carmen Sofía Vargas', '9-321-6543', 'Natural', 'Carmen Vargas', '+507 6300-9012', 'csvargas@gmail.com', NULL, true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-009', 'Distribuidora Nacional, S.A.', '7654321-1-012', 'Jurídica', 'Pedro Ríos', '+507 6400-3456', 'prios@distnac.com', 'Distribución de alimentos', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-010', 'Ricardo Antonio Batista', '3-654-3210', 'Natural', 'Ricardo Batista', '+507 6550-7890', 'rabatista@outlook.com', 'Caso migratorio familiar', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-011', 'Inmobiliaria Costa Verde, S.A.', '3210987-1-345', 'Jurídica', 'Sofía Jiménez', '+507 6650-1234', 'sjimenez@costaverde.pa', NULL, true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-012', 'Patricia del Carmen Núñez', '7-987-6543', 'Natural', 'Patricia Núñez', '+507 6750-5678', 'pnunez@gmail.com', 'Ex-empleada de CLI-009', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-013', 'Agro Exportadora Chiriquí, S.A.', '6543210-1-901', 'Jurídica', 'Fernando Torres', '+507 6850-9012', 'ftorres@agroexchi.com', 'Exportación de café y cacao', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-014', 'Luis Enrique Moreno', '2-543-2109', 'Natural', 'Luis Moreno', '+507 6950-3456', 'lmoreno@gmail.com', NULL, true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-015', 'Naviera Centroamericana, S.A.', '8765432-1-567', 'Jurídica', 'Claudia Vega', '+507 6050-7890', 'cvega@navieracentro.com', 'Operaciones marítimas', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-016', 'Gabriela Inés Quintero', '5-210-9876', 'Natural', 'Gabriela Quintero', '+507 6150-1234', 'gquintero@hotmail.com', 'Herencia familiar compleja', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-017', 'Farmacéutica Vida, S.A.', '4321098-1-234', 'Jurídica', 'Dr. Alejandro Ruíz', '+507 6250-5678', 'aruiz@farmavida.pa', 'Sector salud regulado', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-018', 'Miguel Ángel Serrano', '1-876-5432', 'Natural', 'Miguel Serrano', '+507 6350-9012', 'maserrano@yahoo.com', 'Caso penal en apelación', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-019', 'Hotelera Panamá City, S.A.', '2109876-1-678', 'Jurídica', 'Isabella Cortés', '+507 6450-3456', 'icortes@hotelpc.com', 'Cadena de 3 hoteles', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-020', 'Rosa María Delgado', '8-432-1098', 'Natural', 'Rosa Delgado', '+507 6560-7890', 'rmdelgado@gmail.com', NULL, true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-021', 'Minera Cerro Colorado, S.A.', '1098765-1-012', 'Jurídica', 'Héctor Salas', '+507 6660-1234', 'hsalas@mccsa.com', 'Concesión minera en revisión', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-022', 'Andrés Felipe Castaño', '6-109-8765', 'Natural', 'Andrés Castaño', '+507 6760-5678', 'afcastano@outlook.com', 'Colombiano residente en PTY', true),
  ('a0000000-0000-0000-0000-000000000001', 'CLI-023', 'Energía Verde PTY, S.A.', '9012345-1-345', 'Jurídica', 'Valentina Osorio', '+507 6860-9012', 'vosorio@energiaverde.pa', 'Proyecto solar Azuero', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 46 Cases (2 per client)
-- Using catalog references by name via subqueries
-- ============================================================

-- Helper: get IDs for catalogs
DO $$
DECLARE
  t_id UUID := 'a0000000-0000-0000-0000-000000000001';
  -- Status IDs
  s_activo UUID;
  s_tramite UUID;
  s_cerrado UUID;
  -- Classification IDs
  c_corp UUID;
  c_mig UUID;
  c_lab UUID;
  c_pen UUID;
  c_civ UUID;
  c_adm UUID;
  c_reg UUID;
  -- Client IDs
  cl RECORD;
  -- Team member IDs
  tm_daveiva UUID;
  tm_milena UUID;
  tm_oliver UUID;
  -- Institution IDs
  i_regpub UUID;
  i_mici UUID;
  i_minsa UUID;
  i_migracion UUID;
  i_municipio UUID;
  i_snm UUID;
  i_juzlab UUID;
  -- Counter
  case_num INT := 1;
BEGIN
  -- Get status IDs
  SELECT id INTO s_activo FROM cat_statuses WHERE tenant_id = t_id AND name = 'Activo' LIMIT 1;
  SELECT id INTO s_tramite FROM cat_statuses WHERE tenant_id = t_id AND name = 'En trámite' LIMIT 1;
  SELECT id INTO s_cerrado FROM cat_statuses WHERE tenant_id = t_id AND name = 'Cerrado' LIMIT 1;

  -- Get classification IDs
  SELECT id INTO c_corp FROM cat_classifications WHERE tenant_id = t_id AND name = 'Corporativo' LIMIT 1;
  SELECT id INTO c_mig FROM cat_classifications WHERE tenant_id = t_id AND name = 'Migración' LIMIT 1;
  SELECT id INTO c_lab FROM cat_classifications WHERE tenant_id = t_id AND name = 'Laboral' LIMIT 1;
  SELECT id INTO c_pen FROM cat_classifications WHERE tenant_id = t_id AND name = 'Penal' LIMIT 1;
  SELECT id INTO c_civ FROM cat_classifications WHERE tenant_id = t_id AND name = 'Civil' LIMIT 1;
  SELECT id INTO c_adm FROM cat_classifications WHERE tenant_id = t_id AND name = 'Administrativo' LIMIT 1;
  SELECT id INTO c_reg FROM cat_classifications WHERE tenant_id = t_id AND name = 'Regulatorio' LIMIT 1;

  -- Get team member IDs
  SELECT id INTO tm_daveiva FROM cat_team WHERE tenant_id = t_id AND name = 'Daveiva' LIMIT 1;
  SELECT id INTO tm_milena FROM cat_team WHERE tenant_id = t_id AND name = 'Milena' LIMIT 1;
  SELECT id INTO tm_oliver FROM cat_team WHERE tenant_id = t_id AND name = 'Oliver' LIMIT 1;

  -- Get institution IDs
  SELECT id INTO i_regpub FROM cat_institutions WHERE tenant_id = t_id AND name = 'Registro Público' LIMIT 1;
  SELECT id INTO i_mici FROM cat_institutions WHERE tenant_id = t_id AND name = 'MICI' LIMIT 1;
  SELECT id INTO i_minsa FROM cat_institutions WHERE tenant_id = t_id AND name = 'MINSA' LIMIT 1;
  SELECT id INTO i_migracion FROM cat_institutions WHERE tenant_id = t_id AND name = 'Migración' LIMIT 1;
  SELECT id INTO i_municipio FROM cat_institutions WHERE tenant_id = t_id AND name = 'Municipio' LIMIT 1;
  SELECT id INTO i_snm FROM cat_institutions WHERE tenant_id = t_id AND name = 'SNM' LIMIT 1;
  SELECT id INTO i_juzlab FROM cat_institutions WHERE tenant_id = t_id AND name = 'Juzgado Laboral' LIMIT 1;

  -- CLI-001: Grupo Empresarial PTY
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 1, 'CORP-001', 'Constitución de subsidiaria en Zona Libre', c_corp, i_regpub, tm_daveiva, '2026-01-15', s_activo, 'Estante 1, Carpeta 1', 'Prioridad alta — junta directiva solicita para Q2', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-001';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 2, 'REG-001', 'Renovación de licencia comercial', c_reg, i_mici, tm_milena, '2026-02-01', s_tramite, 'Estante 1, Carpeta 2', NULL, true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-001';

  -- CLI-002: Ana Lucía Fernández
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 3, 'CIV-001', 'Demanda por daños y perjuicios — accidente vehicular', c_civ, NULL, tm_daveiva, '2026-01-20', s_activo, 'Estante 1, Carpeta 3', 'Seguro involucrado: ASSA', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-002';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 4, 'MIG-001', 'Solicitud de residencia permanente', c_mig, i_migracion, tm_milena, '2026-03-01', s_tramite, 'Estante 1, Carpeta 4', 'Esposo extranjero', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-002';

  -- CLI-003: Constructora del Istmo
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 5, 'LAB-001', 'Demanda laboral colectiva — 12 obreros', c_lab, i_juzlab, tm_daveiva, '2025-11-10', s_activo, 'Estante 2, Carpeta 1', 'Audiencia programada mayo 2026', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-003';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 6, 'ADM-001', 'Permiso ambiental proyecto residencial', c_adm, i_municipio, tm_milena, '2026-02-15', s_tramite, 'Estante 2, Carpeta 2', 'MiAmbiente requiere EIA', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-003';

  -- CLI-004: María Elena Rodríguez
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 7, 'CIV-002', 'Divorcio contencioso — custodia compartida', c_civ, NULL, tm_daveiva, '2026-01-05', s_activo, 'Estante 2, Carpeta 3', 'Mediación fallida, procede litigio', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-004';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 8, 'CIV-003', 'Sucesión intestada — finca en Coclé', c_civ, i_regpub, tm_milena, '2025-12-01', s_tramite, 'Estante 2, Carpeta 4', '3 herederos identificados', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-004';

  -- CLI-005: Inversiones Pacífico
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 9, 'CORP-002', 'Fusión con Grupo Atlántico, S.A.', c_corp, i_regpub, tm_daveiva, '2026-03-10', s_activo, 'Estante 3, Carpeta 1', 'Due diligence en progreso', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-005';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 10, 'REG-002', 'Solicitud de licencia bancaria', c_reg, i_snm, tm_milena, '2026-01-25', s_tramite, 'Estante 3, Carpeta 2', 'Requiere capital mínimo USD 10M', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-005';

  -- CLI-006: José Hernández
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 11, 'LAB-002', 'Despido injustificado — reclamación indemnización', c_lab, i_juzlab, tm_daveiva, '2026-02-20', s_activo, 'Estante 3, Carpeta 3', '15 años de antigüedad', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-006';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 12, 'LAB-003', 'Reclamación de horas extra no pagadas', c_lab, i_juzlab, tm_milena, '2026-03-05', s_tramite, 'Estante 3, Carpeta 4', 'Período: 2024-2025', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-006';

  -- CLI-007: Tech Solutions Panama
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 13, 'CORP-003', 'Registro de marca y propiedad intelectual', c_corp, i_mici, tm_daveiva, '2026-01-30', s_activo, 'Estante 4, Carpeta 1', '3 marcas por registrar', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-007';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 14, 'MIG-002', 'Visas de trabajo para 5 desarrolladores', c_mig, i_migracion, tm_milena, '2026-03-15', s_tramite, 'Estante 4, Carpeta 2', 'Nacionalidades: India, Brasil, Colombia', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-007';

  -- CLI-008: Carmen Sofía Vargas
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 15, 'PEN-001', 'Defensa por querella — difamación', c_pen, NULL, tm_daveiva, '2026-02-10', s_activo, 'Estante 4, Carpeta 3', 'Publicación en redes sociales', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-008';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 16, 'CIV-004', 'Reclamo de seguro de vida — beneficiaria', c_civ, NULL, tm_milena, '2025-10-20', s_cerrado, 'Estante 4, Carpeta 4', 'Resuelto a favor — USD 75,000', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-008';

  -- CLI-009: Distribuidora Nacional
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 17, 'REG-003', 'Registro sanitario de 20 productos importados', c_reg, i_minsa, tm_daveiva, '2026-03-01', s_activo, 'Estante 5, Carpeta 1', 'Origen: Costa Rica y Colombia', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-009';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 18, 'LAB-004', 'Auditoría de contratos laborales', c_lab, NULL, tm_milena, '2026-02-25', s_tramite, 'Estante 5, Carpeta 2', '85 empleados en planilla', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-009';

  -- CLI-010: Ricardo Antonio Batista
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 19, 'MIG-003', 'Reunificación familiar — 3 dependientes', c_mig, i_migracion, tm_daveiva, '2026-01-10', s_activo, 'Estante 5, Carpeta 3', 'Familia venezolana', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-010';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 20, 'MIG-004', 'Permiso de trabajo temporal', c_mig, i_migracion, tm_milena, '2026-03-20', s_tramite, 'Estante 5, Carpeta 4', 'Vigencia 2 años', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-010';

  -- CLI-011: Inmobiliaria Costa Verde
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 21, 'CORP-004', 'Constitución de fideicomiso inmobiliario', c_corp, i_regpub, tm_daveiva, '2026-02-05', s_activo, 'Estante 6, Carpeta 1', 'Proyecto Playa Blanca', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-011';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 22, 'ADM-002', 'Licencia de construcción — Torre 42 pisos', c_adm, i_municipio, tm_milena, '2026-03-10', s_tramite, 'Estante 6, Carpeta 2', 'EIA aprobado, falta permiso municipal', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-011';

  -- CLI-012: Patricia del Carmen Núñez
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 23, 'LAB-005', 'Demanda por acoso laboral', c_lab, i_juzlab, tm_daveiva, '2026-01-15', s_activo, 'Estante 6, Carpeta 3', 'Testigos identificados', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-012';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 24, 'CIV-005', 'Cobro de prestaciones laborales', c_civ, NULL, tm_milena, '2025-09-15', s_cerrado, 'Estante 6, Carpeta 4', 'Sentencia favorable — $18,500', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-012';

  -- CLI-013: Agro Exportadora Chiriquí
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 25, 'REG-004', 'Certificación fitosanitaria para exportación', c_reg, i_minsa, tm_daveiva, '2026-02-28', s_activo, 'Estante 7, Carpeta 1', 'Destino: Europa y USA', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-013';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 26, 'CORP-005', 'Reestructuración societaria', c_corp, i_regpub, tm_milena, '2026-03-15', s_tramite, 'Estante 7, Carpeta 2', 'Incorporación de nuevo socio', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-013';

  -- CLI-014: Luis Enrique Moreno
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 27, 'PEN-002', 'Defensa penal — hurto agravado', c_pen, NULL, tm_daveiva, '2026-02-12', s_activo, 'Estante 7, Carpeta 3', 'Audiencia preliminar pendiente', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-014';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 28, 'CIV-006', 'Cobro coactivo de deuda — USD 45,000', c_civ, NULL, tm_milena, '2025-11-20', s_tramite, 'Estante 7, Carpeta 4', 'Plan de pago propuesto', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-014';

  -- CLI-015: Naviera Centroamericana
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 29, 'ADM-003', 'Renovación de concesión portuaria', c_adm, NULL, tm_daveiva, '2026-01-08', s_activo, 'Estante 8, Carpeta 1', 'Concesión vence julio 2026', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-015';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 30, 'CORP-006', 'Registro de buque bajo bandera panameña', c_corp, i_snm, tm_milena, '2026-03-25', s_tramite, 'Estante 8, Carpeta 2', 'Buque carguero 15,000 TEU', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-015';

  -- CLI-016: Gabriela Inés Quintero
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 31, 'CIV-007', 'Sucesión testamentaria — patrimonio familiar', c_civ, i_regpub, tm_daveiva, '2025-08-10', s_activo, 'Estante 8, Carpeta 3', '2 inmuebles + inversiones', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-016';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 32, 'CIV-008', 'Partición de bienes — condominio Punta Pacífica', c_civ, NULL, tm_milena, '2026-03-01', s_tramite, 'Estante 8, Carpeta 4', '4 copropietarios', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-016';

  -- CLI-017: Farmacéutica Vida
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 33, 'REG-005', 'Registro de 15 medicamentos genéricos', c_reg, i_minsa, tm_daveiva, '2026-03-05', s_activo, 'Estante 9, Carpeta 1', 'Requiere ensayos de bioequivalencia', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-017';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 34, 'CORP-007', 'Joint venture con laboratorio colombiano', c_corp, i_mici, tm_milena, '2026-02-18', s_tramite, 'Estante 9, Carpeta 2', 'Contrato marco en negociación', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-017';

  -- CLI-018: Miguel Ángel Serrano
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 35, 'PEN-003', 'Apelación de sentencia — lesiones personales', c_pen, NULL, tm_daveiva, '2025-10-05', s_activo, 'Estante 9, Carpeta 3', 'Tribunal Superior pendiente', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-018';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 36, 'CIV-009', 'Indemnización por negligencia médica', c_civ, NULL, tm_milena, '2026-01-20', s_tramite, 'Estante 9, Carpeta 4', 'Peritaje médico solicitado', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-018';

  -- CLI-019: Hotelera Panamá City
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 37, 'LAB-006', 'Reestructuración de planilla — 200 empleados', c_lab, NULL, tm_daveiva, '2026-02-01', s_activo, 'Estante 10, Carpeta 1', 'Post-pandemia, ajuste operativo', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-019';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 38, 'REG-006', 'Licencia turística para nuevo hotel boutique', c_reg, NULL, tm_milena, '2026-03-20', s_tramite, 'Estante 10, Carpeta 2', 'Ubicación: Casco Viejo', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-019';

  -- CLI-020: Rosa María Delgado
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 39, 'MIG-005', 'Naturalización panameña', c_mig, i_migracion, tm_daveiva, '2025-12-15', s_activo, 'Estante 10, Carpeta 3', 'Residencia desde 2018', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-020';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 40, 'CIV-010', 'Compraventa de inmueble — apartamento', c_civ, i_regpub, tm_milena, '2026-03-28', s_tramite, 'Estante 10, Carpeta 4', 'Pendiente estudio de título', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-020';

  -- CLI-021: Minera Cerro Colorado
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 41, 'ADM-004', 'Renovación de concesión minera', c_adm, NULL, tm_daveiva, '2025-07-01', s_activo, 'Estante 11, Carpeta 1', 'Consulta popular pendiente', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-021';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 42, 'REG-007', 'Estudio de impacto ambiental', c_reg, i_minsa, tm_milena, '2026-02-10', s_tramite, 'Estante 11, Carpeta 2', 'Coordinación con MiAmbiente', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-021';

  -- CLI-022: Andrés Felipe Castaño
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 43, 'MIG-006', 'Permiso de residente permanente', c_mig, i_migracion, tm_daveiva, '2026-01-28', s_activo, 'Estante 11, Carpeta 3', 'Colombiano, 5 años en PTY', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-022';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 44, 'CORP-008', 'Constitución de empresa individual', c_corp, i_regpub, tm_milena, '2026-03-30', s_tramite, 'Estante 11, Carpeta 4', 'Consultora de software', false
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-022';

  -- CLI-023: Energía Verde PTY
  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 45, 'REG-008', 'Licencia de generación eléctrica solar', c_reg, NULL, tm_daveiva, '2026-02-22', s_activo, 'Estante 12, Carpeta 1', 'Capacidad: 50MW', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-023';

  INSERT INTO cases (tenant_id, client_id, case_number, case_code, description, classification_id, institution_id, responsible_id, opened_at, status_id, physical_location, observations, has_digital_file)
  SELECT t_id, id, 46, 'ADM-005', 'Concesión de terreno estatal — Azuero', c_adm, i_municipio, tm_milena, '2026-03-18', s_tramite, 'Estante 12, Carpeta 2', 'Plazo de concesión: 30 años', true
  FROM clients WHERE tenant_id = t_id AND client_number = 'CLI-023';

END $$;
